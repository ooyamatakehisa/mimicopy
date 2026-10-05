import { vi } from "vitest";

type WorkletInstance = {
  port: {
    onmessage: ((message: MessageEvent<unknown>) => void) | null;
    postMessage: ReturnType<typeof vi.fn>;
  };
  process(inputs: Float32Array[][], outputs: Float32Array[][], parameters: Record<string, Float32Array>): boolean;
};
type WorkletConstructor = {
  new(options: { processorOptions: { latencySeconds: number } }): WorkletInstance;
  parameterDescriptors: { name: string; defaultValue: number; automationRate: string }[];
};

describe("click cue AudioWorklet boundary", () => {
  let Worklet: WorkletConstructor;
  let worklet: WorkletInstance;

  beforeAll(async () => {
    vi.stubGlobal("sampleRate", 48_000);
    vi.stubGlobal("AudioWorkletProcessor", class {
      port = { onmessage: null, postMessage: vi.fn() };
    });
    vi.stubGlobal("registerProcessor", (name: string, implementation: WorkletConstructor) => {
      expect(name).toBe("mimicopy-click-cue");
      Worklet = implementation;
    });
    await import("./clickCueProcessor.worklet");
  });

  afterAll(() => { vi.unstubAllGlobals(); });

  beforeEach(() => {
    worklet = new Worklet({ processorOptions: { latencySeconds: 0.12 } });
  });

  function command(data: unknown) {
    worklet.port.onmessage?.(new MessageEvent("message", { data }));
  }

  function block({ normal = new Float32Array(128), downbeat = new Float32Array(128),
    enabled = new Float32Array([1]) }: { normal?: Float32Array; downbeat?: Float32Array; enabled?: Float32Array } = {}) {
    const left = new Float32Array(128);
    const right = new Float32Array(128);
    expect(worklet.process([[normal, downbeat]], [[left, right]], { enabled })).toBe(true);
    expect(left).toEqual(right);
    return left;
  }

  function pulse(frames = 48) {
    const cue = new Float32Array(128);
    cue.fill(1, 0, frames);
    return cue;
  }

  function drain() {
    const output = new Float32Array(12_800);
    for (let index = 0; index < 100; index += 1) output.set(block(), index * 128);
    return output;
  }

  it("requires the command gate as well as the AudioParam and starts disabled", () => {
    expect(Worklet.parameterDescriptors).toEqual([
      { name: "enabled", defaultValue: 0, minValue: 0, maxValue: 1, automationRate: "a-rate" }
    ]);
    block({ normal: pulse() });
    expect(drain().every((sample) => sample === 0)).toBe(true);
    command({ type: "set-enabled", enabled: true });
    block({ normal: pulse() });
    expect(drain().some((sample) => sample !== 0)).toBe(true);
  });

  it("does not erase a queued cue when an already applied enable command arrives late", () => {
    command({ type: "set-enabled", enabled: true });
    block({ normal: pulse() });
    command({ type: "set-enabled", enabled: true });
    const output = drain();
    expect(output.findIndex((sample) => Math.abs(sample) > 0.000001)).toBe(5761 - 128);
  });

  it("keeps future cue events through an off/on pair between render quanta", () => {
    command({ type: "set-enabled", enabled: true });
    block({ normal: pulse(128) });
    command({ type: "set-enabled", enabled: false });
    command({ type: "set-enabled", enabled: true });
    block({ normal: pulse(64) });
    expect(drain().findIndex((sample) => Math.abs(sample) > 0.000001)).toBe(5761 - 256);
  });

  it("clears an active tone on an off/on pair between render quanta", () => {
    worklet = new Worklet({ processorOptions: { latencySeconds: 0 } });
    command({ type: "set-enabled", enabled: true });
    expect(block({ normal: pulse(128) }).some((sample) => sample !== 0)).toBe(true);
    command({ type: "set-enabled", enabled: false });
    command({ type: "set-enabled", enabled: true });
    block({ normal: pulse(64) });
    expect(drain().every((sample) => sample === 0)).toBe(true);
  });

  it("plays a future event detected before either enable gate opened", () => {
    block({ normal: pulse(), enabled: new Float32Array([0]) });
    command({ type: "set-enabled", enabled: true });
    expect(drain().findIndex((sample) => Math.abs(sample) > 0.000001)).toBe(5761 - 128);
  });

  it("gates individual output samples before the disable command arrives", () => {
    worklet = new Worklet({ processorOptions: { latencySeconds: 0 } });
    command({ type: "set-enabled", enabled: true });
    const enabled = new Float32Array(128);
    enabled.fill(1, 0, 64);
    const output = block({ normal: pulse(), enabled });
    expect(output.subarray(0, 64).some((sample) => sample !== 0)).toBe(true);
    expect(output.subarray(64).every((sample) => sample === 0)).toBe(true);
    command({ type: "set-enabled", enabled: false });
    command({ type: "set-enabled", enabled: true });
    expect(drain().every((sample) => sample === 0)).toBe(true);
  });

  it("acknowledges prepare only after clearing state and keeps the enable preference", () => {
    command({ type: "set-enabled", enabled: true });
    block({ downbeat: pulse() });
    command({ type: "prepare", id: 7 });
    expect(worklet.port.postMessage).toHaveBeenCalledExactlyOnceWith({ type: "prepared", id: 7 });
    expect(drain().every((sample) => sample === 0)).toBe(true);
    block({ downbeat: pulse() });
    expect(drain().some((sample) => sample !== 0)).toBe(true);
  });
});
