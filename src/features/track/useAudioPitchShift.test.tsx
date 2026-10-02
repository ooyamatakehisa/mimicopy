import { act, cleanup, renderHook } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAudioPitchShift } from "./useAudioPitchShift";

type ProcessorMock = {
  node: NodeMock;
  latencySeconds: number;
  prepare: ReturnType<typeof vi.fn>;
  updatePitch: ReturnType<typeof vi.fn>;
  dispose: ReturnType<typeof vi.fn>;
  semitones(): number;
  onError(error: Error): void;
};
const processing = vi.hoisted(() => ({
  effects: [] as ProcessorMock[],
  fail: false,
  wait: Promise.resolve() as Promise<void>,
  importWait: Promise.resolve() as Promise<void>,
  updateWait: Promise.resolve() as Promise<void>,
  creationRequests: 0
}));

class NodeMock {
  channelCount = 2;
  channelCountMode: ChannelCountMode = "max";
  connect = vi.fn<(destination: NodeMock, output?: number, input?: number) => NodeMock>((destination) => destination);
  disconnect = vi.fn();
}
class GainMock extends NodeMock {
  gain = {
    value: 1,
    cancelAndHoldAtTime: vi.fn(),
    cancelScheduledValues: vi.fn(),
    setValueAtTime: vi.fn(),
    linearRampToValueAtTime: vi.fn()
  };
}
class SourceMock extends NodeMock {
  constructor(readonly element: HTMLMediaElement) { super(); }
}
class SplitterMock extends NodeMock {
  constructor(readonly numberOfOutputs: number) { super(); }
}
class MergerMock extends NodeMock {
  constructor(readonly numberOfInputs: number) { super(); }
}
let attachedElements = new WeakSet<HTMLMediaElement>();
class ContextMock {
  static instances: ContextMock[] = [];
  destination = new NodeMock();
  currentTime = 2;
  state: AudioContextState = "suspended";
  gains: GainMock[] = [];
  sources: SourceMock[] = [];
  splitters: SplitterMock[] = [];
  mergers: MergerMock[] = [];
  close = vi.fn(async () => { this.state = "closed"; });
  resume = vi.fn(async () => { this.state = "running"; });
  constructor() { ContextMock.instances.push(this); }
  createGain() {
    const gain = new GainMock();
    this.gains.push(gain);
    return gain;
  }
  createMediaElementSource(element: HTMLMediaElement) {
    if (attachedElements.has(element)) throw new DOMException("A source already owns this element", "InvalidStateError");
    attachedElements.add(element);
    const source = new SourceMock(element);
    this.sources.push(source);
    return source;
  }
  createChannelSplitter(outputs: number) {
    const splitter = new SplitterMock(outputs);
    this.splitters.push(splitter);
    return splitter;
  }
  createChannelMerger(inputs: number) {
    const merger = new MergerMock(inputs);
    this.mergers.push(merger);
    return merger;
  }
}

function props(): Parameters<typeof useAudioPitchShift>[0] {
  return {
    isMultichannel: true,
    mediaUrl: "/mixer.wav",
    originalVolume: 0,
    stemVolume: 0.5,
    remainderVolume: 1,
    semitones: 0,
    playback: {
      audioRef: { current: document.createElement("audio") },
      audioContextRef: { current: null },
      audioGraphReadyRef: { current: null },
      audioProcessingRef: { current: null }
    }
  };
}

function deferred() {
  let resolve = () => {};
  const promise = new Promise<void>((complete) => { resolve = complete; });
  return { promise, resolve };
}

