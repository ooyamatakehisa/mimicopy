#!/usr/bin/env python3
import json
import math
import os
import sys


def parse_beats_per_bar():
    raw_value = os.environ.get("MIMICOPY_BEATS_PER_BAR", "3,4")
    values = []

    for part in raw_value.split(","):
        try:
            value = int(part.strip())
        except ValueError:
            continue

        if 0 < value <= 16:
            values.append(value)

    return values or [3, 4]


def to_beat(row):
    time = float(row[0])
    position = int(round(float(row[1])))

    if not math.isfinite(time) or time < 0:
        return None

    return {
        "time": time,
        "position": max(1, position),
        "isDownbeat": position == 1,
    }


def main():
    if len(sys.argv) != 2:
        print("Usage: analyze_beats.py /path/to/audio", file=sys.stderr)
        return 2

    audio_path = sys.argv[1]

    from madmom.features.downbeats import (  # pylint: disable=import-error
        DBNDownBeatTrackingProcessor,
        RNNDownBeatProcessor,
    )

    beats_per_bar = parse_beats_per_bar()
    activations = RNNDownBeatProcessor()(audio_path)
    detected = DBNDownBeatTrackingProcessor(
        beats_per_bar=beats_per_bar,
        fps=100,
    )(activations)
    beats = [beat for beat in (to_beat(row) for row in detected) if beat]

    json.dump(
        {
            "beats": beats,
            "beatsPerBar": beats_per_bar,
            "source": "madmom",
        },
        sys.stdout,
        separators=(",", ":"),
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
