from pathlib import Path
from tempfile import TemporaryDirectory
from unittest import TestCase

import numpy as np

from app.main import resolve_media_file
from app.separator import (
    CHUNK_SAMPLES,
    SILENCE_RMS_THRESHOLD,
    is_effectively_silent,
    segment_starts,
)


class ServiceHelpersTest(TestCase):
    def test_resolves_only_plain_mp3_filenames(self) -> None:
        with TemporaryDirectory() as directory:
            media_dir = Path(directory).resolve()

            self.assertEqual(
                resolve_media_file(media_dir, "track-guitar.mp3"),
                media_dir / "track-guitar.mp3",
            )
            with self.assertRaises(ValueError):
                resolve_media_file(media_dir, "../track.mp3")
            with self.assertRaises(ValueError):
                resolve_media_file(media_dir, "track.wav")

    def test_aligns_the_last_segment_to_the_end_of_audio(self) -> None:
        overlap_samples = CHUNK_SAMPLES // 4
        sample_count = CHUNK_SAMPLES * 2
        starts = segment_starts(sample_count, overlap_samples)

        self.assertEqual(starts[0], 0)
        self.assertEqual(starts[-1], sample_count - CHUNK_SAMPLES)

    def test_detects_only_audio_below_the_silence_threshold(self) -> None:
        silent = np.full(
            (CHUNK_SAMPLES, 2),
            SILENCE_RMS_THRESHOLD / 2,
            dtype=np.float32,
        )
        audible = np.full(
            (CHUNK_SAMPLES, 2),
            SILENCE_RMS_THRESHOLD * 2,
            dtype=np.float32,
        )

        self.assertTrue(is_effectively_silent(silent))
        self.assertFalse(is_effectively_silent(audible))
