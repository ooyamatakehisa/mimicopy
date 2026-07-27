from pathlib import Path
from tempfile import TemporaryDirectory
from unittest import TestCase

import numpy as np

from app.main import SeparationProgressStore, resolve_media_file
from app.separator import (
    CHUNK_SAMPLES,
    SILENCE_RMS_THRESHOLD,
    STEM_NAMES,
    estimate_remaining_seconds,
    is_effectively_silent,
    select_target_and_remainder_spectra,
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

    def test_estimates_remaining_time_from_completed_segments(self) -> None:
        self.assertEqual(
            estimate_remaining_seconds(12.0, 3, 8),
            20.0,
        )
        self.assertEqual(
            estimate_remaining_seconds(12.0, 8, 8),
            0.0,
        )
        self.assertIsNone(estimate_remaining_seconds(0.0, 0, 8))

    def test_tracks_progress_for_the_active_separation(self) -> None:
        progress_store = SeparationProgressStore()
        progress_store.begin("track-guitar.mp3")
        progress_store.update("track-guitar.mp3", 2, 5, 18.5)

        progress = progress_store.get("track-guitar.mp3")

        self.assertIsNotNone(progress)
        assert progress is not None
        self.assertEqual(progress.completed_segments, 2)
        self.assertEqual(progress.total_segments, 5)
        self.assertEqual(progress.estimated_remaining_seconds, 18.5)

    def test_sums_every_non_target_model_output(self) -> None:
        real = np.arange(len(STEM_NAMES), dtype=np.float32).reshape(
            (len(STEM_NAMES), 1, 1, 1)
        )
        imag = real + 10

        target, remainder = select_target_and_remainder_spectra(
            real, imag, STEM_NAMES.index("guitar")
        )

        np.testing.assert_array_equal(target, np.array([[[4 + 14j]]]))
        np.testing.assert_array_equal(
            remainder,
            np.array([[[11 + 61j]]]),
        )
