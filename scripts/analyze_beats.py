#!/usr/bin/env python3
"""Run Beat This! final0 with its DBN postprocessor."""
import contextlib
import json
import math
import os
import sys


def build_beat_grid(beat_times, downbeat_times):
    beats = [float(time) for time in beat_times]
    downbeats = [float(time) for time in downbeat_times]
    for times in (beats, downbeats):
        if any(not math.isfinite(time) or time < 0 for time in times):
            raise ValueError("Beat This! returned an invalid timestamp.")
        if any(left >= right for left, right in zip(times, times[1:])):
            raise ValueError("Beat This! timestamps must be strictly increasing.")

    downbeat_set = set(downbeats)
    if not downbeat_set.issubset(beats):
        raise ValueError("Beat This! downbeats must also be beats.")

    downbeat_indices = [i for i, time in enumerate(beats) if time in downbeat_set]
    measure_lengths = [
        right - left
        for left, right in zip(downbeat_indices, downbeat_indices[1:])
    ]
    # Infer a pickup only when there is a complete measure to compare with.
    # Otherwise start at 2, so an unknown pickup never becomes a false downbeat.
    position = 2
    if measure_lengths and downbeat_indices[0] < measure_lengths[0]:
        position = measure_lengths[0] - downbeat_indices[0] + 1

    points = []
    for time in beats:
        is_downbeat = time in downbeat_set
        if is_downbeat:
            position = 1
        points.append({"time": time, "position": position, "isDownbeat": is_downbeat})
        position += 1

    return {
        "beats": points,
        # Observed complete measures, rather than DBN candidates. May be empty.
        "beatsPerBar": sorted(set(measure_lengths)),
        "source": "beat-this",
        "model": "final0",
        "postprocessor": "dbn",
    }


def main():
    if len(sys.argv) != 2:
        print("Usage: analyze_beats.py /path/to/audio", file=sys.stderr)
        return 2

    # Third-party download/progress messages must not corrupt the JSON protocol.
    with contextlib.redirect_stdout(sys.stderr):
        import torch
        from beat_this.inference import File2Beats

        torch.set_num_threads(max(1, int(os.environ.get("MIMICOPY_BEAT_THREADS", "2"))))
        tracker = File2Beats(checkpoint_path="final0", device="cpu", dbn=True)
        beats, downbeats = tracker(sys.argv[1])
        grid = build_beat_grid(beats, downbeats)

    json.dump(grid, sys.stdout, separators=(",", ":"), allow_nan=False)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
