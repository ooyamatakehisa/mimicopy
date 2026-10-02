#!/usr/bin/env python3
"""Exercise real MP3 decoding, final0 inference and DBN without external audio."""
import json
import math
from pathlib import Path
import struct
import subprocess
import sys
import tempfile
import wave


def create_rhythm_mp3(destination):
    sample_rate = 22050
    with tempfile.TemporaryDirectory() as directory:
        wav_path = Path(directory) / "rhythm.wav"
        with wave.open(str(wav_path), "wb") as audio:
            audio.setnchannels(1)
            audio.setsampwidth(2)
            audio.setframerate(sample_rate)
            samples = bytearray()
            for index in range(sample_rate * 16):
                time = index / sample_rate
                beat = int(time * 2)
                phase = time % 0.5
                # Kick/snare pulses plus a quieter eighth-note hi-hat.
                frequency = 65 if beat % 2 == 0 else 180
                pulse = math.sin(2 * math.pi * frequency * phase) * math.exp(-phase * 28)
                hat_phase = time % 0.25
                hat = math.sin(2 * math.pi * 6500 * hat_phase) * math.exp(-hat_phase * 130)
                accent = 0.8 if beat % 4 == 0 else 0.6
                samples.extend(struct.pack("<h", int(28000 * (accent * pulse + 0.12 * hat))))
            audio.writeframes(samples)
        subprocess.run([
            "ffmpeg", "-v", "error", "-y", "-i", str(wav_path),
            "-codec:a", "libmp3lame", str(destination),
        ], check=True)


def main():
    with tempfile.TemporaryDirectory() as directory:
        audio_path = Path(directory) / "rhythm.mp3"
        create_rhythm_mp3(audio_path)
        result = subprocess.run([
            sys.executable, str(Path(__file__).with_name("analyze_beats.py")), str(audio_path),
        ], capture_output=True, text=True, timeout=180)
        if result.returncode:
            print(result.stderr, file=sys.stderr)
            result.check_returncode()
        grid = json.loads(result.stdout)
        assert grid["source"] == "beat-this"
        assert grid["model"] == "final0"
        assert grid["postprocessor"] == "dbn"
        assert len(grid["beats"]) >= 8, grid
        assert any(beat["isDownbeat"] for beat in grid["beats"]), grid
        assert set(grid["beatsPerBar"]).issubset({3, 4}), grid
        assert grid["beatsPerBar"], grid
        assert all(0 <= beat["time"] <= 16 for beat in grid["beats"]), grid
        print(json.dumps({"source": grid["source"], "model": grid["model"],
                          "postprocessor": grid["postprocessor"], "beats": len(grid["beats"]),
                          "downbeats": sum(beat["isDownbeat"] for beat in grid["beats"])}))


if __name__ == "__main__":
    main()
