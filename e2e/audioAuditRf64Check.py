"""Validate >4GiB RF64 native PCM by exact fixture identity; no clocks-only pass."""
import argparse
import base64
import hashlib
import json
from pathlib import Path
import struct
import time
import numpy as np

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('directory', type=Path)
parser.add_argument('--desktop-only', action='store_true')
parser.add_argument('--selftest', action='store_true')
args = parser.parse_args()
metadata = json.loads((args.directory / 'metadata.json').read_text())
fixture = args.directory / 'fixture-2h.rf64.wav'
with fixture.open('rb') as handle:
    header = handle.read(104)
    assert header[:4] == b'RF64' and header[12:16] == b'ds64'
    assert struct.unpack_from('<Q', header, 28)[0] == metadata['dataBytes'] > 2**32
    assert struct.unpack_from('<Q', header, 36)[0] == metadata['frames']
    assert fixture.stat().st_size == metadata['bytes']
    assert hashlib.sha256(header).hexdigest() == metadata['headerSha256']
    for section in metadata['sections']:
        handle.seek(104 + section['startFrame'] * 16)
        assert hashlib.sha256(handle.read(section['frames'] * 16)).hexdigest() == section['sha256']
    first_reference = metadata['sections'][-1]['startFrame']
    handle.seek(104 + first_reference * 16)
    reference_pcm = np.frombuffer(handle.read(metadata['sections'][-1]['frames'] * 16), dtype='<i2').reshape(-1, 8)
    reference_float = reference_pcm.astype(np.float32)
    # WebKit uses signed /32768. Chromium's native decoder was observed to
    # multiply positive values by the float32 reciprocal of32767 instead.
    # Keep both exact arithmetic models; do not fit gains or widen tolerances.
    reference_models = {
        'signed32768': reference_float * np.float32(1 / 32768),
        'asymmetricFloat32Reciprocal': reference_float * np.where(reference_pcm > 0, np.float32(1 / 32767), np.float32(1 / 32768)),
    }


def analyze(capture):
    errors = []
    if capture.get('sampleRate') != 48000 or capture.get('inputChannelCounts') != [8]:
        return {'passed': False, 'errors': ['Expected 48kHz and all worklet blocks with 8 native channels']}
    if len(capture.get('streams', [])) != 8:
        return {'passed': False, 'errors': ['Missing native streams']}
    streams = [np.frombuffer(base64.b64decode(s), dtype='<f4') for s in capture['streams']]
    if any(len(s) != capture.get('frames') for s in streams) or capture['frames'] != 144000:
        return {'passed': False, 'errors': ['Invalid three-second frame count']}
    y = np.stack(streams, axis=1)
    if not np.isfinite(y).all():
        return {'passed': False, 'errors': ['Nonfinite PCM']}
    active = np.flatnonzero(np.max(np.abs(y[:, :6]), axis=1) > 0)
    if len(active) < 4096:
        return {'passed': False, 'errors': ['Missing native music PCM']}
    lo, hi = int(active[0]), int(active[-1]) + 1
    index, length = lo + 512, 2048
    query = y[index:index + length, 0]
    matches = []
    for model, reference in reference_models.items():
        candidates = np.arange(len(reference) - length + 1)
        for k in [0, 1, 7, 79, 255, 1023, 2047]:
            candidates = candidates[reference[candidates + k, 0] == query[k]]
        matches.extend((model, int(c)) for c in candidates if np.array_equal(reference[c:c + length, 0], query))
    if len(matches) != 1:
        return {'passed': False, 'errors': ['Native PCM has no unique exact source identity'], 'matchCount': len(matches)}
    model, match = matches[0]
    reference = reference_models[model]
    offset = match - index
    if lo + offset < 0 or hi + offset > len(reference):
        return {'passed': False, 'errors': ['Native span extends outside known ending fixture']}
    start_frame = first_reference + lo + offset
    end_frame = first_reference + hi + offset
    target_frame = round(metadata['target'] * 48000)
    error = np.abs(y[lo:hi] - reference[lo + offset:hi + offset])
    unequal = [int(np.count_nonzero(error[:, ch])) for ch in range(8)]
    if start_frame != target_frame:
        errors.append('Native source onset differs from requested target')
    if end_frame != metadata['frames']:
        errors.append('Native source ending was truncated or extended')
    if any(unequal):
        errors.append('Native PCM differs from exact fixture on one or more channels')
    if len(y) - hi < 9600 or np.any(y[hi:]):
        errors.append('Missing 200ms all-channel silence after ending')
    complete = next((a for a in capture.get('actions', []) if a['name'] == 'capture-complete'), None)
    if not complete or complete.get('duration') != 7200 or not complete.get('ended') or not complete.get('paused'):
        errors.append('Native did not finish with duration7200, ended and paused')
    trusted = [a for a in capture.get('actions', []) if a['name'] in ['trusted-prepare', 'trusted-start']]
    if len(trusted) != 2 or not all(a.get('trusted') for a in trusted):
        errors.append('Missing explicit trusted Prepare/Start gestures')
    return {'passed': not errors, 'errors': errors, 'pcmNormalizationModel': model,
            'firstSourceFrame': start_frame, 'firstSourceTime': start_frame / 48000,
            'requestedFrame': target_frame, 'startErrorFrames': start_frame - target_frame, 'lastSourceEndFrame': end_frame,
            'continuityFrames': hi - lo, 'unequalFramesByChannel': unequal,
            'captureSourceStartFrame': lo, 'captureSourceEndFrame': hi, 'silenceAfterFrames': len(y) - hi}


