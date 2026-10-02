import unittest

from analyze_beats import build_beat_grid


class BeatGridTests(unittest.TestCase):
    def test_variable_meter_and_pickup(self):
        grid = build_beat_grid(range(12), [2, 6, 9])
        self.assertEqual(grid["source"], "beat-this")
        self.assertEqual(grid["beatsPerBar"], [3, 4])
        self.assertEqual([beat["position"] for beat in grid["beats"]], [3, 4, 1, 2, 3, 4, 1, 2, 3, 1, 2, 3])
        self.assertEqual([beat["time"] for beat in grid["beats"] if beat["isDownbeat"]], [2, 6, 9])

    def test_no_downbeats_does_not_invent_accents_or_meter(self):
        grid = build_beat_grid([0.1, 0.6, 1.1], [])
        self.assertEqual(grid["beatsPerBar"], [])
        self.assertFalse(any(beat["isDownbeat"] for beat in grid["beats"]))
        self.assertEqual([beat["position"] for beat in grid["beats"]], [2, 3, 4])

    def test_single_downbeat_does_not_invent_meter(self):
        grid = build_beat_grid([0, 1, 2], [1])
        self.assertEqual(grid["beatsPerBar"], [])
        self.assertEqual([beat["position"] for beat in grid["beats"]], [2, 1, 2])

    def test_long_intro_does_not_invent_downbeats(self):
        grid = build_beat_grid(range(14), [6, 10])
        self.assertEqual([beat["time"] for beat in grid["beats"] if beat["isDownbeat"]], [6, 10])
        self.assertEqual(grid["beatsPerBar"], [4])

    def test_empty_predictions(self):
        self.assertEqual(build_beat_grid([], []), {"beats": [], "beatsPerBar": [], "source": "beat-this", "model": "final0", "postprocessor": "dbn"})

    def test_invalid_predictions(self):
        for beats, downbeats in [([float("nan")], []), ([-1], []), ([1, 0], []), ([1, 1], []), ([0, 1], [0.5]), ([0, 1], [1, 0])]:
            with self.subTest(beats=beats, downbeats=downbeats), self.assertRaises(ValueError):
                build_beat_grid(beats, downbeats)


if __name__ == "__main__":
    unittest.main()
