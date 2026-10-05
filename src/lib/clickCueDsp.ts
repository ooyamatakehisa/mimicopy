const cueThreshold = 0.5;
const cueReleaseThreshold = 0.1;
const envelopeFloor = 0.0001;
const waveTableSize = 4096;

function squareWaveTable(sampleRate: number, frequency: number) {
  const table = new Float32Array(waveTableSize + 1);
  let peak = 0;
  for (let frame = 0; frame < waveTableSize; frame += 1) {
    const phase = frame / waveTableSize * 2 * Math.PI;
    let sample = 0;
    for (let harmonic = 1; harmonic * frequency < sampleRate / 2; harmonic += 2) {
      sample += Math.sin(phase * harmonic) / harmonic;
    }
    table[frame] = sample;
    peak = Math.max(peak, Math.abs(sample));
  }
  if (peak > 0) {
    for (let frame = 0; frame < waveTableSize; frame += 1) table[frame] /= peak;
  }
  table[waveTableSize] = table[0];
  return table;
}

/** Sample-domain click synthesis. Cue samples never pass through to the output. */
export class ClickCueDsp {
  private readonly delayedCues: Uint8Array;
  private readonly normalWave: Float32Array;
  private readonly downbeatWave: Float32Array;
  private delayIndex = 0;
  private enabled = false;
  private armed = true;
  private clickAge = -1;
  private clickDurationFrames = 0;
  private clickFrequency = 0;
  private clickVolume = 0;
  private clickWave: Float32Array;

  constructor(private readonly sampleRate: number, latencySeconds: number) {
    if (!Number.isFinite(sampleRate) || sampleRate <= 0) throw new Error("Invalid click sample rate.");
    if (!Number.isFinite(latencySeconds) || latencySeconds < 0 || latencySeconds > 1) {
      throw new Error("Invalid click processing latency.");
    }
    this.delayedCues = new Uint8Array(Math.round(sampleRate * latencySeconds));
    // Generate once with odd partials strictly below Nyquist. Synthesizing at
    // the output rate preserves the click tone when native music slows down.
    this.normalWave = squareWaveTable(sampleRate, 1120);
    this.downbeatWave = squareWaveTable(sampleRate, 1760);
    this.clickWave = this.normalWave;
  }

  private clearTone() {
    this.clickAge = -1;
  }

  /** A transport discontinuity invalidates both buffered output and cue edges. */
  reset() {
    this.clearTone();
    this.delayedCues.fill(0);
    this.delayIndex = 0;
    this.armed = true;
  }

  /** Drop audible tails, retaining cues for music that has not reached output. */
  setEnabled(enabled: boolean) {
    if (enabled === this.enabled) return;
    this.enabled = enabled;
    this.clearTone();
  }

  processSample(normalCue: number, downbeatCue: number, enabled: boolean): number {
    this.setEnabled(enabled);
    const active = normalCue >= cueThreshold || downbeatCue >= cueThreshold;
    if (normalCue <= cueReleaseThreshold && downbeatCue <= cueReleaseThreshold) this.armed = true;
    let cue = 0;
    if (active && this.armed) {
      this.armed = false;
      cue = downbeatCue >= cueThreshold ? 2 : 1;
    }

    // Delay events, not synthesized audio: enabling during the music DSP's
    // latency window must still click for a beat that has not become audible.
    // Every due event is consumed even while disabled, so old beats never replay.
    let dueCue = cue;
    if (this.delayedCues.length > 0) {
      dueCue = this.delayedCues[this.delayIndex];
      this.delayedCues[this.delayIndex] = cue;
      this.delayIndex = (this.delayIndex + 1) % this.delayedCues.length;
    }
    if (!enabled) return 0;
    if (dueCue) {
      const downbeat = dueCue === 2;
      this.clickAge = 0;
      this.clickFrequency = downbeat ? 1760 : 1120;
      this.clickVolume = downbeat ? 0.14 : 0.075;
      this.clickWave = downbeat ? this.downbeatWave : this.normalWave;
      this.clickDurationFrames = Math.round(this.sampleRate * (downbeat ? 0.075 : 0.045));
    }
    let sample = 0;
    if (this.clickAge >= 0) {
      const time = this.clickAge / this.sampleRate;
      const duration = this.clickDurationFrames / this.sampleRate;
      const envelope = time < 0.002
        ? envelopeFloor * (this.clickVolume / envelopeFloor) ** (time / 0.002)
        : this.clickVolume * (envelopeFloor / this.clickVolume) ** ((time - 0.002) / (duration - 0.002));
      const phase = (time * this.clickFrequency % 1) * waveTableSize;
      const index = Math.floor(phase);
      const fraction = phase - index;
      const wave = this.clickWave[index] * (1 - fraction) + this.clickWave[index + 1] * fraction;
      sample = wave * envelope;
      this.clickAge += 1;
      if (this.clickAge >= this.clickDurationFrames) this.clickAge = -1;
    }
    return sample;
  }
}