if args.selftest:
    def synthetic(model, offset=0, corrupt=None):
        pcm = np.zeros((144000, 8), dtype=np.float32)
        start = round(metadata['target'] * 48000) - first_reference + offset
        part = reference_models[model][start:]
        pcm[4096:4096 + len(part)] = part
        if corrupt == 'music': pcm[8192, 2] += .001
        if corrupt == 'cue': pcm[20000, 7] = .5
        if corrupt == 'end': pcm[4096 + len(part) - 128:4096 + len(part)] = 0
        if corrupt == 'gain': pcm *= np.float32(1.0001)
        if corrupt == 'channel-swap': pcm[:, [2, 3]] = pcm[:, [3, 2]]
        return {'sampleRate': 48000, 'inputChannelCounts': [8], 'frames': 144000,
                'streams': [base64.b64encode(pcm[:, c].tobytes()).decode() for c in range(8)],
                'actions': [{'name': 'trusted-prepare', 'trusted': True}, {'name': 'trusted-start', 'trusted': True},
                            {'name': 'capture-complete', 'duration': 7200, 'ended': True, 'paused': True}]}
    cases = []
    for model in reference_models:
        cases.extend([(f'{model}/exact', synthetic(model), True),
                      (f'{model}/one-sample-late', synthetic(model, 1), False),
                      (f'{model}/one-sample-early', synthetic(model, -1), False),
                      *[(f'{model}/{corrupt}', synthetic(model, corrupt=corrupt), False)
                        for corrupt in ['music', 'cue', 'end', 'gain', 'channel-swap']]])
    for label, capture, expected in cases:
        result = analyze(capture)
        assert result['passed'] == expected, (label, result)
    print(json.dumps({'calibrationCases': len(cases), 'passed': True}))
    raise SystemExit(0)

ranges = [json.loads(line) for line in (args.directory / 'range-requests.jsonl').read_text().splitlines()]
required = ['chromium-rf64-2h', 'webkit-rf64-2h'] + ([] if args.desktop_only else ['native-ios-rf64-2h'])
results = []
for run in required:
    filename = args.directory / f'{run}.json'
    if not filename.exists():
        results.append({'run': run, 'passed': False, 'incomplete': True, 'errors': ['Missing capture']})
        continue
    capture = json.loads(filename.read_text())
    result = analyze(capture)
    actual_ranges = [r for r in ranges if r.get('run') == run and r['start'] > 2**32 and r['bytesRead'] > 0]
    if not actual_ranges:
        result['passed'] = False
        result['errors'].append('No observed native HTTP byte range beyond4GiB')
    if not capture.get('captureSourceHashes') or capture.get('fixtureMetadataSha256') != hashlib.sha256((args.directory / 'metadata.json').read_bytes()).hexdigest():
        result['passed'] = False
        result['errors'].append('Missing or inconsistent capture/fixture provenance')
    results.append({'run': run, 'rawSha256': hashlib.sha256(filename.read_bytes()).hexdigest(), **result,
                    'rangesBeyond4GiB': actual_ranges})
summary = {'protocol': 'mimicopy-large-rf64-check-v1', 'scope': 'desktop-only' if args.desktop_only else 'Chromium+WebKit+native-iOS',
           'fixtureBytes': metadata['bytes'], 'passed': all(r['passed'] for r in results), 'results': results}
output = args.directory / f'rf64-check-{time.time_ns()}.json'
output.write_text(json.dumps(summary, indent=2))
print(json.dumps({'output': str(output), **summary}))
raise SystemExit(0 if summary['passed'] else 2 if any(r.get('incomplete') for r in results) else 1)