describe("useAudioPitchShift", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    attachedElements = new WeakSet();
    ContextMock.instances = [];
    processing.effects.length = 0;
    processing.fail = false;
    processing.wait = Promise.resolve();
    processing.importWait = Promise.resolve();
    processing.updateWait = Promise.resolve();
    processing.creationRequests = 0;
    // Re-register the dynamic module per test so its import can remain pending
    // independently of the processor factory, without changing production APIs.
    vi.resetModules();
    vi.doMock("../../lib/pitchProcessor", async () => {
      await processing.importWait;
      return {
        createPitchProcessor: async ({ semitones, onError }: { semitones(): number; onError(error: Error): void }) => {
          processing.creationRequests++;
          await processing.wait;
          if (processing.fail) throw new Error("Pitch graph initialization failed");
          const processor: ProcessorMock = {
            node: new NodeMock(), latencySeconds: 0.12,
            prepare: vi.fn(async () => {}), updatePitch: vi.fn(async () => { await processing.updateWait; }), dispose: vi.fn(),
            semitones, onError
          };
          processing.effects.push(processor);
          return processor;
        }
      };
    });
    vi.stubGlobal("AudioContext", ContextMock);
  });
  afterEach(async () => {
    cleanup();
    await Promise.resolve();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("splits one source into three stereo pairs before delayed processor initialization", async () => {
    let release = () => {};
    processing.wait = new Promise<void>((resolve) => { release = resolve; });
    const initial = props();
    const { rerender, result } = renderHook(useAudioPitchShift, { initialProps: initial });
    const context = ContextMock.instances[0];
    const ready = initial.playback.audioGraphReadyRef.current;
    const readyResolved = vi.fn();
    void ready?.then(readyResolved);

    expect(initial.playback.audioContextRef.current).toBeNull();
    expect(context.sources).toHaveLength(1);
    expect(context.gains.map((gain) => gain.gain.value)).toEqual([0, 0, 0.5, 1]);
    expect(context.splitters).toHaveLength(1);
    const splitter = context.splitters[0];
    expect(splitter.numberOfOutputs).toBe(6);
    expect(context.sources[0].connect).toHaveBeenCalledExactlyOnceWith(splitter);
    expect(context.mergers).toHaveLength(3);
    expect(splitter.connect.mock.calls).toEqual(context.mergers.flatMap((merger, index) => [
      [merger, index * 2, 0], [merger, index * 2 + 1, 1]
    ]));
    context.mergers.forEach((merger, index) => {
      expect(merger.numberOfInputs).toBe(2);
      expect(merger.connect).toHaveBeenCalledExactlyOnceWith(context.gains[index + 1]);
      expect(context.gains[index + 1].channelCount).toBe(2);
      expect(context.gains[index + 1].channelCountMode).toBe("explicit");
    });
    expect(processing.effects).toHaveLength(0);
    expect(result.current.audioContext).toBeNull();
    await Promise.resolve();
    expect(readyResolved).not.toHaveBeenCalled();
    expect(context.state).toBe("suspended");

    // Settings changed while modules are pending must reach the eventual graph.
    rerender({ ...initial, stemVolume: 0, semitones: 3 });
    await act(async () => {
      release();
      await ready;
    });
    expect(readyResolved).toHaveBeenCalledOnce();
    expect(processing.effects[0].semitones()).toBe(3);
    expect(context.gains[2].gain.linearRampToValueAtTime).toHaveBeenLastCalledWith(0, expect.closeTo(2.018, 8));
    const processor = processing.effects[0];
    context.gains.slice(1).forEach((gain) => expect(gain.connect).toHaveBeenCalledWith(processor.node));
    expect(processor.node.connect).toHaveBeenCalledExactlyOnceWith(context.gains[0]);
    expect(context.gains[0].connect).toHaveBeenCalledExactlyOnceWith(context.destination);
    expect(context.gains[0].gain.value).toBe(0);
    expect(result.current.outputLatencySeconds).toBe(0.12);
    initial.playback.audioProcessingRef.current?.open();
    expect(context.gains[0].gain.setValueAtTime).toHaveBeenLastCalledWith(1, 2);
    initial.playback.audioProcessingRef.current?.silence();
    expect(context.gains[0].gain.setValueAtTime).toHaveBeenLastCalledWith(0, 2);
    expect(result.current.audioContext).toBe(context);
    expect(initial.playback.audioContextRef.current).toBe(context);
    await initial.playback.audioContextRef.current?.resume();
    expect(context.state).toBe("running");
  });

  it("reuses the source during StrictMode replay and disposes the processor on unmount", async () => {
    const initial = props();
    const { unmount } = renderHook(() => useAudioPitchShift(initial), { wrapper: StrictMode });
    await act(async () => { await initial.playback.audioGraphReadyRef.current; });
    expect(ContextMock.instances).toHaveLength(1);
    const context = ContextMock.instances[0];
    expect(context.sources).toHaveLength(1);
    expect(context.close).not.toHaveBeenCalled();
    await act(async () => { unmount(); });
    expect(context.close).toHaveBeenCalledOnce();
    context.sources.forEach((source) => expect(source.disconnect).toHaveBeenCalledOnce());
    context.splitters.forEach((splitter) => expect(splitter.disconnect).toHaveBeenCalledOnce());
    context.mergers.forEach((merger) => expect(merger.disconnect).toHaveBeenCalledOnce());
    context.gains.forEach((gain) => expect(gain.disconnect).toHaveBeenCalledOnce());
    expect(processing.effects[0].dispose).toHaveBeenCalledOnce();
    expect(initial.playback.audioProcessingRef.current).toBeNull();
    expect(initial.playback.audioContextRef.current).toBeNull();
    expect(initial.playback.audioGraphReadyRef.current).toBeNull();
  });

  it("holds the current gain before each short ramp without rebuilding sources", async () => {
    const initial = props();
    const { rerender } = renderHook(useAudioPitchShift, { initialProps: initial });
    await act(async () => { await initial.playback.audioGraphReadyRef.current; });
    const context = ContextMock.instances[0];
    context.currentTime = 4;
    rerender({ ...initial, originalVolume: 1, stemVolume: 0 });
    expect(context.gains[1].gain.cancelAndHoldAtTime).toHaveBeenCalledWith(4.01);
    expect(context.gains[1].gain.setValueAtTime).toHaveBeenCalledWith(0, 4.01);
    expect(context.gains[1].gain.linearRampToValueAtTime).toHaveBeenCalledWith(1, expect.closeTo(4.018, 8));
    expect(context.gains[2].gain.cancelAndHoldAtTime).toHaveBeenCalledWith(4.01);
    expect(context.gains[2].gain.setValueAtTime).toHaveBeenCalledWith(0.5, 4.01);
    expect(context.gains[2].gain.linearRampToValueAtTime).toHaveBeenCalledWith(0, expect.closeTo(4.018, 8));
    expect(context.gains[3].gain.setValueAtTime).not.toHaveBeenCalled();
    context.currentTime = 4.004;
    rerender({ ...initial, originalVolume: 0.25, stemVolume: 0.75 });
    expect(context.gains[1].gain.setValueAtTime).toHaveBeenLastCalledWith(expect.closeTo(0.5), expect.closeTo(4.014, 8));
    expect(context.gains[2].gain.setValueAtTime).toHaveBeenLastCalledWith(expect.closeTo(0.25), expect.closeTo(4.014, 8));
    expect(context.gains[1].gain.linearRampToValueAtTime).toHaveBeenLastCalledWith(0.25, expect.closeTo(4.022, 8));
    expect(context.gains[2].gain.linearRampToValueAtTime).toHaveBeenLastCalledWith(0.75, expect.closeTo(4.022, 8));
    // Once that ramp ends, a new fade must still begin at the new scheduled time rather than the
    // old automation endpoint (which caused an almost-full-volume first sample).
    context.currentTime = 5;
    rerender({ ...initial, originalVolume: 1, stemVolume: 0.75 });
    expect(context.gains[1].gain.setValueAtTime).toHaveBeenLastCalledWith(0.25, 5.01);
    expect(context.gains[1].gain.linearRampToValueAtTime).toHaveBeenLastCalledWith(1, expect.closeTo(5.018, 8));
    expect(context.sources).toHaveLength(1);
    expect(ContextMock.instances).toHaveLength(1);
    expect(initial.playback.audioRef.current?.volume).toBe(1);
    expect(processing.effects[0].prepare).not.toHaveBeenCalled();
    rerender({ ...initial, semitones: 3 });
    expect(processing.effects[0].semitones()).toBe(3);
    expect(processing.effects[0].updatePitch).toHaveBeenCalledTimes(2);
  });

  it("connects ordinary audio through only its original stereo gain", async () => {
    const initial = { ...props(), isMultichannel: false, originalVolume: 0.75 };
    renderHook(() => useAudioPitchShift(initial));
    await act(async () => { await initial.playback.audioGraphReadyRef.current; });
    const context = ContextMock.instances[0];
    expect(context.sources).toHaveLength(1);
    expect(context.splitters).toHaveLength(0);
    expect(context.mergers).toHaveLength(0);
    expect(context.gains).toHaveLength(2);
    expect(context.gains[1].gain.value).toBe(0.75);
    expect(context.sources[0].connect).toHaveBeenCalledExactlyOnceWith(context.gains[1]);
    expect(context.gains[1].connect).toHaveBeenCalledExactlyOnceWith(processing.effects[0].node);
  });

  it("rebuilds only the graph when a replacement transport becomes multichannel", async () => {
    const initial = { ...props(), isMultichannel: false, mediaUrl: "/original.mp3" };
    const { rerender, result } = renderHook(useAudioPitchShift, { initialProps: initial });
    await act(async () => { await initial.playback.audioGraphReadyRef.current; });
    const oldContext = ContextMock.instances[0];
    const replacement = document.createElement("audio");
    initial.playback.audioRef.current = replacement;
    rerender({ ...initial, isMultichannel: true, mediaUrl: "/mixer.wav" });
    expect(oldContext.close).toHaveBeenCalledOnce();
    expect(result.current.audioContext).toBeNull();
    expect(initial.playback.audioContextRef.current).toBeNull();
    await act(async () => { await initial.playback.audioGraphReadyRef.current; });
    expect(ContextMock.instances).toHaveLength(2);
    const current = ContextMock.instances[1];
    expect(current.sources[0].element).toBe(replacement);
    expect(current.splitters).toHaveLength(1);
    expect(current.gains).toHaveLength(4);
    expect(result.current.audioContext).toBe(current);
    expect(initial.playback.audioContextRef.current).toBe(current);
  });

  it("reports unsupported audio processing instead of remaining pending", () => {
    vi.stubGlobal("AudioContext", undefined);
    const { result } = renderHook(() => useAudioPitchShift(props()));
    expect(result.current.audioContext).toBeNull();
    expect(result.current.pitchShiftErrorMessage).toContain("音声処理を利用できません");
  });

  it("uses owned automation even when AudioParam.value reports a stale value", async () => {
    const initial = props();
    const { rerender } = renderHook(useAudioPitchShift, { initialProps: initial });
    await act(async () => { await initial.playback.audioGraphReadyRef.current; });
    const parameter = ContextMock.instances[0].gains[1].gain;
    parameter.value = 0.4;
    Object.defineProperty(parameter, "cancelAndHoldAtTime", { value: undefined });
    rerender({ ...initial, originalVolume: 0.8 });
    expect(parameter.cancelScheduledValues).toHaveBeenCalledWith(2.01);
    expect(parameter.setValueAtTime).toHaveBeenCalledWith(0, 2.01);
    expect(parameter.linearRampToValueAtTime).toHaveBeenCalledWith(0.8, expect.closeTo(2.018, 8));
    // Reversing before the first fade begins must preserve its first half.
    ContextMock.instances[0].currentTime = 2.004;
    rerender({ ...initial, originalVolume: 0 });
    expect(parameter.linearRampToValueAtTime).toHaveBeenNthCalledWith(
      2, expect.closeTo(0.4), expect.closeTo(2.014, 8)
    );
    expect(parameter.setValueAtTime).toHaveBeenLastCalledWith(expect.closeTo(0.4), expect.closeTo(2.014, 8));
    expect(parameter.linearRampToValueAtTime).toHaveBeenLastCalledWith(0, expect.closeTo(2.022, 8));
  });

  it("rejects readiness and releases the context when effect initialization fails", async () => {
    processing.fail = true;
    const initial = props();
    const { result, unmount } = renderHook(() => useAudioPitchShift(initial));
    const ready = initial.playback.audioGraphReadyRef.current;
    await act(async () => { await expect(ready).rejects.toThrow("Pitch graph initialization failed"); });
    const context = ContextMock.instances[0];
    expect(context.close).toHaveBeenCalledOnce();
    expect(initial.playback.audioContextRef.current).toBeNull();
    expect(result.current.pitchShiftErrorMessage).toContain("Pitch graph initialization failed");
    unmount();
    await Promise.resolve();
    expect(context.close).toHaveBeenCalledOnce();
  });

  it("closes output and exposes processor failures during playback", async () => {
    const initial = props();
    const { result } = renderHook(() => useAudioPitchShift(initial));
    await act(async () => { await initial.playback.audioGraphReadyRef.current; });
    const pause = vi.spyOn(initial.playback.audioRef.current!, "pause");
    const control = initial.playback.audioProcessingRef.current!;
    control.open();
    act(() => { processing.effects[0].onError(new Error("Processor failed")); });
    expect(ContextMock.instances[0].gains[0].gain.setValueAtTime).toHaveBeenLastCalledWith(0, 2);
    expect(pause).toHaveBeenCalledOnce();
    expect(result.current.pitchShiftErrorMessage).toContain("Processor failed");
    expect(initial.playback.audioProcessingRef.current).toBeNull();
    expect(processing.effects[0].dispose).toHaveBeenCalledOnce();
    expect(() => control.open()).toThrow("Audio graph is unavailable");
  });

  it("cancels initialization on unmount without connecting a disposed context", async () => {
    const initial = props();
    const { unmount } = renderHook(() => useAudioPitchShift(initial));
    const ready = initial.playback.audioGraphReadyRef.current;
    unmount();
    await expect(ready).rejects.toMatchObject({ name: "AbortError" });
    await Promise.resolve();
    expect(ContextMock.instances[0].close).toHaveBeenCalledOnce();
    processing.effects.forEach((processor) => expect(processor.node.connect).not.toHaveBeenCalled());
    expect(initial.playback.audioContextRef.current).toBeNull();
  });

  it.each(["import", "factory", "reconciliation"] as const)("bounds pending %s and ignores its late completion", async (stage) => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const waiting = deferred();
    if (stage === "import") processing.importWait = waiting.promise;
    if (stage === "factory") processing.wait = waiting.promise;
    if (stage === "reconciliation") processing.updateWait = waiting.promise;
    const initial = props();
    const pause = vi.spyOn(initial.playback.audioRef.current!, "pause");
    const { result } = renderHook(() => useAudioPitchShift(initial));
    const ready = initial.playback.audioGraphReadyRef.current;
    if (stage !== "import") await act(async () => { await vi.dynamicImportSettled(); });
    const context = ContextMock.instances[0];
    await act(async () => { await vi.advanceTimersByTimeAsync(14_999); });
    expect(context.close).not.toHaveBeenCalled();
    expect(result.current.pitchShiftErrorMessage).toBeNull();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
      await expect(ready).rejects.toThrow("音声処理の準備が時間内に完了しませんでした");
    });
    expect(pause).toHaveBeenCalledOnce();
    expect(context.close).toHaveBeenCalledOnce();
    expect(context.gains[0].gain.setValueAtTime).toHaveBeenLastCalledWith(0, 2);
    expect(result.current.pitchShiftErrorMessage).toContain("音声処理の準備が時間内に完了しませんでした");
    expect(initial.playback.audioContextRef.current).toBeNull();
    expect(initial.playback.audioProcessingRef.current).toBeNull();
    await act(async () => { waiting.resolve(); await vi.dynamicImportSettled(); });
    expect(context.close).toHaveBeenCalledOnce();
    expect(result.current.audioContext).toBeNull();
    expect(initial.playback.audioProcessingRef.current).toBeNull();
    if (stage === "import") expect(processing.creationRequests).toBe(0);
    else expect(processing.effects[0].dispose).toHaveBeenCalledOnce();
    if (stage === "factory") expect(processing.effects[0].node.connect).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("uses one deadline across module loading and later processor preparation", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const moduleReady = deferred();
    const processorReady = deferred();
    processing.importWait = moduleReady.promise;
    processing.wait = processorReady.promise;
    const initial = props();
    renderHook(() => useAudioPitchShift(initial));
    const ready = initial.playback.audioGraphReadyRef.current;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
      moduleReady.resolve();
      await vi.dynamicImportSettled();
    });
    expect(processing.creationRequests).toBe(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
      await expect(ready).rejects.toThrow("音声処理の準備が時間内に完了しませんでした");
    });
    expect(ContextMock.instances[0].close).toHaveBeenCalledOnce();
    await act(async () => { processorReady.resolve(); });
    expect(processing.effects[0].dispose).toHaveBeenCalledOnce();
    expect(processing.effects[0].node.connect).not.toHaveBeenCalled();
  });

  it("clears the pending-import deadline on unmount and never starts the late module", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const waiting = deferred();
    processing.importWait = waiting.promise;
    const initial = props();
    const { unmount } = renderHook(() => useAudioPitchShift(initial));
    const ready = initial.playback.audioGraphReadyRef.current;
    await act(async () => { unmount(); });
    await expect(ready).rejects.toMatchObject({ name: "AbortError" });
    expect(vi.getTimerCount()).toBe(0);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000);
      waiting.resolve();
      await vi.dynamicImportSettled();
    });
    expect(processing.creationRequests).toBe(0);
    expect(ContextMock.instances[0].close).toHaveBeenCalledOnce();
    expect(initial.playback.audioGraphReadyRef.current).toBeNull();
  });

  it("does not let the old graph deadline fail a replacement graph", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const waiting = deferred();
    processing.wait = waiting.promise;
    const initial = props();
    const { rerender, result } = renderHook(useAudioPitchShift, { initialProps: initial });
    const oldReady = initial.playback.audioGraphReadyRef.current;
    await act(async () => { await vi.dynamicImportSettled(); });
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
    initial.playback.audioRef.current = document.createElement("audio");
    rerender({ ...initial, mediaUrl: "/replacement.wav" });
    const currentReady = initial.playback.audioGraphReadyRef.current;
    await expect(oldReady).rejects.toMatchObject({ name: "AbortError" });
    await act(async () => { waiting.resolve(); await currentReady; });
    const current = ContextMock.instances[1];
    expect(processing.creationRequests).toBe(2);
    expect(processing.effects[0].dispose).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
    await act(async () => { await vi.advanceTimersByTimeAsync(20_000); });
    expect(ContextMock.instances[0].close).toHaveBeenCalledOnce();
    expect(current.close).not.toHaveBeenCalled();
    expect(result.current.audioContext).toBe(current);
    expect(result.current.pitchShiftErrorMessage).toBeNull();
    expect(initial.playback.audioProcessingRef.current).not.toBeNull();
  });
});
