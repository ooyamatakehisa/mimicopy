"""Inspect retained WAV/unity-rate PCM; successful analysis is not a regression pass.

Only NumPy is required. Whole-segment checks need an unmuted, unity-gain anchor
channel and the exact six-channel PCM16 fixture used to produce the capture.
Absent, ambiguous, nonunity, and out-of-range matches remain unresolved.
"""

import argparse
import base64
import json
import struct
from pathlib import Path

import numpy as np

CHANNELS = ['original', 'stem', 'remainder']
FREQUENCIES = np.array([375, 1875, 750, 2250, 1500, 2625])
SAMPLE_RATE = 48000


def read_fixture(path, search_seconds):
    """Read chunk headers rather than assuming a fixed WAV header size."""
    with path.open('rb') as wav:
        header = wav.read(12)
        if len(header) != 12 or header[:4] != b'RIFF' or header[8:] != b'WAVE':
            raise ValueError('Fixture must be a RIFF WAVE file')
        fmt = None
        data = None
        while chunk_header := wav.read(8):
            if len(chunk_header) != 8:
                raise ValueError('Truncated WAV chunk header')
            kind, length = struct.unpack('<4sI', chunk_header)
            start = wav.tell()
            if kind == b'fmt ':
                fmt = wav.read(min(length, 40))
            elif kind == b'data':
                data = (start, length)
            if fmt is not None and data is not None:
                break
            wav.seek(start + length + (length % 2))
    if fmt is None or len(fmt) < 16 or data is None:
        raise ValueError('Fixture is missing fmt/data chunks')
    encoding, channels, sample_rate, _, block_align, bits = struct.unpack_from('<HHIIHH', fmt)
    extensible_pcm = (encoding == 0xfffe and len(fmt) >= 40 and
                      fmt[24:40] == bytes.fromhex('0100000000001000800000aa00389b71'))
    if (encoding != 1 and not extensible_pcm) or (channels, sample_rate, block_align, bits) != (6, SAMPLE_RATE, 12, 16):
        raise ValueError('Fixture must be six-channel, 48 kHz, PCM16 WAV')
    start, length = data
    if not length or length % 12 or start + length > path.stat().st_size:
        raise ValueError('Invalid or truncated fixture data')
    pcm = np.memmap(path, dtype='<i2', mode='r', offset=start, shape=(length // 12, 6))
    return pcm[:min(len(pcm), int(search_seconds * SAMPLE_RATE))]


def decode(value):
    return np.frombuffer(base64.b64decode(value, validate=True), dtype='<f4').astype(np.float64)


def runs(mask, minimum=1):
    edges = np.diff(np.r_[False, mask, False].astype(int))
    starts, ends = np.flatnonzero(edges == 1), np.flatnonzero(edges == -1)
    return [(int(a), int(b)) for a, b in zip(starts, ends) if b - a >= minimum]


def rms(values):
    return float(np.sqrt(np.mean(values ** 2))) if values.size else 0.0


def summarize_intervals(intervals, sample_rate):
    return [dict(startFrame=a, endFrameExclusive=b, startMs=a / sample_rate * 1000,
                 durationMs=(b - a) / sample_rate * 1000) for a, b in intervals]


def exact_pcm16(values):
    scaled = values * 32768
    if np.any(scaled < -32768) or np.any(scaled > 32767) or not np.equal(scaled, np.rint(scaled)).all():
        return None
    return scaled.astype(np.int16)


def fixture_matches(chunk, reference, pair):
    """Return all exact initial-window matches, never matches after rounding."""
    integer = exact_pcm16(chunk)
    if integer is None or len(integer) < 128 or len(integer) > len(reference):
        return []
    possible = np.flatnonzero(reference[:len(reference) - len(integer) + 1, pair] == integer[0, 0])
    for offset, side in [(1, 0), (7, 1), (15, 0), (31, 1), (63, 0), (127, 1)]:
        possible = possible[reference[possible + offset, pair + side] == integer[offset, side]]
    return [int(position) for position in possible
            if np.array_equal(reference[position:position + len(integer), pair:pair + 2], integer)]


def continuity(sources, zero_runs, reference, anchor):
    pair = CHANNELS.index(anchor) * 2
    anchor_pcm = sources[pair:pair + 2].T
    active = np.ones(len(anchor_pcm), dtype=bool)
    for start, end in zero_runs:
        active[start:end] = False
    segments = []
    for start, end in runs(active):
        chunk = anchor_pcm[start:end]
        segment = dict(startFrame=start, endFrameExclusive=end, status='unresolved')
        if len(chunk) < 128:
            segment['reason'] = 'active_segment_shorter_than_128_frames'
        elif exact_pcm16(chunk) is None:
            segment['reason'] = 'anchor_not_exact_pcm16_unity_gain_or_resampling_unresolved'
        else:
            matches = fixture_matches(chunk[:1024], reference, pair)
            segment['initialFixtureMatches'] = matches
            if len(matches) != 1:
                segment['reason'] = 'missing_or_ambiguous_initial_fixture_match'
            elif matches[0] + len(chunk) > len(reference):
                segment['reason'] = 'segment_exceeds_fixture_search_range'
            else:
                expected = reference[matches[0]:matches[0] + len(chunk), pair:pair + 2].astype(float) / 32768
                different = np.any(chunk != expected, axis=1)
                segment['fixtureStartFrame'] = matches[0]
                segment['status'] = 'different' if np.any(different) else 'exact'
                if np.any(different):
                    segment['reason'] = 'anchor_differs_from_consecutive_fixture_gain_or_timeline_requires_diagnosis'
                    segment['firstDifferentFrame'] = start + int(np.flatnonzero(different)[0])
        segments.append(segment)
    counts = {status: sum(segment['status'] == status for segment in segments)
              for status in ['exact', 'different', 'unresolved']}
    status = ('unresolved' if not segments or counts['unresolved'] else
              'different' if counts['different'] else 'exact')
    return dict(status=status, anchorChannel=anchor, segments=segments, counts=counts,
                reason='no_active_segments' if not segments else None)


def reconstruct_gain(sources, reference, timeline, sample_rate, ramp_ms, include_samples):
    results = []
    maximum_slope = 1 / (sample_rate * ramp_ms / 1000)
    for segment in timeline['segments']:
        if segment['status'] != 'exact':
            continue
        start, end, fixture_start = segment['startFrame'], segment['endFrameExclusive'], segment['fixtureStartFrame']
        expected = reference[fixture_start:fixture_start + end - start].astype(float) / 32768
        for index, channel in enumerate(CHANNELS):
            actual = sources[index * 2:index * 2 + 2, start:end].T
            pair = expected[:, index * 2:index * 2 + 2]
            denominator = (pair * pair).sum(axis=1)
            gain = np.divide((actual * pair).sum(axis=1), denominator,
                             out=np.full(len(pair), np.nan), where=denominator > 1e-10)
            valid = np.flatnonzero(np.isfinite(gain))
            fit_error = np.max(np.abs(actual - np.nan_to_num(gain)[:, None] * pair))
            item = dict(channel=channel, startFrame=start, endFrameExclusive=end,
                        fixtureStartFrame=fixture_start, maximumStereoScalarFitError=float(fit_error),
                        status='resolved' if len(valid) >= 128 and fit_error <= 1e-7 else 'unresolved')
            if item['status'] == 'unresolved':
                item['reason'] = 'insufficient_carrier_samples_or_stereo_not_one_scalar_gain'
                results.append(item)
                continue
            values = gain[valid]
            slopes = np.diff(values) / np.diff(valid)
            linear_segments = []
            for offset, slope in enumerate(slopes):
                before, after = start + int(valid[offset]), start + int(valid[offset + 1])
                if not linear_segments or abs(slope - linear_segments[-1]['slopePerFrame']) > 1e-5:
                    linear_segments.append(dict(startFrame=before, endFrame=after,
                        startGain=float(values[offset]), endGain=float(values[offset + 1]), slopePerFrame=float(slope)))
                else:
                    linear_segments[-1]['endFrame'] = after
                    linear_segments[-1]['endGain'] = float(values[offset + 1])
            abrupt = np.flatnonzero(np.abs(slopes) > maximum_slope + 1e-5)
            nonzero = valid[np.abs(values) > 1e-5]
            unity = valid[np.abs(values - 1) < 1e-4]
            item.update(minimumGain=float(values.min()), maximumGain=float(values.max()),
                firstNonzeroFrame=start + int(nonzero[0]) if len(nonzero) else None,
                firstNonzeroGain=float(gain[nonzero[0]]) if len(nonzero) else None,
                firstUnityFrame=start + int(unity[0]) if len(unity) else None,
                lastNonzeroFrame=start + int(nonzero[-1]) if len(nonzero) else None,
                linearSegments=linear_segments,
                slopeExceedances=[dict(beforeFrame=start + int(valid[i]), afterFrame=start + int(valid[i + 1]),
                    beforeGain=float(values[i]), afterGain=float(values[i + 1]), perFrameChange=float(slopes[i])) for i in abrupt])
            if include_samples:
                item['sampleGains'] = [dict(frame=start + int(frame), gain=float(gain[frame])) for frame in valid]
            results.append(item)
    return dict(status='resolved' if results and all(item['status'] == 'resolved' for item in results)
                and timeline['status'] == 'exact' else 'unresolved',
                expectedFullScaleRampMs=ramp_ms, segments=results,
                method='Per-sample stereo scalar least-squares, only on whole-segment exact anchor timelines; simultaneous carrier zeros are skipped. Slope exceedances are diagnostics, not proof of audible clicks.')


def inspect(case, reference, options):
    name = case.get('name', case.get('label', 'unnamed capture'))
    signal = case.get('signal')
    if not isinstance(signal, dict) or not isinstance(signal.get('retainedPcm'), dict):
        return dict(name=name, status='unresolved', reason='no_retained_pcm')
    raw = signal['retainedPcm']
    sample_rate = raw['sampleRate']
    if sample_rate != SAMPLE_RATE or signal.get('expectedPlaybackRate') != 1 or signal.get('transposeSemitones', 0) != 0:
        return dict(name=name, status='unresolved', reason='requires_48khz_unity_playback_zero_transpose')
    if raw['encoding'] != 'float32-le-base64':
        return dict(name=name, status='unresolved', reason='unsupported_pcm_encoding')
    sources = np.stack([decode(raw['postGain'][channel][side])
                        for channel in CHANNELS for side in ['left', 'right']])
    final = np.stack([decode(raw['finalLeft']), decode(raw['finalRight'])])
    if sources.shape[1] != raw['frames'] or final.shape[1] != raw['frames'] or raw['frames'] < 128 or not np.isfinite(sources).all() or not np.isfinite(final).all():
        return dict(name=name, status='unresolved', reason='invalid_retained_pcm_frames')
    summed = np.stack([sources[::2].sum(axis=0), sources[1::2].sum(axis=0)])
    difference = final - summed
    zero_runs = runs(np.max(np.abs(sources), axis=0) < 1e-12, 16)
    timeline = continuity(sources, zero_runs, reference, options.anchor_channel)
    gains = reconstruct_gain(sources, reference, timeline, sample_rate, options.gain_ramp_ms, options.include_gain_samples)

    # Carrier recurrence finds sharp edges; whole-segment matching above does
    # not depend on this threshold and also detects phase-aligned timeline jumps.
    residual = sources[:, 2:] - 2 * np.cos(2 * np.pi * FREQUENCIES / sample_rate)[:, None] * sources[:, 1:-1] + sources[:, :-2]
    maximum = np.max(np.abs(residual), axis=0)
    clusters = []
    for position in np.flatnonzero(maximum > 0.0003) + 2:
        if not clusters or position - clusters[-1][-1] > 128:
            clusters.append([int(position)])
        else:
            clusters[-1].append(int(position))
    spikes = []
    for cluster in clusters:
        positions = np.array(cluster)
        peak = int(positions[np.argmax(maximum[positions - 2])])
        spikes.append(dict(startFrame=cluster[0], endFrame=cluster[-1], peakFrame=peak,
            peakMs=peak / sample_rate * 1000, peakResidual=float(maximum[peak - 2]),
            residualAtPeak=abs(residual[:, peak - 2]).tolist()))
    repeated = np.max(np.abs(sources[:, 128:] - sources[:, :-128]), axis=0) == 0
    repeated &= np.max(np.abs(sources[:, 128:]), axis=0) > 1e-12
    repeats = [(a + 128, b + 128) for a, b in runs(repeated, 128)]

    candidate_windows = []
    for direction, channels in signal.get('stereoEvidence', {}).items():
        if direction not in ['rightCarriersInLeft', 'leftCarriersInRight']:
            continue
        for channel, item in channels.items():
            if not item['rawCandidate'] and not item['windowCandidate']:
                continue
            windows = []
            side = 0 if direction == 'rightCarriersInLeft' else 1
            carrier = FREQUENCIES[CHANNELS.index(channel) * 2 + (1 if side == 0 else 0)]
            for window in item['windows']:
                if window['bandRms'] <= 0.00015:
                    continue
                start = round(window['offsetMs'] * sample_rate / 1000)
                if start < 0 or start + 4096 > sources.shape[1]:
                    continue
                weight = np.hanning(4096)
                bins = np.abs(np.fft.rfftfreq(4096, 1 / sample_rate) - carrier) <= 45
                def band_rms(stream):
                    spectrum = np.fft.rfft(stream[start:start + 4096] * weight)
                    return float(np.sqrt(2 * np.sum(np.abs(spectrum[bins]) ** 2) / (4096 * np.sum(weight ** 2))))
                windows.append(dict(**window, postGainSumBandRms=band_rms(summed[side]),
                                    finalMinusSumBandRms=band_rms(difference[side])))
            candidate_windows.append(dict(direction=direction, channel=channel,
                classification=item['classification'], rawBandRms=item['rawBandRms'], windows=windows))

    pair = CHANNELS.index(options.anchor_channel) * 2
    def fixture_match(start, length=1024):
        length = min(length, sources.shape[1] - start)
        return fixture_matches(sources[pair:pair + 2, start:start + length].T, reference, pair) if start >= 0 else []
    alignments = []
    for spike in spikes:
        edge = spike['peakFrame'] // 128 * 128
        before, after = fixture_match(edge - 1024), fixture_match(edge)
        jump = after[0] - before[0] - 1024 if len(before) == len(after) == 1 else None
        def validate_all_channels(start, matches):
            if len(matches) != 1:
                return None
            length = min(1024, sources.shape[1] - start)
            actual = sources[:, start:start + length].T
            expected = reference[matches[0]:matches[0] + length].astype(float) / 32768
            return [None if not np.any(actual[:, channel]) else bool(np.array_equal(actual[:, channel], expected[:, channel])) for channel in range(6)]
        alignments.append(dict(edgeFrame=edge, edgeMs=edge / sample_rate * 1000,
            previous1024FrameFixtureMatches=before, next1024FrameFixtureMatches=after,
            jumpFrames=jump, jumpMs=jump / sample_rate * 1000 if jump is not None else None,
            activeChannelsMatchBefore=validate_all_channels(edge - 1024, before),
            activeChannelsMatchAfter=validate_all_channels(edge, after)))
    return dict(name=name, status='analyzed', frames=raw['frames'], sampleRate=sample_rate,
        durationMs=signal['durationMs'], mediaTimeAfter=case.get('mediaTime'),
        sourceRms=[rms(source) for source in sources], continuity=timeline, gainReconstruction=gains,
        finalMinusPostGainSum=dict(leftRms=rms(difference[0]), rightRms=rms(difference[1]),
            maximumAbsolute=float(abs(difference).max()), relativeRms=rms(difference) / max(rms(final), 1e-30)),
        simultaneousZeroRuns=summarize_intervals(zero_runs, sample_rate),
        exactRepeated128FrameRuns=summarize_intervals(repeats, sample_rate),
        recurrenceResidualQuantiles=np.quantile(maximum, [0.5, 0.99, 0.999, 1]).tolist(),
        discontinuityClusters=spikes, fixtureAlignments=alignments, spectralCandidates=candidate_windows)


def positive_number(value):
    number = float(value)
    if not np.isfinite(number) or number <= 0:
        raise argparse.ArgumentTypeError('must be positive and finite')
    return number


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('capture', type=Path)
    parser.add_argument('--fixture', type=Path, help='Defaults to fixture-mixer-wav.wav beside the capture')
    parser.add_argument('--output', type=Path, help='Defaults to a derived pcm-analysis JSON beside the capture')
    parser.add_argument('--search-seconds', type=positive_number, default=24,
                        help='Search this many fixture seconds from its beginning (default: 24); out-of-range matches remain unresolved')
    parser.add_argument('--anchor-channel', choices=CHANNELS, default='remainder',
                        help='Channel expected to remain unmuted at unity (default: remainder)')
    parser.add_argument('--gain-ramp-ms', type=positive_number, default=8,
                        help='Expected full-scale ramp duration for slope diagnostics (default: 8)')
    parser.add_argument('--include-gain-samples', action='store_true',
                        help='Include every reconstructed sample; output can be large')
    options = parser.parse_args()
    input_path = options.capture.resolve()
    fixture_path = options.fixture.resolve() if options.fixture else input_path.parent / 'fixture-mixer-wav.wav'
    reference = read_fixture(fixture_path, options.search_seconds)
    if len(reference) < 128:
        parser.error('fixture search range must contain at least 128 frames')
    document = json.loads(input_path.read_text())
    results = []
    for case in document['cases']:
        try:
            results.append(inspect(case, reference, options))
        except (ValueError, KeyError, TypeError) as error:
            results.append(dict(name=case.get('name', 'unnamed capture'), status='unresolved',
                                reason='invalid_capture', detail=str(error)))
    timelines = [case['continuity'] for case in results if 'continuity' in case]
    summary = dict(cases=len(results), analyzed=sum(case['status'] == 'analyzed' for case in results),
        unresolvedCases=sum(case['status'] == 'unresolved' for case in results),
        continuityCounts={status: sum(item['status'] == status for item in timelines)
                          for status in ['exact', 'different', 'unresolved']},
        activeSegments=sum(len(item['segments']) for item in timelines),
        allActiveSegmentsExact=bool(results) and len(timelines) == len(results) and
            all(item['status'] == 'exact' for item in timelines))
    output = dict(input=str(input_path), fixture=str(fixture_path), referenceFrames=len(reference),
        scope='Diagnostic only: exact WAV fixture, 1x, zero transpose, unmuted unity anchor; missing or nonunity matches are unresolved. Successful analysis is not a regression pass.',
        method='Whole active-segment consecutive fixture matching; per-sample stereo gain reconstruction; source/final spectral comparison and thresholded discontinuity localization.',
        summary=summary, cases=results)
    output_path = options.output or input_path.parent / ('pcm-analysis-' + input_path.stem + '.json')
    output_path.write_text(json.dumps(output, indent=2, allow_nan=False) + '\n')
    print(json.dumps(summary))
    for case in results:
        print(case['name'], case.get('reason', case['status']),
              'continuity=' + case.get('continuity', {}).get('status', 'unresolved'))


if __name__ == '__main__':
    main()
