import { vi } from "vitest";
import { createClickCueProcessor, type ClickCueProcessor } from "./clickCueProcessor";

vi.mock("./clickCueProcessor.worklet.ts?worker&url", () => ({ default: "/assets/click-cue-worklet.js" }));

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
  const gate = { setValueAtTime: vi.fn() };
  return Object.assign(new EventTarget(), {
    parameters: new Map([["enabled", gate]]),
    disconnect: vi.fn(),
    port: {
      close: vi.fn(),
      postMessage: vi.fn<(message: { type: string; id?: number; enabled?: boolean }) => void>(),
      onmessage: null as ((message: MessageEvent<unknown>) => void) | null
    }
  });
}

describe("click cue processor lifecycle", () => {
  let node: ReturnType<typeof createNode>;
  let factory: ReturnType<typeof vi.fn>;
  let context: AudioContext;
  let addModule: ReturnType<typeof vi.fn<(url: string) => Promise<void>>>;
  let controller: AbortController;
  let onError: ReturnType<typeof vi.fn<(error: Error) => void>>;
  const processors: ClickCueProcessor[] = [];

  function acknowledge(id: number) {
    node.port.onmessage?.(new MessageEvent("message", { data: { type: "prepared", id } }));
  }

  function create(latencySeconds = 0.12) {
    return createClickCueProcessor({ context, latencySeconds, signal: controller.signal, onError });
  }

  async function createReady() {
    const processor = await create();
    processors.push(processor);
    return processor;
  }

  beforeEach(() => {
    vi.useFakeTimers();
    node = createNode();
    node.port.postMessage.mockImplementation((message) => {
      if (message.type === "prepare" && message.id !== undefined) acknowledge(message.id);
    });
    factory = vi.fn(function () { return node; });
    vi.stubGlobal("AudioWorkletNode", factory);
    addModule = vi.fn<(url: string) => Promise<void>>().mockResolvedValue(undefined);
    context = Object.assign(new AudioContext(), { audioWorklet: { addModule } });
    controller = new AbortController();
    onError = vi.fn();
  });

  afterEach(() => {
    controller.abort();
    for (const processor of processors.splice(0)) processor.dispose();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("loads a compiled module and initializes one discrete stereo cue input, stereo output, and the exact latency", async () => {
    const processor = await createReady();
    expect(addModule).toHaveBeenCalledExactlyOnceWith("/assets/click-cue-worklet.js");
    expect(factory).toHaveBeenCalledExactlyOnceWith(context, "mimicopy-click-cue", {
      numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2], channelCount: 2,
      channelCountMode: "explicit", channelInterpretation: "discrete", processorOptions: { latencySeconds: 0.12 }
    });
    expect(processor.node).toBe(node);
    expect(node.port.postMessage).toHaveBeenCalledExactlyOnceWith({ type: "prepare", id: 1 });
    expect(vi.getTimerCount()).toBe(0);
  });

  it("gates output immediately and clears buffered clicks on either enable transition", async () => {
    const processor = await createReady();
    const gate = node.parameters.get("enabled")!;
    processor.setEnabled(true);
    processor.setEnabled(true);
    processor.setEnabled(false);
    expect(gate.setValueAtTime.mock.calls).toEqual([[1, 0], [0, 0]]);
    expect(node.port.postMessage.mock.calls.slice(1)).toEqual([
      [{ type: "set-enabled", enabled: true }], [{ type: "set-enabled", enabled: false }]
    ]);
    await processor.prepare();
    expect(gate.setValueAtTime).toHaveBeenCalledTimes(2);
    processor.dispose();
    processor.setEnabled(true);
    expect(gate.setValueAtTime).toHaveBeenCalledTimes(2);
  });

  it("waits for the matching reset acknowledgement and orders consecutive prepares", async () => {
    const processor = await createReady();
    node.port.postMessage.mockReset();
    const first = processor.prepare();
    const second = processor.prepare();
    await vi.advanceTimersByTimeAsync(0);
    expect(node.port.postMessage).toHaveBeenCalledExactlyOnceWith({ type: "prepare", id: 2 });
    acknowledge(1);
    acknowledge(999);
    await vi.advanceTimersByTimeAsync(0);
    expect(node.port.postMessage).toHaveBeenCalledOnce();
    acknowledge(2);
    await first;
    await vi.advanceTimersByTimeAsync(0);
    expect(node.port.postMessage).toHaveBeenLastCalledWith({ type: "prepare", id: 3 });
    acknowledge(3);
    await second;
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([NaN, Infinity, -0.1, 1.01])("rejects invalid latency %s before loading a worklet", async (latency) => {
    await expect(create(latency)).rejects.toThrow("Invalid click processing latency.");
    expect(addModule).not.toHaveBeenCalled();
    expect(factory).not.toHaveBeenCalled();
  });

  it("does not load or construct after an already cancelled request", async () => {
    const reason = new DOMException("Track changed", "AbortError");
    controller.abort(reason);
    await expect(create()).rejects.toBe(reason);
    expect(addModule).not.toHaveBeenCalled();
    expect(factory).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("bounds module loading and never creates a late node after a timeout", async () => {
    const loading = deferred<void>();
    addModule.mockReturnValueOnce(loading.promise);
    const initialization = create();
    const rejected = expect(initialization).rejects.toThrow("クリック音の音声処理の応答がありません");
    await vi.advanceTimersByTimeAsync(15_000);
    await rejected;
    loading.resolve();
    await vi.advanceTimersByTimeAsync(0);
    expect(factory).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("cancels module loading immediately and never attaches its late result", async () => {
    const loading = deferred<void>();
    addModule.mockReturnValueOnce(loading.promise);
    const initialization = create();
    const reason = new DOMException("Track changed", "AbortError");
    const rejected = expect(initialization).rejects.toBe(reason);
    controller.abort(reason);
    await rejected;
    loading.resolve();
    await vi.advanceTimersByTimeAsync(0);
    expect(factory).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("releases the node if its initial reset does not acknowledge within 15 seconds", async () => {
    node.port.postMessage.mockReset();
    const initialization = create();
    const rejected = expect(initialization).rejects.toThrow("クリック音の音声処理の応答がありません");
    await vi.advanceTimersByTimeAsync(15_000);
    await rejected;
    expect(node.disconnect).toHaveBeenCalledOnce();
    expect(node.port.close).toHaveBeenCalledOnce();
    acknowledge(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("bounds a hung prepare and ignores its late acknowledgement", async () => {
    const processor = await createReady();
    node.port.postMessage.mockReset();
    const preparing = processor.prepare();
    const rejected = expect(preparing).rejects.toThrow("クリック音の音声処理の応答がありません");
    await vi.advanceTimersByTimeAsync(15_000);
    await rejected;
    acknowledge(2);
    const next = processor.prepare();
    await vi.advanceTimersByTimeAsync(0);
    acknowledge(2);
    expect(vi.getTimerCount()).toBe(1);
    acknowledge(3);
    await next;
    expect(vi.getTimerCount()).toBe(0);
  });

  it("cancels active and queued prepares and closes owned resources exactly once", async () => {
    const processor = await createReady();
    node.port.postMessage.mockReset();
    const first = processor.prepare();
    const second = processor.prepare();
    const rejectedFirst = expect(first).rejects.toMatchObject({ name: "AbortError" });
    const rejectedSecond = expect(second).rejects.toMatchObject({ name: "AbortError" });
    await vi.advanceTimersByTimeAsync(0);
    processor.dispose();
    await Promise.all([rejectedFirst, rejectedSecond]);
    acknowledge(2);
    processor.dispose();
    expect(node.port.postMessage).toHaveBeenCalledOnce();
    expect(node.disconnect).toHaveBeenCalledOnce();
    expect(node.port.close).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
    await expect(processor.prepare()).rejects.toMatchObject({ name: "AbortError" });
  });

  it("reports worklet failure only while the owning graph is alive", async () => {
    const processor = await createReady();
    node.dispatchEvent(new Event("processorerror"));
    expect(onError).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ message: expect.stringContaining("停止しました") }));
    processor.dispose();
    node.dispatchEvent(new Event("processorerror"));
    expect(onError).toHaveBeenCalledOnce();
  });
});
