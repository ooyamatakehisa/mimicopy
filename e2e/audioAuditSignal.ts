export type AudioAuditChannel = "original" | "stem" | "remainder";

export type StereoCarrierWindow = {
  offsetMs: number;
  bandRms: number;
  guardRms: number;
  referenceRms: number;
  prominenceDb: number | null;
  referenceCoherence: number | null;
};

export type StereoCarrierEvidence = {
  /** The original +/-45 Hz RMS threshold is unchanged. */
  rawCandidate: boolean;
  /** A short event may be diluted by the whole-capture average. */
  windowCandidate: boolean;
  classification: "below-threshold" | "carrier-like" | "broadband-candidate" | "unresolved";
  rawBandRms: number;
  guardRms: number;
  prominenceDb: number | null;
  corroboratedWindows: number;
  windows: StereoCarrierWindow[];
};

export type RetainedAudioPcm = {
  encoding: "float32-le-base64";
  frames: number;
  sampleRate: number;
  finalLeft: string;
  finalRight: string;
  postGain: Record<AudioAuditChannel, { left: string; right: string }>;
};

export type AudioAuditPair = {
  first: AudioAuditChannel;
  second: AudioAuditChannel;
  /** Positive means the second source's envelope arrives later in the output. */
  lagMs: number | null;
  peakCorrelation: number | null;
  zeroLagCorrelation: number | null;
  confidence: "high" | "low" | "unmeasurable";
  reason: string | null;
};

export type AudioMeasurement = {
  valid: boolean;
  error: string | null;
  sampleRate: number;
  frames: number;
  durationMs: number;
  blockDurationMs: number;
  envelopeEstimator?: "power-mean-4-v1";
  envelopePowerWindowFrames?: number;
  expectedPlaybackRate: number;
  transposeSemitones?: number;
  contextState: AudioContextState;
  rms: Record<AudioAuditChannel, number>;
  mixedRms: number;
  /** RMS within +/- 45 Hz of each source's carrier, measured in the actual mix. */
  mixedToneRms: Record<AudioAuditChannel, number>;
  stereo?: {
    left: Record<AudioAuditChannel, number>;
    right: Record<AudioAuditChannel, number>;
    rightCarriersInLeft: Record<AudioAuditChannel, number>;
    leftCarriersInRight: Record<AudioAuditChannel, number>;
  };
  stereoEvidence?: {
    detector: "guard-coherence-v1";
    candidateThresholdRms: number;
    minimumProminenceDb: number;
    minimumReferenceCoherence: number;
    rightCarriersInLeft: Record<AudioAuditChannel, StereoCarrierEvidence>;
    leftCarriersInRight: Record<AudioAuditChannel, StereoCarrierEvidence>;
  };
  retainedPcm?: RetainedAudioPcm;
  pairs: AudioAuditPair[];
};

export type AudioAuditStatus = {
  ready: boolean;
  contextState: AudioContextState | null;
  sourceLabels: string[];
  destinationConnections: number;
  errors: string[];
};

export type AudioAuditProbe = {
  status(): AudioAuditStatus;
  ready(): Promise<void>;
  capture(durationMs: number, expectedPlaybackRate?: number, transposeSemitones?: number, retainPcm?: boolean): Promise<AudioMeasurement>;
};

declare global {
  interface Window {
    __audioAuditProbe: AudioAuditProbe;
  }
}

/**
 * Install before the application module. This function is self-contained so it
 * can also be passed to Playwright addInitScript without bundling dependencies.
 * Playback, media time, mute and volume are never replaced or adjusted.
 */
