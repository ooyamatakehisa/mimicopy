from __future__ import annotations

import os
import subprocess
import tempfile
import time
from pathlib import Path
from typing import Final

import numpy as np
import soundfile as sf
from openvino import CompiledModel, Core


SAMPLE_RATE: Final = 44_100
CHUNK_SAMPLES: Final = 176_400
N_FFT: Final = 2_048
HOP_LENGTH: Final = 512
NUM_CHANNELS: Final = 2
SILENCE_RMS_THRESHOLD: Final = 1e-5
STEM_NAMES: Final = ("bass", "drums", "other", "vocals", "guitar", "piano")


def periodic_hann(length: int) -> np.ndarray:
    indices = np.arange(length, dtype=np.float32)
    return (0.5 * (1.0 - np.cos((2.0 * np.pi * indices) / length))).astype(
        np.float32
    )


def stft_stereo(audio: np.ndarray, window: np.ndarray) -> np.ndarray:
    if audio.shape != (CHUNK_SAMPLES, NUM_CHANNELS):
        raise ValueError(f"Unexpected chunk shape: {audio.shape}")

    pad = N_FFT // 2
    planar = np.ascontiguousarray(audio.T, dtype=np.float32)
    padded = np.pad(planar, ((0, 0), (pad, pad)), mode="reflect")
    frames = np.lib.stride_tricks.sliding_window_view(
        padded, window_shape=N_FFT, axis=1
    )[:, ::HOP_LENGTH, :]
    expected_frames = (CHUNK_SAMPLES // HOP_LENGTH) + 1
    frames = frames[:, :expected_frames, :]
    spectrum = np.fft.rfft(frames * window[None, None, :], axis=-1)
    return np.ascontiguousarray(
        spectrum.transpose(0, 2, 1).astype(np.complex64, copy=False)
    )


def istft_target(spectrum: np.ndarray, window: np.ndarray) -> np.ndarray:
    expected_shape = (
        NUM_CHANNELS,
        (N_FFT // 2) + 1,
        (CHUNK_SAMPLES // HOP_LENGTH) + 1,
    )
    if spectrum.shape != expected_shape:
        raise ValueError(
            f"Unexpected output spectrum shape: {spectrum.shape}; "
            f"expected {expected_shape}"
        )

    frames = np.fft.irfft(spectrum.transpose(0, 2, 1), n=N_FFT, axis=-1)
    frames = frames.astype(np.float32, copy=False)
    frames *= window[None, None, :]

    frame_count = frames.shape[1]
    padded_length = ((frame_count - 1) * HOP_LENGTH) + N_FFT
    reconstructed = np.zeros(
        (NUM_CHANNELS, padded_length), dtype=np.float32
    )
    window_sum = np.zeros(padded_length, dtype=np.float32)
    window_squared = window * window

    for frame_index in range(frame_count):
        start = frame_index * HOP_LENGTH
        reconstructed[:, start : start + N_FFT] += frames[:, frame_index, :]
        window_sum[start : start + N_FFT] += window_squared

    nonzero = window_sum > 1e-8
    reconstructed[:, nonzero] /= window_sum[nonzero]
    pad = N_FFT // 2
    return reconstructed[:, pad : pad + CHUNK_SAMPLES]


def segment_starts(sample_count: int, overlap_samples: int) -> list[int]:
    if sample_count <= CHUNK_SAMPLES:
        return [0]

    step = CHUNK_SAMPLES - overlap_samples
    final_start = sample_count - CHUNK_SAMPLES
    starts = list(range(0, final_start + 1, step))
    if starts[-1] == final_start:
        return starts

    final_gap = final_start - starts[-1]
    if len(starts) > 1 and final_gap < overlap_samples:
        starts[-1] = final_start
    else:
        starts.append(final_start)
    return starts


def make_fades(overlap_samples: int) -> tuple[np.ndarray, np.ndarray]:
    if overlap_samples == 0:
        empty = np.empty(0, dtype=np.float32)
        return empty, empty

    fade_in = np.arange(overlap_samples, dtype=np.float32) / overlap_samples
    return fade_in, 1.0 - fade_in


def is_effectively_silent(audio: np.ndarray) -> bool:
    squared = np.square(audio, dtype=np.float64)
    rms = float(np.sqrt(np.mean(squared)))
    return rms < SILENCE_RMS_THRESHOLD


def run_ffmpeg(arguments: list[str]) -> None:
    completed = subprocess.run(
        ["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", *arguments],
        check=False,
        capture_output=True,
        text=True,
    )
    if completed.returncode != 0:
        raise RuntimeError(
            completed.stderr.strip()
            or f"ffmpeg exited with code {completed.returncode}"
        )


def decode_audio(input_path: Path, working_dir: Path) -> np.ndarray:
    decoded_path = working_dir / "decoded.wav"
    run_ffmpeg(
        [
            "-i",
            str(input_path),
            "-vn",
            "-ar",
            str(SAMPLE_RATE),
            "-ac",
            str(NUM_CHANNELS),
            "-c:a",
            "pcm_f32le",
            str(decoded_path),
        ]
    )
    audio, sample_rate = sf.read(
        decoded_path, dtype="float32", always_2d=True
    )
    if sample_rate != SAMPLE_RATE or audio.shape[1] != NUM_CHANNELS:
        raise RuntimeError(
            f"Decoded audio has unexpected format: "
            f"{sample_rate} Hz, {audio.shape[1]} channels."
        )
    return np.ascontiguousarray(audio, dtype=np.float32)


def encode_mp3(audio: np.ndarray, output_path: Path, working_dir: Path) -> None:
    wav_path = working_dir / "separated.wav"
    partial_path = output_path.with_suffix(f"{output_path.suffix}.partial")
    sf.write(wav_path, audio.T, SAMPLE_RATE, subtype="FLOAT")
    try:
        run_ffmpeg(
            [
                "-i",
                str(wav_path),
                "-codec:a",
                "libmp3lame",
                "-b:a",
                "192k",
                "-f",
                "mp3",
                str(partial_path),
            ]
        )
        os.replace(partial_path, output_path)
    finally:
        partial_path.unlink(missing_ok=True)


class StemSeparator:
    def __init__(
        self,
        *,
        cache_dir: Path,
        device: str,
        inference_precision: str,
        model_path: Path,
        overlap: float,
    ) -> None:
        if not 0.0 <= overlap <= 0.5:
            raise ValueError("Overlap must be between 0 and 0.5.")

        self.overlap = overlap
        self.window = periodic_hann(N_FFT)
        core = Core()
        if device not in core.available_devices and not any(
            available.startswith(f"{device}.")
            for available in core.available_devices
        ):
            raise RuntimeError(
                f"Requested OpenVINO device {device!r} is unavailable; "
                f"available devices: {core.available_devices}"
            )

        cache_dir.mkdir(parents=True, exist_ok=True)
        core.set_property({"CACHE_DIR": str(cache_dir)})
        model = core.read_model(model_path)
        self.core = core
        self.model_path = model_path
        self.fallback_compiled: CompiledModel | None = None
        self.fallback_enabled = inference_precision.lower() != "f32"
        self.compiled = core.compile_model(
            model,
            device,
            {
                "INFERENCE_PRECISION_HINT": inference_precision,
                "PERFORMANCE_HINT": "LATENCY",
            },
        )
        self.device = device

    def _get_fallback_compiled(self) -> CompiledModel:
        if self.fallback_compiled is None:
            print(
                "Compiling FP32 fallback model after non-finite FP16 output.",
                flush=True,
            )
            model = self.core.read_model(self.model_path)
            self.fallback_compiled = self.core.compile_model(
                model,
                self.device,
                {
                    "INFERENCE_PRECISION_HINT": "f32",
                    "PERFORMANCE_HINT": "LATENCY",
                },
            )
        return self.fallback_compiled

    @classmethod
    def from_environment(cls) -> "StemSeparator":
        return cls(
            cache_dir=Path(
                os.environ.get(
                    "MIMICOPY_STEM_OPENVINO_CACHE_DIR",
                    "/data/openvino-cache",
                )
            ),
            device=os.environ.get("MIMICOPY_STEM_DEVICE", "GPU"),
            inference_precision=os.environ.get(
                "MIMICOPY_STEM_INFERENCE_PRECISION", "f16"
            ),
            model_path=Path(
                os.environ.get(
                    "MIMICOPY_STEM_MODEL_PATH",
                    "/data/models/bs_roformer_sw_6stem_fp16.onnx",
                )
            ),
            overlap=float(os.environ.get("MIMICOPY_STEM_OVERLAP", "0.25")),
        )

    def separate_file(
        self,
        *,
        input_path: Path,
        output_path: Path,
        target_stem: str,
    ) -> float:
        if target_stem not in STEM_NAMES:
            raise ValueError(f"Unsupported target stem: {target_stem}")

        started = time.monotonic()
        output_path.parent.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(
            prefix="mimicopy-separation-", dir=output_path.parent
        ) as directory:
            working_dir = Path(directory)
            audio = decode_audio(input_path, working_dir)
            separated = self._separate_target(audio, target_stem)
            if not np.isfinite(separated).all():
                raise RuntimeError("Separated audio contains NaN or Inf values.")
            encode_mp3(separated, output_path, working_dir)

        return time.monotonic() - started

    def _separate_target(
        self, audio: np.ndarray, target_stem: str
    ) -> np.ndarray:
        target_index = STEM_NAMES.index(target_stem)
        overlap_samples = int(CHUNK_SAMPLES * self.overlap)
        sample_count = audio.shape[0]
        starts = segment_starts(sample_count, overlap_samples)
        output = np.zeros((NUM_CHANNELS, sample_count), dtype=np.float32)

        for segment_index, start in enumerate(starts):
            segment_started = time.monotonic()
            length = min(CHUNK_SAMPLES, sample_count - start)
            source_chunk = audio[start : start + length]
            if length < CHUNK_SAMPLES:
                chunk = np.pad(
                    source_chunk,
                    ((0, CHUNK_SAMPLES - length), (0, 0)),
                    mode="reflect" if length > 1 else "edge",
                )
            else:
                chunk = source_chunk

            if is_effectively_silent(chunk):
                separated = np.zeros(
                    (NUM_CHANNELS, CHUNK_SAMPLES), dtype=np.float32
                )
                segment_result = "silent segment skipped"
            else:
                spectrum = stft_stereo(
                    np.ascontiguousarray(chunk, dtype=np.float32),
                    self.window,
                )
                model_inputs = {
                    "spec_imag": np.ascontiguousarray(
                        spectrum.imag[None], dtype=np.float32
                    ),
                    "spec_real": np.ascontiguousarray(
                        spectrum.real[None], dtype=np.float32
                    ),
                }

                def infer_target(
                    compiled: CompiledModel,
                ) -> tuple[np.ndarray, np.ndarray]:
                    result = compiled(model_inputs)
                    result_by_name = {
                        model_output.get_any_name(): np.asarray(value)
                        for model_output, value in result.items()
                    }
                    return (
                        result_by_name["out_spec_real"][0, target_index],
                        result_by_name["out_spec_imag"][0, target_index],
                    )

                real, imag = infer_target(self.compiled)
                spectrum_is_finite = bool(
                    np.isfinite(real).all() and np.isfinite(imag).all()
                )
                used_fallback = False
                if not spectrum_is_finite and self.fallback_enabled:
                    print(
                        f"{target_stem} segment "
                        f"{segment_index + 1}/{len(starts)} produced "
                        "non-finite FP16 output; retrying with FP32.",
                        flush=True,
                    )
                    real, imag = infer_target(self._get_fallback_compiled())
                    spectrum_is_finite = bool(
                        np.isfinite(real).all()
                        and np.isfinite(imag).all()
                    )
                    used_fallback = True

                if not spectrum_is_finite:
                    raise RuntimeError(
                        f"Segment {segment_index + 1}/{len(starts)} "
                        "produced non-finite spectrum values after "
                        "FP32 fallback."
                    )

                separated = istft_target(
                    real.astype(np.float32, copy=False)
                    + (1j * imag.astype(np.float32, copy=False)),
                    self.window,
                )
                segment_result = (
                    "completed with FP32 fallback"
                    if used_fallback
                    else "completed"
                )
            weights = np.ones(length, dtype=np.float32)
            if segment_index > 0:
                previous_end = starts[segment_index - 1] + CHUNK_SAMPLES
                previous_overlap = max(0, previous_end - start)
                if previous_overlap:
                    fade_in, _ = make_fades(previous_overlap)
                    weights[:previous_overlap] = fade_in
            if segment_index < len(starts) - 1:
                next_start = starts[segment_index + 1]
                next_overlap = max(0, start + CHUNK_SAMPLES - next_start)
                if next_overlap:
                    _, fade_out = make_fades(next_overlap)
                    weights[length - next_overlap :] = fade_out

            output[:, start : start + length] += (
                separated[:, :length] * weights[None, :]
            )
            print(
                f"{target_stem} segment {segment_index + 1}/{len(starts)} "
                f"{segment_result} in "
                f"{time.monotonic() - segment_started:.3f}s",
                flush=True,
            )

        return output
