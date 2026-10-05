import { ClickCueDsp } from "./clickCueDsp";

// lib.dom does not describe the AudioWorkletGlobalScope. Keep its small native
// boundary here; the DSP itself remains ordinary, strictly checked TypeScript.
declare const sampleRate: number;
declare class AudioWorkletProcessor {
  readonly port: MessagePort;
}
declare function registerProcessor(name: string, processor: typeof ClickCueWorklet): void;

type ClickCueOptions = { processorOptions?: { latencySeconds?: number } };

class ClickCueWorklet extends AudioWorkletProcessor {
  private readonly dsp: ClickCueDsp;
  private enabled = false;

  static get parameterDescriptors() {
    return [{ name: "enabled", defaultValue: 0, minValue: 0, maxValue: 1, automationRate: "a-rate" }];
  }

  constructor(options: ClickCueOptions) {
    super();
    this.dsp = new ClickCueDsp(sampleRate, options.processorOptions?.latencySeconds ?? 0);
    this.port.onmessage = ({ data }: MessageEvent<unknown>) => {
      if (typeof data !== "object" || data === null || !("type" in data)) return;
      if (data.type === "set-enabled" && "enabled" in data && typeof data.enabled === "boolean") {
        this.enabled = data.enabled;
        this.dsp.setEnabled(data.enabled);
      }
      if (data.type === "prepare" && "id" in data && typeof data.id === "number") {
        this.dsp.reset();
        this.port.postMessage({ type: "prepared", id: data.id });
      }
    };
  }

  process(inputs: Float32Array[][], outputs: Float32Array[][], parameters: Record<string, Float32Array>) {
    const left = outputs[0]?.[0];
    const right = outputs[0]?.[1];
    if (!left) return true;
    const normal = inputs[0]?.[0];
    const downbeat = inputs[0]?.[1];
    const enabled = parameters.enabled;
    for (let frame = 0; frame < left.length; frame += 1) {
      const gate = enabled?.[enabled.length === 1 ? 0 : frame] ?? 0;
      const click = this.dsp.processSample(normal?.[frame] ?? 0, downbeat?.[frame] ?? 0, this.enabled && gate >= 0.5);
      left[frame] = click;
      if (right) right[frame] = click;
    }
    return true;
  }
}

registerProcessor("mimicopy-click-cue", ClickCueWorklet);
