import { vi } from "vitest";
import type { StretchNode } from "signalsmith-stretch";
import {
  createPitchProcessor,
  getCompensationSemitones,
  type PitchProcessor
} from "./pitchProcessor";

const { factory } = vi.hoisted(() => ({
  factory: Object.assign(
    vi.fn<(context: AudioContext, options: AudioWorkletNodeOptions) => Promise<StretchNode>>(),
    { moduleUrl: undefined as string | undefined }
  )
}));

vi.mock("signalsmith-stretch", () => ({ default: factory }));
vi.mock("signalsmith-stretch?url", () => ({ default: "/assets/stretch-worklet.mjs" }));

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function createNode() {
  return Object.assign(new EventTarget(), {
    configure: vi.fn<StretchNode["configure"]>().mockResolvedValue(undefined),
    schedule: vi.fn<StretchNode["schedule"]>().mockResolvedValue(undefined),
    latency: vi.fn<StretchNode["latency"]>().mockResolvedValue(0.12),
    disconnect: vi.fn(),
    port: { close: vi.fn() }
  });
}

type MockNode = ReturnType<typeof createNode>;
type InitializationStage = "factory" | "configure" | "latency" | "schedule";

// The factory boundary is the only place that needs an actual AudioWorkletNode.
// These tests exercise its command/event contract without starting audio or WASM.
function asStretchNode(node: MockNode): StretchNode {
  return node as unknown as StretchNode;
}

function holdStage(stage: InitializationStage, node: MockNode) {
  switch (stage) {
    case "factory": {
      const waiting = deferred<StretchNode>();
      factory.mockReturnValueOnce(waiting.promise);
      return { resolve: () => waiting.resolve(asStretchNode(node)), reject: waiting.reject };
    }
    case "configure": {
      const waiting = deferred<void>();
      node.configure.mockReturnValueOnce(waiting.promise);
      return { resolve: () => waiting.resolve(), reject: waiting.reject };
    }
    case "latency": {
      const waiting = deferred<number>();
      node.latency.mockReturnValueOnce(waiting.promise);
      return { resolve: () => waiting.resolve(0.12), reject: waiting.reject };
    }
    case "schedule": {
      const waiting = deferred<unknown>();
      node.schedule.mockReturnValueOnce(waiting.promise);
      return { resolve: () => waiting.resolve(undefined), reject: waiting.reject };
    }
  }
}

describe("pitch compensation", () => {
  it.each([1, 0.75, 0.5, 0.25])("restores source pitch at %sx and keeps the requested transpose", (rate) => {
    for (const transpose of [-6, 0, 6]) {
      const correction = getCompensationSemitones(transpose, rate);
      const finalFrequency = 440 * rate * 2 ** (correction / 12);
      expect(finalFrequency).toBeCloseTo(440 * 2 ** (transpose / 12), 10);
    }
  });
});

