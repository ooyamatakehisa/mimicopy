"""Reusable synthetic checks for audioAuditPcmAnalysis.py (requires NumPy).

Run: python3 e2e/audioAuditPcmAnalysisCheck.py
No browser, audio device, server, saved recording, or repository media is used.
Real captured audio must still be analyzed separately; these checks validate
analysis behavior, not production playback or perceptual audio quality.
"""

import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
from types import SimpleNamespace
import unittest
import wave

import numpy as np

ANALYZER_PATH = Path(__file__).resolve().with_name('audioAuditPcmAnalysis.py')
spec = importlib.util.spec_from_file_location('audio_audit_pcm_analysis', ANALYZER_PATH)
if spec is None or spec.loader is None:
    raise ImportError(f'Cannot import {ANALYZER_PATH}')
analyzer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(analyzer)


class PcmAnalysisChecks(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        random = np.random.default_rng(527)
        cls.reference = random.integers(-12000, 12001, size=(5000, 6), dtype=np.int16)
        cls.source = cls.reference[:2048].T.astype(float) / 32768
        cls.options = SimpleNamespace(anchor_channel='remainder', gain_ramp_ms=8,
                                      include_gain_samples=False)

    def timeline(self, source=None, reference=None):
        return analyzer.continuity(self.source if source is None else source, [],
                                   self.reference if reference is None else reference, 'remainder')

    def gains(self, source=None, include_samples=False):
        source = self.source if source is None else source
        return analyzer.reconstruct_gain(source, self.reference, self.timeline(source),
                                         48000, 8, include_samples)

    def faded_source(self):
        source = self.source.copy()
        source[:2] *= np.clip((np.arange(2048) - 400) / 384, 0, 1)
        return source

    def test_unity_timeline(self):
        result = self.timeline()
        self.assertEqual(result['status'], 'exact')
        self.assertEqual(result['counts']['exact'], 1)

    def test_unity_gain(self):
        result = self.gains()
        self.assertEqual(result['status'], 'resolved')
        self.assertTrue(all(item['minimumGain'] == item['maximumGain'] == 1
                            for item in result['segments']))

    def test_one_frame_timeline_jump(self):
        source = self.source.copy()
        source[:, 1536:] = self.reference[1537:2049].T.astype(float) / 32768
        result = self.timeline(source)
        self.assertEqual(result['status'], 'different')
        self.assertEqual(result['segments'][0]['firstDifferentFrame'], 1536)

    def test_nonunity_anchor(self):
        source = self.source.copy()
        source[4:6] *= .5
        self.assertEqual(self.timeline(source)['status'], 'unresolved')

    def test_missing_match(self):
        source = self.source.copy()
        source[4:6] *= -1
        self.assertEqual(self.timeline(source)['status'], 'unresolved')

    def test_ambiguous_match(self):
        reference = np.concatenate([self.reference[:2048], self.reference[:2048]])
        self.assertEqual(self.timeline(reference=reference)['status'], 'unresolved')

    def test_reference_range_exhausted(self):
        self.assertEqual(self.timeline(reference=self.reference[:1500])['status'], 'unresolved')

    def test_active_segment_too_short(self):
        self.assertEqual(self.timeline(self.source[:, :127])['status'], 'unresolved')

    def test_silence_does_not_pass_vacuously(self):
        result = analyzer.continuity(np.zeros_like(self.source), [(0, 2048)],
                                     self.reference, 'remainder')
        self.assertEqual(result['status'], 'unresolved')
        self.assertEqual(result['segments'], [])

    def test_no_vacuous_gain_reconstruction(self):
        source = np.zeros_like(self.source)
        timeline = analyzer.continuity(source, [(0, 2048)], self.reference, 'remainder')
        result = analyzer.reconstruct_gain(source, self.reference, timeline, 48000, 8, False)
        self.assertEqual(result['status'], 'unresolved')

    def test_empty_segment(self):
        self.assertEqual(self.timeline(self.source[:, :0])['status'], 'unresolved')

    def test_smooth_eight_ms_fade(self):
        result = self.gains(self.faded_source())
        self.assertEqual(result['status'], 'resolved')
        self.assertEqual(result['segments'][0]['slopeExceedances'], [])

    def test_first_fade_sample(self):
        original = self.gains(self.faded_source())['segments'][0]
        self.assertEqual(original['firstNonzeroFrame'], 401)
        self.assertAlmostEqual(original['firstNonzeroGain'], 1 / 384, places=12)

    def test_optional_per_sample_output(self):
        original = self.gains(self.faded_source(), include_samples=True)['segments'][0]
        self.assertEqual(len(original['sampleGains']), 2048)

    def test_abrupt_gain_step(self):
        source = self.source.copy()
        source[:2, :1000] = 0
        self.assertEqual(len(self.gains(source)['segments'][0]['slopeExceedances']), 1)

    def test_stereo_cannot_fit_one_gain(self):
        source = self.source.copy()
        source[0] *= .5
        source[1] *= .7
        self.assertEqual(self.gains(source)['status'], 'unresolved')

    def test_missing_retained_pcm(self):
        self.assertEqual(analyzer.inspect({'name': 'missing'}, self.reference,
                                          self.options)['status'], 'unresolved')

    def test_nonunity_playback(self):
        case = {'name': 'half speed', 'signal': {
            'expectedPlaybackRate': .5, 'retainedPcm': {'sampleRate': 48000}}}
        self.assertEqual(analyzer.inspect(case, self.reference, self.options)['status'], 'unresolved')

    def test_transposed_playback(self):
        case = {'name': 'transpose', 'signal': {'expectedPlaybackRate': 1,
            'transposeSemitones': 6, 'retainedPcm': {'sampleRate': 48000}}}
        self.assertEqual(analyzer.inspect(case, self.reference, self.options)['status'], 'unresolved')

    def check_cli(self, cases, expected_unresolved):
        with tempfile.TemporaryDirectory(prefix='mimicopy-pcm-check-') as temporary:
            directory = Path(temporary)
            fixture = directory / 'fixture.wav'
            with wave.open(str(fixture), 'wb') as wav:
                wav.setnchannels(6)
                wav.setsampwidth(2)
                wav.setframerate(48000)
                wav.writeframes(self.reference.astype('<i2').tobytes())
            capture = directory / 'capture.json'
            output = directory / 'analysis.json'
            capture.write_text(json.dumps({'cases': cases}))
            command = [sys.executable, str(ANALYZER_PATH), str(capture),
                       '--fixture', str(fixture), '--output', str(output)]
            process = subprocess.run(command, capture_output=True, text=True,
                                     env={**os.environ, 'PYTHONDONTWRITEBYTECODE': '1'})
            self.assertEqual(process.returncode, 0, process.stderr)
            summary = json.loads(output.read_text())['summary']
            self.assertFalse(summary['allActiveSegmentsExact'])
            self.assertEqual(summary['cases'], len(cases))
            self.assertEqual(summary['unresolvedCases'], expected_unresolved)

    def test_cli_empty_case_list(self):
        self.check_cli([], 0)

    def test_cli_missing_retained_pcm(self):
        self.check_cli([{'name': 'missing'}], 1)

    def test_cli_nonunity_playback(self):
        self.check_cli([{'name': 'half speed', 'signal': {
            'expectedPlaybackRate': .5, 'retainedPcm': {'sampleRate': 48000}}}], 1)


if __name__ == '__main__':
    unittest.main(verbosity=2)