export function installAudioAuditProbe(): void {
  if (window.__audioAuditProbe) return;

  const channelNames: AudioAuditChannel[] = ["original", "stem", "remainder"];
  const labels = ["Original audio", "Separated stem audio", "Separated remainder audio"];
  const frequencies = [375, 750, 1500];
  const rightFrequencies = [1875, 2250, 2625];
  const errors: string[] = [];
  const records = new Map<AudioContext, ContextRecord>();
  const nativeConnect = AudioNode.prototype.connect;
  const nativeDisconnect = AudioNode.prototype.disconnect;
  const mediaChannels = new WeakMap<AudioNode, number>();
  const sharedSplitters = new WeakSet<AudioNode>();
  let nextCaptureId = 0;
  let capturing = false;

  type RecordedCapture = {
    id: number;
    frames: number;
    blockSize: number;
    energies: Float32Array;
    mixed: Float32Array;
    left: Float32Array;
    right: Float32Array;
    sources: Float32Array[];
  };
  type ContextRecord = {
    context: AudioContext;
    sources: Map<number, AudioNode>;
    destinations: Map<AudioNode, Set<number>>;
    worklet: AudioWorkletNode | null;
    pending: Map<number, (data: RecordedCapture) => void>;
  };

  const workletCode = `
    class AuditRecorder extends AudioWorkletProcessor {
      constructor() {
        super();
        this.recording = null;
        this.port.onmessage = ({ data }) => {
          if (data.cancel) { this.recording = null; return; }
          this.recording = {
            id: data.id, remaining: data.frames, frames: 0,
            energies: [], mixed: [], left: [], right: [], sources: Array.from({ length: 6 }, () => []), blockSize: 128
          };
        };
      }
      process(inputs, outputs) {
        for (const output of outputs) for (const channel of output) channel.fill(0);
        const recording = this.recording;
        if (!recording) return true;
        const blockSize = outputs[0][0].length;
        recording.blockSize = blockSize;
        const count = Math.min(blockSize, recording.remaining);
        for (let input = 0; input < 4; input++) {
          const channels = inputs[input];
          let squares = 0;
          for (let frame = 0; frame < count; frame++) {
            let sample = 0;
            for (const channel of channels) sample += channel[frame] || 0;
            if (channels.length) sample /= channels.length;
            squares += sample * sample;
            if (input === 3) {
              recording.mixed.push(sample);
              recording.left.push(channels[0]?.[frame] || 0);
              recording.right.push((channels[1] || channels[0])?.[frame] || 0);
            } else {
              recording.sources[input * 2].push(channels[0]?.[frame] || 0);
              recording.sources[input * 2 + 1].push((channels[1] || channels[0])?.[frame] || 0);
            }
          }
          recording.energies.push(squares / count);
        }
        recording.frames += count;
        recording.remaining -= count;
        if (recording.remaining <= 0) {
          const energies = new Float32Array(recording.energies);
          const mixed = new Float32Array(recording.mixed);
          const left = new Float32Array(recording.left);
          const right = new Float32Array(recording.right);
          const sources = recording.sources.map((values) => new Float32Array(values));
          this.port.postMessage({
            id: recording.id, frames: recording.frames, blockSize: recording.blockSize,
            energies, mixed, left, right, sources
          }, [energies.buffer, mixed.buffer, left.buffer, right.buffer, ...sources.map((source) => source.buffer)]);
          this.recording = null;
        }
        return true;
      }
    }
    registerProcessor('mimicopy-audio-audit', AuditRecorder);
  `;

  const connectTap = (source: AudioNode, destination: AudioNode, output: number, input: number) => {
    Reflect.apply(nativeConnect, source, [destination, output, input]);
  };
  const attachTaps = (record: ContextRecord) => {
    if (!record.worklet) return;
    for (const [index, source] of record.sources) {
      connectTap(source, record.worklet, 0, index);
    }
    for (const [source, outputs] of record.destinations) {
      for (const output of outputs) connectTap(source, record.worklet, output, 3);
    }
  };
  const ensureRecord = (context: AudioContext): ContextRecord => {
    const existing = records.get(context);
    if (existing) return existing;
    const record: ContextRecord = {
      context, sources: new Map(), destinations: new Map(), worklet: null, pending: new Map()
    };
    records.set(context, record);
    const moduleUrl = URL.createObjectURL(new Blob([workletCode], { type: "text/javascript" }));
    void context.audioWorklet.addModule(moduleUrl).then(() => {
      if (context.state === "closed") return;
      const worklet = new AudioWorkletNode(context, "mimicopy-audio-audit", {
        numberOfInputs: 4,
        numberOfOutputs: 1,
        outputChannelCount: [1],
        channelCount: 2,
        channelCountMode: "explicit"
      });
      worklet.port.onmessage = (event: MessageEvent<RecordedCapture>) => {
        record.pending.get(event.data.id)?.(event.data);
      };
      record.worklet = worklet;
      // The recorder output is always zero. Keeping it connected makes WebKit
      // render the measurement branch without adding sound to the real output.
      connectTap(worklet, context.destination, 0, 0);
      attachTaps(record);
    }).catch((error: unknown) => {
      errors.push(error instanceof Error ? error.message : String(error));
    }).finally(() => URL.revokeObjectURL(moduleUrl));
    return record;
  };

  AudioNode.prototype.connect = function (
    this: AudioNode,
    destination: AudioNode | AudioParam,
    output = 0,
    input = 0
  ) {
    const result = Reflect.apply(nativeConnect, this,
      destination instanceof AudioNode ? [destination, output, input] : [destination, output]);
    if (mediaChannels.has(this) && typeof ChannelSplitterNode !== "undefined" &&
      destination instanceof ChannelSplitterNode && destination.numberOfOutputs === 6) {
      const record = ensureRecord(this.context as AudioContext);
      // A single six-channel media source feeds three stereo channel paths.
      // Discover those real paths rather than treating one clock as three clocks.
      for (const [index, source] of record.sources) {
        if (source === this) {
          if (record.worklet) {
            try { Reflect.apply(nativeDisconnect, source, [record.worklet, 0, index]); } catch { /* not attached */ }
          }
          record.sources.delete(index);
        }
      }
      sharedSplitters.add(destination);
    }
    if (sharedSplitters.has(this) && destination instanceof AudioNode) {
      mediaChannels.set(destination, Math.floor(output / 2));
    }
    const channel = mediaChannels.get(this);
    if (channel !== undefined && typeof GainNode !== "undefined" && destination instanceof GainNode) {
      const record = ensureRecord(this.context as AudioContext);
      const previous = record.sources.get(channel);
      if (previous !== destination) {
        if (previous && record.worklet) {
          try { Reflect.apply(nativeDisconnect, previous, [record.worklet, 0, channel]); } catch { /* not attached */ }
        }
        // Production channels use source -> gain -> shared effect. Measure the
        // channel after mute/solo/volume, never the pre-gain carrier.
        record.sources.set(channel, destination);
        if (record.worklet) connectTap(destination, record.worklet, 0, channel);
      }
    }
    if (destination === this.context.destination && "resume" in this.context) {
      const record = ensureRecord(this.context as AudioContext);
      let outputs = record.destinations.get(this);
      if (!outputs) {
        outputs = new Set();
        record.destinations.set(this, outputs);
      }
      outputs.add(output);
      if (record.worklet) connectTap(this, record.worklet, output, 3);
    }
    return result;
  } as AudioNode["connect"];

  AudioNode.prototype.disconnect = function (this: AudioNode, ...args: unknown[]) {
    Reflect.apply(nativeDisconnect, this, args);
    const record = records.get(this.context as AudioContext);
    const outputs = record?.destinations.get(this);
    if (!record || !outputs) return;
    const destination = args[0];
    if (args.length && typeof destination !== "number" && destination !== this.context.destination) return;
    const selectedOutput = typeof destination === "number" ? destination : args[1];
    for (const output of outputs) {
      if (typeof selectedOutput === "number" && selectedOutput !== output) continue;
      // Disconnect(destination) leaves our tee connected, so remove it too.
      if (destination === this.context.destination && record.worklet) {
        try { Reflect.apply(nativeDisconnect, this, [record.worklet, output, 3]); } catch { /* already detached */ }
      }
      outputs.delete(output);
    }
    if (!outputs.size) record.destinations.delete(this);
  } as AudioNode["disconnect"];

  const audioWindow = window as typeof window & { webkitAudioContext?: typeof AudioContext };
  for (const Context of new Set([window.AudioContext, audioWindow.webkitAudioContext])) {
    if (!Context) continue;
    const nativeCreate = Context.prototype.createMediaElementSource;
    Context.prototype.createMediaElementSource = function (element: HTMLMediaElement) {
      const source = nativeCreate.call(this, element);
      const index = labels.indexOf(element.getAttribute("aria-label") ?? "");
      if (index >= 0) {
        const record = ensureRecord(this);
        mediaChannels.set(source, index);
        record.sources.set(index, source);
        if (record.worklet) connectTap(source, record.worklet, 0, index);
      }
      return source;
    };
  }

  const currentRecord = () => [...records.values()].reverse().find(
    (record) => record.context.state !== "closed" && record.sources.size === 3
  );
  const status = (): AudioAuditStatus => {
    const record = currentRecord();
    return {
      ready: Boolean(record?.worklet && record.destinations.size),
      contextState: record?.context.state ?? null,
      sourceLabels: record ? [...record.sources.keys()].map((index) => labels[index]) : [],
      destinationConnections: record ? [...record.destinations.values()].reduce((sum, outputs) => sum + outputs.size, 0) : 0,
      errors: [...errors]
    };
  };
  const ready = async () => {
    const deadline = performance.now() + 10_000;
    while (!status().ready && performance.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    if (!status().ready) throw new Error(`Audio audit graph unavailable: ${JSON.stringify(status())}`);
  };

  // Hann-windowed FFT with Parseval scaling. Band energy remains useful when
  // preservePitch processing changes carrier phase or spreads it across bins.
  const toneRms = (samples: Float32Array, sampleRate: number, semitones: number, carriers = frequencies): number[] => {
    const outputFrequencies = carriers.map((frequency) => frequency * 2 ** (semitones / 12));
    const size = 4096;
    const energy = carriers.map(() => 0);
    let windows = 0;
    const real = new Float64Array(size);
    const imaginary = new Float64Array(size);
    for (let offset = 0; offset + size <= samples.length; offset += size / 2) {
      let windowSquares = 0;
      for (let index = 0; index < size; index += 1) {
        const weight = 0.5 - 0.5 * Math.cos(2 * Math.PI * index / (size - 1));
        real[index] = samples[offset + index] * weight;
        imaginary[index] = 0;
        windowSquares += weight * weight;
      }
      for (let index = 1, reverse = 0; index < size; index += 1) {
        let bit = size >> 1;
        for (; reverse & bit; bit >>= 1) reverse ^= bit;
        reverse ^= bit;
        if (index < reverse) {
          [real[index], real[reverse]] = [real[reverse], real[index]];
        }
      }
      for (let width = 2; width <= size; width *= 2) {
        const angle = -2 * Math.PI / width;
        for (let start = 0; start < size; start += width) {
          for (let index = 0; index < width / 2; index += 1) {
            const cosine = Math.cos(angle * index);
            const sine = Math.sin(angle * index);
            const other = start + index + width / 2;
            const a = real[other] * cosine - imaginary[other] * sine;
            const b = real[other] * sine + imaginary[other] * cosine;
            real[other] = real[start + index] - a;
            imaginary[other] = imaginary[start + index] - b;
            real[start + index] += a;
            imaginary[start + index] += b;
          }
        }
      }
      for (let tone = 0; tone < carriers.length; tone += 1) {
        for (let bin = 1; bin < size / 2; bin += 1) {
          if (Math.abs(bin * sampleRate / size - outputFrequencies[tone]) <= 45) {
            energy[tone] += 2 * (real[bin] ** 2 + imaginary[bin] ** 2) / (size * windowSquares);
          }
        }
      }
      windows += 1;
    }
    return energy.map((value) => windows ? Math.sqrt(value / windows) : 0);
  };

  type Spectrum = { offset: number; real: Float64Array; imaginary: Float64Array; scale: number };
  // Diagnostic windows also cover the trailing samples omitted by the original
  // whole-capture band estimator. Its raw RMS/candidate threshold stays intact.
  const spectra = (samples: Float32Array): Spectrum[] => {
    const size = 4096;
    const offsets: number[] = [];
    for (let offset = 0; offset + size <= samples.length; offset += size / 2) offsets.push(offset);
    const tail = samples.length - size;
    if (tail >= 0 && offsets.at(-1) !== tail) offsets.push(tail);
    return offsets.map((offset) => {
      const real = new Float64Array(size);
      const imaginary = new Float64Array(size);
      let windowSquares = 0;
      for (let index = 0; index < size; index++) {
        const weight = 0.5 - 0.5 * Math.cos(2 * Math.PI * index / (size - 1));
        real[index] = samples[offset + index] * weight;
        windowSquares += weight * weight;
      }
      for (let index = 1, reverse = 0; index < size; index++) {
        let bit = size >> 1;
        for (; reverse & bit; bit >>= 1) reverse ^= bit;
        reverse ^= bit;
        if (index < reverse) [real[index], real[reverse]] = [real[reverse], real[index]];
      }
      for (let width = 2; width <= size; width *= 2) {
        const angle = -2 * Math.PI / width;
        for (let start = 0; start < size; start += width) {
          for (let index = 0; index < width / 2; index++) {
            const cosine = Math.cos(angle * index), sine = Math.sin(angle * index);
            const other = start + index + width / 2;
            const a = real[other] * cosine - imaginary[other] * sine;
            const b = real[other] * sine + imaginary[other] * cosine;
            real[other] = real[start + index] - a;
            imaginary[other] = imaginary[start + index] - b;
            real[start + index] += a;
            imaginary[start + index] += b;
          }
        }
      }
      return { offset, real, imaginary, scale: 2 / (size * windowSquares) };
    });
  };

  const candidateThresholdRms = 0.00015;
  const minimumProminenceDb = 6;
  const minimumReferenceCoherence = 0.8;
  const prominence = (bandPower: number, guardPower: number) => bandPower > 0
    ? 10 * Math.log10(bandPower / Math.max(1e-30, guardPower)) : null;

  const carrierEvidence = (wrong: Spectrum[], reference: Spectrum[], rawBandRms: number,
    frequency: number, allFrequencies: number[], sampleRate: number): StereoCarrierEvidence => {
    const size = 4096;
    const band: number[] = [], guard: number[] = [];
    for (let bin = 1; bin < size / 2; bin++) {
      const hz = bin * sampleRate / size;
      const distance = Math.abs(hz - frequency);
      if (distance <= 45) band.push(bin);
      // Two flanking guards have the same total nominal bandwidth as the
      // carrier band. Exclude other expected carriers even after transposition.
      if (distance >= 75 && distance <= 120 &&
          allFrequencies.every((candidate) => Math.abs(hz - candidate) > 60)) guard.push(bin);
    }
    const windows: StereoCarrierWindow[] = wrong.map((spectrum, index) => {
      const other = reference[index];
      let bandPower = 0, referencePower = 0, guardPower = 0;
      let dotReal = 0, dotImaginary = 0;
      for (const bin of band) {
        const a = spectrum.real[bin], b = spectrum.imaginary[bin];
        const c = other.real[bin], d = other.imaginary[bin];
        bandPower += a * a + b * b;
        referencePower += c * c + d * d;
        dotReal += a * c + b * d;
        dotImaginary += b * c - a * d;
      }
      for (const bin of guard) guardPower += spectrum.real[bin] ** 2 + spectrum.imaginary[bin] ** 2;
      // Bin counts can differ by one at non-bin-centered/transposed frequencies.
      guardPower *= guard.length ? band.length / guard.length : 0;
      const referenceCoherence = bandPower > 0 && referencePower > 0
        ? Math.min(1, (dotReal * dotReal + dotImaginary * dotImaginary) / (bandPower * referencePower)) : null;
      return {
        offsetMs: spectrum.offset / sampleRate * 1000,
        bandRms: Math.sqrt(bandPower * spectrum.scale),
        guardRms: Math.sqrt(guardPower * spectrum.scale),
        referenceRms: Math.sqrt(referencePower * other.scale),
        prominenceDb: prominence(bandPower, guardPower), referenceCoherence
      };
    });
    const rawCandidate = rawBandRms > candidateThresholdRms;
    const windowCandidate = windows.some((window) => window.bandRms > candidateThresholdRms);
    const corroboratedWindows = windows.filter((window) =>
      window.bandRms > candidateThresholdRms && window.referenceRms > 0.0005 &&
      window.prominenceDb !== null && window.prominenceDb >= minimumProminenceDb &&
      window.referenceCoherence !== null && window.referenceCoherence >= minimumReferenceCoherence).length;
    const meanPower = (key: "bandRms" | "guardRms") => windows.length
      ? windows.reduce((sum, window) => sum + window[key] ** 2, 0) / windows.length : 0;
    const guardPower = meanPower("guardRms");
    const prominenceDb = prominence(meanPower("bandRms"), guardPower);
    // "Carrier-like" establishes narrow-band, reference-consistent energy,
    // not the physical cause. Harmonic distortion can share a carrier frequency.
    // Broadband candidates remain unresolved output artifacts, never passes.
    const classification = !rawCandidate && !windowCandidate ? "below-threshold"
      : corroboratedWindows ? "carrier-like"
      : windows.some((window) => window.bandRms > candidateThresholdRms &&
          window.guardRms > candidateThresholdRms / 2 &&
          window.prominenceDb !== null && window.prominenceDb < minimumProminenceDb)
        ? "broadband-candidate" : "unresolved";
    return { rawCandidate, windowCandidate, classification, rawBandRms,
      guardRms: Math.sqrt(guardPower), prominenceDb, corroboratedWindows, windows };
  };

  const encodePcm = (samples: Float32Array): string => {
    const bytes = new Uint8Array(samples.length * 4);
    const view = new DataView(bytes.buffer);
    for (let index = 0; index < samples.length; index++) view.setFloat32(index * 4, samples[index], true);
    let binary = "";
    for (let offset = 0; offset < bytes.length; offset += 8192) {
      binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
    }
    return btoa(binary);
  };

  const pairLag = (firstIndex: number, secondIndex: number, capture: RecordedCapture,
    sampleRate: number, sourceRms: number[], mixedTones: number[]): AudioAuditPair => {
    const base = { first: channelNames[firstIndex], second: channelNames[secondIndex] };
    if ([firstIndex, secondIndex].some((index) => sourceRms[index] < 0.0001 || mixedTones[index] < 0.0001)) {
      return { ...base, lagMs: null, peakCorrelation: null, zeroLagCorrelation: null,
        confidence: "unmeasurable", reason: "At least one source is silent in the source tap or final mix." };
    }
    const blockMs = capture.blockSize / sampleRate * 1000;
    // At 48 kHz, four 128-frame blocks cover 1/2/3/4 complete cycles of
    // the lowest source carrier at native .25/.5/.75/1x varispeed. Integrate
    // power before sqrt so carrier phase and stereo beat terms do not alias
    // into the shared envelope. Other sample rates are calibrated separately.
    // Keep the original one-block lag step; overlapping windows do not reduce
    // lag resolution. Partial windows/blocks must not distort the edges.
    const powerBlocks = 4;
    const completeBlocks = Math.min(Math.floor(capture.frames / capture.blockSize),
      Math.floor(capture.energies.length / 4));
    const length = completeBlocks - powerBlocks + 1;
    if (length < 1) {
      return { ...base, lagMs: null, peakCorrelation: null, zeroLagCorrelation: null,
        confidence: "unmeasurable", reason: "Insufficient complete power windows." };
    }
    const envelope = (channel: number) => Array.from({ length }, (_, index) => {
      let sum = 0;
      for (let offset = 0; offset < powerBlocks; offset += 1) {
        sum += capture.energies[(index + offset) * 4 + channel];
      }
      return Math.sqrt(sum / powerBlocks);
    });
    const first = envelope(firstIndex);
    const second = envelope(secondIndex);
    const maxLag = Math.min(Math.floor(250 / blockMs), Math.floor(length / 4));
    const correlations: { lag: number; correlation: number }[] = [];
    for (let lag = -maxLag; lag <= maxLag; lag += 1) {
      let a = 0, b = 0, aa = 0, bb = 0, ab = 0, count = 0;
      // Equal overlap at every candidate lag avoids spuriously winning at a
      // short, unusually well-correlated edge of the recording.
      for (let index = maxLag; index < length - maxLag; index += 1) {
        const x = first[index];
        const y = second[index + lag];
        a += x; b += y; aa += x * x; bb += y * y; ab += x * y; count += 1;
      }
      const denominator = Math.sqrt(Math.max(0, count * aa - a * a) * Math.max(0, count * bb - b * b));
      correlations.push({ lag, correlation: denominator > 1e-12 ? (count * ab - a * b) / denominator : -1 });
    }
    const best = correlations.reduce((a, b) => a.correlation > b.correlation ? a : b);
    const zero = correlations.find((candidate) => candidate.lag === 0)?.correlation ?? -1;
    const boundary = Math.abs(best.lag) === maxLag;
    const good = length * blockMs >= 700 && best.correlation >= 0.8 && !boundary;
    return {
      ...base,
      lagMs: good ? best.lag * blockMs : null,
      peakCorrelation: best.correlation,
      zeroLagCorrelation: zero,
      confidence: good ? "high" : "low",
      reason: good ? null : boundary ? "Best lag is at the +/- 250 ms search boundary." : "Insufficient duration or envelope correlation."
    };
  };

  const capture = async (durationMs: number, expectedPlaybackRate = 1, transposeSemitones = 0, retainPcm = false): Promise<AudioMeasurement> => {
    if (!Number.isFinite(durationMs) || durationMs < 100 || durationMs > 30_000) {
      throw new Error("Audio capture duration must be between 100 and 30000 ms.");
    }
    if (capturing) throw new Error("An audio audit capture is already running.");
    await ready();
    const record = currentRecord();
    if (!record?.worklet) throw new Error("Audio audit recorder disappeared.");
    if (record.context.state !== "running") throw new Error(`Audio context is ${record.context.state}; use the real play button first.`);
    capturing = true;
    attachTaps(record);
    const id = ++nextCaptureId;
    const sampleRate = record.context.sampleRate;
    let data: RecordedCapture;
    try {
      data = await new Promise<RecordedCapture>((resolve, reject) => {
        const timer = setTimeout(() => {
          record.pending.delete(id);
          record.worklet?.port.postMessage({ cancel: true });
          reject(new Error("Audio worklet did not finish its capture; the context may have stopped rendering."));
        }, durationMs + 10_000);
        record.pending.set(id, (value) => {
          clearTimeout(timer);
          record.pending.delete(id);
          resolve(value);
        });
        record.worklet?.port.postMessage({ id, frames: Math.ceil(durationMs * sampleRate / 1000) });
      });
    } finally {
      capturing = false;
    }
    const blocks = data.energies.length / 4;
    const rms = [0, 1, 2, 3].map((channel) => {
      let sum = 0;
      for (let block = 0; block < blocks; block += 1) {
        const frames = Math.min(data.blockSize, data.frames - block * data.blockSize);
        sum += data.energies[block * 4 + channel] * frames;
      }
      return Math.sqrt(sum / data.frames);
    });
    const mixed = toneRms(data.mixed, sampleRate, transposeSemitones);
    const levels = (values: number[]) => ({ original: values[0], stem: values[1], remainder: values[2] });
    const stereo = {
      left: levels(toneRms(data.left, sampleRate, transposeSemitones)),
      right: levels(toneRms(data.right, sampleRate, transposeSemitones, rightFrequencies)),
      rightCarriersInLeft: levels(toneRms(data.left, sampleRate, transposeSemitones, rightFrequencies)),
      leftCarriersInRight: levels(toneRms(data.right, sampleRate, transposeSemitones))
    };
    const leftSpectra = spectra(data.left), rightSpectra = spectra(data.right);
    const ratio = 2 ** (transposeSemitones / 12);
    const allFrequencies = [...frequencies, ...rightFrequencies].map((value) => value * ratio);
    const rightEvidence = rightFrequencies.map((value, index) => carrierEvidence(leftSpectra, rightSpectra,
      stereo.rightCarriersInLeft[channelNames[index]], value * ratio, allFrequencies, sampleRate));
    const leftEvidence = frequencies.map((value, index) => carrierEvidence(rightSpectra, leftSpectra,
      stereo.leftCarriersInRight[channelNames[index]], value * ratio, allFrequencies, sampleRate));
    const evidenceRecord = (values: StereoCarrierEvidence[]) => ({ original: values[0], stem: values[1], remainder: values[2] });
    const stereoEvidence: NonNullable<AudioMeasurement["stereoEvidence"]> = {
      detector: "guard-coherence-v1", candidateThresholdRms, minimumProminenceDb, minimumReferenceCoherence,
      rightCarriersInLeft: evidenceRecord(rightEvidence), leftCarriersInRight: evidenceRecord(leftEvidence)
    };
    const suspicious = [...rightEvidence, ...leftEvidence].some((evidence) => evidence.rawCandidate || evidence.windowCandidate);
    const retainedPcm: RetainedAudioPcm | undefined = retainPcm || suspicious ? {
      encoding: "float32-le-base64", frames: data.frames, sampleRate,
      finalLeft: encodePcm(data.left), finalRight: encodePcm(data.right),
      postGain: {
        original: { left: encodePcm(data.sources[0]), right: encodePcm(data.sources[1]) },
        stem: { left: encodePcm(data.sources[2]), right: encodePcm(data.sources[3]) },
        remainder: { left: encodePcm(data.sources[4]), right: encodePcm(data.sources[5]) }
      }
    } : undefined;
    return {
      valid: data.frames > 0 && record.context.state === "running",
      error: record.context.state === "running" ? null : "Audio context stopped during capture.",
      sampleRate,
      frames: data.frames,
      durationMs: data.frames / sampleRate * 1000,
      blockDurationMs: data.blockSize / sampleRate * 1000,
      envelopeEstimator: "power-mean-4-v1",
      envelopePowerWindowFrames: 4 * data.blockSize,
      expectedPlaybackRate,
      transposeSemitones,
      contextState: record.context.state,
      rms: { original: rms[0], stem: rms[1], remainder: rms[2] },
      mixedRms: rms[3],
      mixedToneRms: { original: mixed[0], stem: mixed[1], remainder: mixed[2] },
      stereo, stereoEvidence, ...(retainedPcm ? { retainedPcm } : {}),
      pairs: [[0, 1], [0, 2], [1, 2]].map(([first, second]) => pairLag(first, second, data, sampleRate, rms, mixed))
    };
  };
  window.__audioAuditProbe = { status, ready, capture };
}