describe("pitch processor lifecycle", () => {
  let node: MockNode;
  let controller: AbortController;
  let element: HTMLAudioElement;
  let requestedSemitones: number;
  let onError: ReturnType<typeof vi.fn<(error: Error) => void>>;
  const processors: PitchProcessor[] = [];

  function create() {
    return createPitchProcessor({
      context: new AudioContext(),
      element,
      semitones: () => requestedSemitones,
      signal: controller.signal,
      onError
    });
  }

  async function createReady() {
    const processor = await create();
    processors.push(processor);
    return processor;
  }

  beforeEach(() => {
    vi.useFakeTimers();
    factory.mockReset();
    node = createNode();
    factory.mockResolvedValue(asStretchNode(node));
    controller = new AbortController();
    element = document.createElement("audio");
    element.playbackRate = 0.5;
    requestedSemitones = -6;
    onError = vi.fn();
  });

  afterEach(() => {
    controller.abort();
    for (const processor of processors.splice(0)) processor.dispose();
    vi.useRealTimers();
  });

  it("initializes an explicit stereo worklet with the shipped module URL and compensated pitch", async () => {
    const processor = await createReady();
    expect(factory.moduleUrl).toBe("/assets/stretch-worklet.mjs");
    expect(factory).toHaveBeenCalledWith(expect.any(AudioContext), {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [2],
      channelCount: 2,
      channelCountMode: "explicit"
    });
    expect(node.configure).toHaveBeenCalledExactlyOnceWith({
      blockMs: 120, intervalMs: 30, splitComputation: false
    });
    expect(node.latency).toHaveBeenCalledOnce();
    expect(node.schedule).toHaveBeenCalledExactlyOnceWith({
      active: true, semitones: 6, tonalityHz: 0, formantCompensation: false
    });
    expect(processor.node).toBe(node);
    expect(processor.latencySeconds).toBe(0.12);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("waits for each initialization command before issuing the next", async () => {
    const configured = deferred<void>();
    const measured = deferred<number>();
    const scheduled = deferred<unknown>();
    node.configure.mockReturnValueOnce(configured.promise);
    node.latency.mockReturnValueOnce(measured.promise);
    node.schedule.mockReturnValueOnce(scheduled.promise);
    const ready = createReady();
    await vi.advanceTimersByTimeAsync(0);
    expect(node.configure).toHaveBeenCalledOnce();
    expect(node.latency).not.toHaveBeenCalled();
    configured.resolve();
    await vi.advanceTimersByTimeAsync(0);
    expect(node.latency).toHaveBeenCalledOnce();
    expect(node.schedule).not.toHaveBeenCalled();
    measured.resolve(0.12);
    await vi.advanceTimersByTimeAsync(0);
    expect(node.schedule).toHaveBeenCalledOnce();
    scheduled.resolve(undefined);
    await ready;
    expect(vi.getTimerCount()).toBe(0);
  });

  it("serializes reset and pitch updates and reads current settings when each command executes", async () => {
    const processor = await createReady();
    node.configure.mockClear();
    node.schedule.mockClear();
    const configured = deferred<void>();
    const firstSchedule = deferred<unknown>();
    node.configure.mockReturnValueOnce(configured.promise);
    node.schedule.mockReturnValueOnce(firstSchedule.promise);
    const prepare = processor.prepare();
    const update = processor.updatePitch();
    await vi.advanceTimersByTimeAsync(0);
    expect(node.configure).toHaveBeenCalledOnce();
    expect(node.schedule).not.toHaveBeenCalled();
    requestedSemitones = 6;
    element.playbackRate = 0.25;
    configured.resolve();
    await vi.advanceTimersByTimeAsync(0);
    expect(node.schedule).toHaveBeenCalledOnce();
    expect(node.schedule.mock.calls[0]?.[0].semitones).toBe(30);
    requestedSemitones = -6;
    element.playbackRate = 1;
    firstSchedule.resolve(undefined);
    await Promise.all([prepare, update]);
    expect(node.schedule).toHaveBeenCalledTimes(2);
    expect(node.schedule.mock.calls[1]?.[0].semitones).toBe(-6);
    expect(node.configure).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not begin a reset while an earlier pitch command is pending", async () => {
    const processor = await createReady();
    const scheduled = deferred<unknown>();
    node.schedule.mockReturnValueOnce(scheduled.promise);
    const update = processor.updatePitch();
    const prepare = processor.prepare();
    await vi.advanceTimersByTimeAsync(0);
    expect(node.configure).toHaveBeenCalledOnce();
    scheduled.resolve(undefined);
    await Promise.all([update, prepare]);
    expect(node.configure).toHaveBeenCalledTimes(2);
    expect(node.schedule).toHaveBeenCalledTimes(3);
  });

  it.each<InitializationStage>(["factory", "configure", "latency", "schedule"])(
    "bounds a hung %s command and disposes a node that becomes available late",
    async (stage) => {
      const waiting = holdStage(stage, node);
      const initialization = create();
      const rejected = expect(initialization).rejects.toThrow("音声処理の応答がありません");
      await vi.advanceTimersByTimeAsync(14_999);
      expect(node.disconnect).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      await rejected;
      if (stage === "factory") expect(node.disconnect).not.toHaveBeenCalled();
      else expect(node.disconnect).toHaveBeenCalledOnce();
      waiting.resolve();
      await vi.advanceTimersByTimeAsync(0);
      expect(node.disconnect).toHaveBeenCalledOnce();
      expect(node.port.close).toHaveBeenCalledOnce();
      expect(vi.getTimerCount()).toBe(0);
    }
  );

  it.each<InitializationStage>(["factory", "configure", "latency", "schedule"])(
    "propagates a %s rejection and releases owned resources",
    async (stage) => {
      const waiting = holdStage(stage, node);
      const failure = new Error(`${stage} failed`);
      const initialization = create();
      const rejected = expect(initialization).rejects.toBe(failure);
      await vi.advanceTimersByTimeAsync(0);
      waiting.reject(failure);
      await rejected;
      expect(node.disconnect).toHaveBeenCalledTimes(stage === "factory" ? 0 : 1);
      expect(node.port.close).toHaveBeenCalledTimes(stage === "factory" ? 0 : 1);
      expect(vi.getTimerCount()).toBe(0);
    }
  );

  it.each([NaN, Infinity, -0.1, 1.01])("rejects invalid processor latency %s before scheduling", async (latency) => {
    node.latency.mockResolvedValueOnce(latency);
    await expect(create()).rejects.toThrow("Invalid audio processing latency.");
    expect(node.schedule).not.toHaveBeenCalled();
    expect(node.disconnect).toHaveBeenCalledOnce();
    expect(node.port.close).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not create a worklet for a request that was already cancelled", async () => {
    const reason = new DOMException("Track changed", "AbortError");
    controller.abort(reason);
    await expect(create()).rejects.toBe(reason);
    expect(factory).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each<InitializationStage>(["factory", "configure", "latency", "schedule"])(
    "cancels pending %s immediately and cannot attach its late result",
    async (stage) => {
      const waiting = holdStage(stage, node);
      const reason = new DOMException("Track changed", "AbortError");
      const initialization = create();
      const rejected = expect(initialization).rejects.toBe(reason);
      await vi.advanceTimersByTimeAsync(0);
      const scheduledBeforeAbort = node.schedule.mock.calls.length;
      controller.abort(reason);
      await rejected;
      waiting.resolve();
      await vi.advanceTimersByTimeAsync(0);
      expect(node.schedule).toHaveBeenCalledTimes(scheduledBeforeAbort);
      expect(node.disconnect).toHaveBeenCalledOnce();
      expect(node.port.close).toHaveBeenCalledOnce();
      expect(vi.getTimerCount()).toBe(0);
    }
  );

  it("cancels active and queued commands on disposal without scheduling after a late reset", async () => {
    const processor = await createReady();
    const configured = deferred<void>();
    node.configure.mockReturnValueOnce(configured.promise);
    const prepare = processor.prepare();
    const update = processor.updatePitch();
    const rejectedPrepare = expect(prepare).rejects.toMatchObject({ name: "AbortError" });
    const rejectedUpdate = expect(update).rejects.toMatchObject({ name: "AbortError" });
    await vi.advanceTimersByTimeAsync(0);
    processor.dispose();
    await Promise.all([rejectedPrepare, rejectedUpdate]);
    configured.resolve();
    await vi.advanceTimersByTimeAsync(0);
    expect(node.schedule).toHaveBeenCalledOnce();
    expect(node.disconnect).toHaveBeenCalledOnce();
    expect(node.port.close).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
    await expect(processor.updatePitch()).rejects.toMatchObject({ name: "AbortError" });
  });

  it("propagates a reset failure without leaving subsequent commands stuck", async () => {
    const processor = await createReady();
    const failure = new Error("Reset failed");
    node.configure.mockRejectedValueOnce(failure);
    const prepare = processor.prepare();
    const rejected = expect(prepare).rejects.toBe(failure);
    requestedSemitones = 6;
    const update = processor.updatePitch();
    await Promise.all([rejected, update]);
    expect(node.schedule).toHaveBeenCalledTimes(2);
    expect(node.schedule.mock.lastCall?.[0].semitones).toBe(18);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(["prepare", "updatePitch"] as const)("bounds a hung %s RPC after initialization", async (command) => {
    const processor = await createReady();
    const waiting = deferred<void>();
    if (command === "prepare") node.configure.mockReturnValueOnce(waiting.promise);
    else node.schedule.mockReturnValueOnce(waiting.promise);
    const operation = processor[command]();
    const rejected = expect(operation).rejects.toThrow("音声処理の応答がありません");
    await vi.advanceTimersByTimeAsync(15_000);
    await rejected;
    const scheduledAtTimeout = node.schedule.mock.calls.length;
    waiting.resolve();
    await vi.advanceTimersByTimeAsync(0);
    expect(node.schedule).toHaveBeenCalledTimes(scheduledAtTimeout);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("reports processor failures to the graph owner and ignores events after disposal", async () => {
    const processor = await createReady();
    node.dispatchEvent(new Event("processorerror"));
    expect(onError).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      message: "音声処理が停止しました。ページを再読み込みしてください。"
    }));
    expect(onError.mock.calls[0]?.[0]).toBeInstanceOf(Error);
    processor.dispose();
    node.dispatchEvent(new Event("processorerror"));
    expect(onError).toHaveBeenCalledOnce();
  });

  it("ignores processor errors after the owning graph has been cancelled", async () => {
    await createReady();
    controller.abort();
    node.dispatchEvent(new Event("processorerror"));
    expect(onError).not.toHaveBeenCalled();
  });
});
