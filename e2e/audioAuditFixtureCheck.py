"""Lossless fixture-reader checks, separate from recorded-audio evidence."""

import importlib.util
from pathlib import Path
import struct
import subprocess
import tempfile
import unittest
import wave

import numpy as np

spec = importlib.util.spec_from_file_location(
    'audio_audit_pcm_analysis', Path(__file__).resolve().with_name('audioAuditPcmAnalysis.py'))
if spec is None or spec.loader is None:
    raise ImportError('Cannot load PCM analyzer')
analyzer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(analyzer)


class FixtureChecks(unittest.TestCase):
    def test_legacy_and_current_lossless_fixtures(self):
        rng = np.random.default_rng(792)
        music = rng.integers(-12000, 12001, size=(512, 6), dtype=np.int16)
        cues = rng.integers(-24000, 24001, size=(512, 2), dtype=np.int16)
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for channels, samples in [(6, music), (8, np.column_stack([music, cues]))]:
                wav_path = root / f'{channels}.wav'
                with wave.open(str(wav_path), 'wb') as file:
                    file.setnchannels(channels)
                    file.setsampwidth(2)
                    file.setframerate(48000)
                    file.writeframes(samples.astype('<i2').tobytes())
                decoded, metadata = analyzer.load_fixture(wav_path, 1)
                np.testing.assert_array_equal(decoded, music)
                self.assertEqual(metadata['channels'], channels)
                self.assertEqual(metadata['container'], 'wav')
                self.assertEqual(metadata['riffType'], 'RIFF')
            # Force RF64 on this tiny file so the 64-bit size path is exercised
            # without generating hours of PCM. Production uses '-rf64 auto'.
            rf64_path = root / '8-rf64.wav'
            subprocess.run([analyzer.default_ffmpeg(), '-nostdin', '-hide_banner', '-loglevel', 'error',
                            '-i', str(root / '8.wav'), '-c:a', 'pcm_s16le', '-rf64', 'always',
                            str(rf64_path)], check=True, capture_output=True, timeout=60)
            decoded, metadata = analyzer.load_fixture(rf64_path, 1)
            np.testing.assert_array_equal(decoded, music)
            self.assertEqual(metadata['container'], 'wav')
            self.assertEqual(metadata['riffType'], 'RF64')
            self.assertEqual(metadata['frames'], 512)
            self.assertEqual(metadata['channels'], 8)
            self.assertEqual(metadata['cueChannelCount'], 2)
            np.testing.assert_array_equal(analyzer.read_fixture(rf64_path, 128 / 48000), music[:128])
            flac_path = root / '8.flac'
            subprocess.run([analyzer.default_ffmpeg(), '-nostdin', '-hide_banner', '-loglevel', 'error',
                            '-i', str(root / '8.wav'), '-c:a', 'flac', '-sample_fmt', 's16',
                            str(flac_path)], check=True, capture_output=True, timeout=60)
            decoded, metadata = analyzer.load_fixture(flac_path, 1)
            np.testing.assert_array_equal(decoded, music)
            self.assertEqual(metadata['container'], 'flac')
            self.assertEqual(metadata['frames'], 512)
            self.assertEqual(metadata['channels'], 8)
            self.assertEqual(metadata['cueChannelCount'], 2)
            prefix = analyzer.read_fixture(flac_path, 128 / 48000)
            np.testing.assert_array_equal(prefix, music[:128])
            damaged = bytearray(flac_path.read_bytes())
            info = int.from_bytes(damaged[18:26], 'big')
            info = (info & ~(7 << 41)) | (5 << 41)
            damaged[18:26] = info.to_bytes(8, 'big')
            bad_path = root / 'wrong-channels.flac'
            bad_path.write_bytes(damaged)
            with self.assertRaisesRegex(ValueError, 'eight-channel'):
                analyzer.read_fixture(bad_path, 1)

    def test_rf64_rejects_invalid_sizes_and_truncation(self):
        frames = 128
        pcm = np.arange(frames * 8, dtype='<i2').tobytes()
        fmt = struct.pack('<HHIIHH', 1, 8, 48000, 48000 * 16, 16, 16)
        # Small valid RF64 with explicit size markers; offsets are known here
        # only because this test constructs every chunk itself.
        tail = b'fmt ' + struct.pack('<I', len(fmt)) + fmt + b'data' + struct.pack('<I', 0xffffffff) + pcm
        total_size = 12 + 8 + 28 + len(tail)
        valid = bytearray(b'RF64' + struct.pack('<I', 0xffffffff) + b'WAVE' + b'ds64' + struct.pack('<I', 28) +
                          struct.pack('<QQQI', total_size - 8, len(pcm), frames, 0) + tail)
        mutations = {}
        for name, offset, encoding, value in [
            ('missing ds64', 12, '<4s', b'JUNK'),
            ('short ds64', 16, '<I', 24),
            ('invalid table length', 44, '<I', 1),
            ('oversized container', 20, '<Q', total_size + 100),
            ('oversized data', 28, '<Q', len(pcm) + 16),
            ('inconsistent frame count', 36, '<Q', frames + 1),
            ('partial sample frame', 28, '<Q', len(pcm) - 1),
            ('missing RF64 marker', 4, '<I', total_size - 8)
        ]:
            damaged = bytearray(valid)
            struct.pack_into(encoding, damaged, offset, value)
            mutations[name] = damaged
        mutations['truncated data'] = valid[:-1]
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'fixture.wav'
            path.write_bytes(valid)
            actual, metadata = analyzer.load_fixture(path, 1)
            np.testing.assert_array_equal(actual, np.frombuffer(pcm, dtype='<i2').reshape(frames, 8)[:, :6])
            self.assertEqual(metadata['riffType'], 'RF64')
            for name, damaged in mutations.items():
                with self.subTest(name=name):
                    path.write_bytes(damaged)
                    with self.assertRaises(ValueError):
                        analyzer.load_fixture(path, 1)


if __name__ == '__main__':
    unittest.main()
