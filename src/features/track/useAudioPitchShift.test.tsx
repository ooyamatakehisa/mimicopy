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
type ClickProcessorMock = {
  node: NodeMock;
  context: ContextMock;
  latencySeconds: number;
  signal: AbortSignal;
  prepare: ReturnType<typeof vi.fn>;
  setEnabled: ReturnType<typeof vi.fn>;
  dispose: ReturnType<typeof vi.fn>;
  onError(error: Error): void;
};
const processing = vi.hoisted(() => ({
  effects: [] as ProcessorMock[],
  clicks: [] as ClickProcessorMock[],
  fail: false,
  clickFail: false,
  wait: Promise.resolve() as Promise<void>,
  importWait: Promise.resolve() as Promise<void>,
  clickWait: Promise.resolve() as Promise<void>,
  clickImportWait: Promise.resolve() as Promise<void>,
  clickImportStarted: null as (() => void) | null,
  updateWait: Promise.resolve() as Promise<void>,
  creationRequests: 0,
  clickCreationRequests: 0
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
  const audio = document.createElement("audio");
  audio.pause = vi.fn();
  return {
    isMultichannel: true,
    mediaUrl: "/mixer.wav",
    originalVolume: 0,
    stemVolume: 0.5,
    remainderVolume: 1,
    semitones: 0,
    playback: {
      audioRef: { current: audio },
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
    processing.clicks.length = 0;
    processing.fail = false;
    processing.clickFail = false;
    processing.wait = Promise.resolve();
    processing.importWait = Promise.resolve();
    processing.clickWait = Promise.resolve();
    processing.clickImportWait = Promise.resolve();
    processing.clickImportStarted = null;
    processing.updateWait = Promise.resolve();
    processing.creationRequests = 0;
    processing.clickCreationRequests = 0;
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
    vi.doMock("../../lib/clickCueProcessor", async () => {
      processing.clickImportStarted?.();
      await processing.clickImportWait;
      return {
        createClickCueProcessor: async (options: {
          context: ContextMock; latencySeconds: number; signal: AbortSignal; onError(error: Error): void;
        }) => {
          processing.clickCreationRequests++;
          await processing.clickWait;
          if (processing.clickFail) throw new Error("Click graph initialization failed");
          const processor: ClickProcessorMock = {
            ...options, node: new NodeMock(), prepare: vi.fn(async () => {}), setEnabled: vi.fn(), dispose: vi.fn()
          };
          processing.clicks.push(processor);
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

  it("splits one source into three music pairs and two cue lanes before delayed processor initialization", async () => {
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
    expect(context.gains.map((gain) => gain.gain.value)).toEqual([0, 0, 0.5, 1, 0]);
    expect(context.splitters).toHaveLength(1);
    const splitter = context.splitters[0];
    expect(splitter.numberOfOutputs).toBe(8);
    expect(context.sources[0].connect).toHaveBeenCalledExactlyOnceWith(splitter);
    expect(context.mergers).toHaveLength(4);
    expect(splitter.connect.mock.calls).toEqual(context.mergers.flatMap((merger, index) => [
      [merger, index * 2, 0], [merger, index * 2 + 1, 1]
    ]));
    context.mergers.slice(0, 3).forEach((merger, index) => {
      expect(merger.numberOfInputs).toBe(2);
      expect(merger.connect).toHaveBeenCalledExactlyOnceWith(context.gains[index + 1]);
      expect(context.gains[index + 1].channelCount).toBe(2);
      expect(context.gains[index + 1].channelCountMode).toBe("explicit");
    });
    expect(context.mergers[3].connect).not.toHaveBeenCalled();
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
    context.gains.slice(1, 4).forEach((gain) => expect(gain.connect).toHaveBeenCalledWith(processor.node));
    expect(processor.node.connect).toHaveBeenCalledExactlyOnceWith(context.gains[0]);
    expect(context.gains[0].connect).toHaveBeenCalledExactlyOnceWith(context.destination);
    expect(context.gains[0].gain.value).toBe(0);
    const click = processing.clicks[0];
    expect(click.context).toBe(context);
    expect(click.latencySeconds).toBe(processor.latencySeconds);
    expect(context.mergers[3].connect).toHaveBeenCalledExactlyOnceWith(click.node);
    expect(click.node.connect).toHaveBeenCalledExactlyOnceWith(context.gains[4]);
    expect(context.gains[4].connect).toHaveBeenCalledExactlyOnceWith(context.destination);
    expect(context.gains[4].gain.value).toBe(0);
    expect(click.setEnabled).toHaveBeenCalledExactlyOnceWith(false);
    expect(result.current.outputLatencySeconds).toBe(0.12);
    initial.playback.audioProcessingRef.current?.open();
    expect(context.gains[0].gain.setValueAtTime).toHaveBeenLastCalledWith(1, 2);
    expect(context.gains[4].gain.setValueAtTime).toHaveBeenLastCalledWith(1, 2);
    initial.playback.audioProcessingRef.current?.silence();
    expect(context.gains[0].gain.setValueAtTime).toHaveBeenLastCalledWith(0, 2);
    expect(context.gains[4].gain.setValueAtTime).toHaveBeenLastCalledWith(0, 2);
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
    expect(processing.clicks[0].dispose).toHaveBeenCalledOnce();
    expect(processing.clicks[0].signal.aborted).toBe(true);
    expect(initial.playback.audioProcessingRef.current).toBeNull();
    expect(initial.playback.audioContextRef.current).toBeNull();
    expect(initial.playback.audioGraphReadyRef.current).toBeNull();
  });

  it("waits for both resets and keeps both destination gates closed until the transport opens them", async () => {
    const initial = props();
    const { result } = renderHook(() => useAudioPitchShift(initial));
    await act(async () => { await initial.playback.audioGraphReadyRef.current; });
    const context = ContextMock.instances[0];
    const music = deferred();
    const clicks = deferred();
    processing.effects[0].prepare.mockReturnValueOnce(music.promise);
    processing.clicks[0].prepare.mockReturnValueOnce(clicks.promise);
    result.current.setClickEnabled(true);
    const control = initial.playback.audioProcessingRef.current!;
    control.open();
    control.silence();
    const preparing = control.prepare();
    const prepared = vi.fn();
    void preparing.then(prepared);
    expect(processing.effects[0].prepare).toHaveBeenCalledOnce();
    expect(processing.clicks[0].prepare).toHaveBeenCalledOnce();
    await act(async () => { clicks.resolve(); await Promise.resolve(); });
    expect(prepared).not.toHaveBeenCalled();
    await act(async () => { music.resolve(); await preparing; });
    expect(prepared).toHaveBeenCalledOnce();
    expect(processing.clicks[0].setEnabled.mock.calls).toEqual([[false], [true]]);
    for (const gate of [context.gains[0], context.gains[4]]) {
      expect(gate.gain.setValueAtTime.mock.calls).toEqual([[1, 2], [0, 2]]);
    }
    control.open();
    for (const gate of [context.gains[0], context.gains[4]]) {
      expect(gate.gain.setValueAtTime).toHaveBeenLastCalledWith(1, 2);
    }
  });

  it.each(["music", "click"] as const)("closes and disposes the complete graph when the %s reset fails", async (kind) => {
    const initial = props();
    const { result } = renderHook(() => useAudioPitchShift(initial));
    await act(async () => { await initial.playback.audioGraphReadyRef.current; });
    const processor = kind === "music" ? processing.effects[0] : processing.clicks[0];
    const failure = new Error(`${kind} reset failed`);
    processor.prepare.mockRejectedValueOnce(failure);
    const control = initial.playback.audioProcessingRef.current!;
    control.open();
    await act(async () => { await expect(control.prepare()).rejects.toBe(failure); });
    const context = ContextMock.instances[0];
    for (const gate of [context.gains[0], context.gains[4]]) {
      expect(gate.gain.setValueAtTime).toHaveBeenLastCalledWith(0, 2);
    }
    expect(processing.effects[0].dispose).toHaveBeenCalledOnce();
    expect(processing.clicks[0].dispose).toHaveBeenCalledOnce();
    expect(processing.clicks[0].signal.aborted).toBe(true);
    expect(context.close).toHaveBeenCalledOnce();
    expect(initial.playback.audioProcessingRef.current).toBeNull();
    expect(result.current.pitchShiftErrorMessage).toContain(failure.message);
    expect(() => control.open()).toThrow("Audio graph is unavailable");
  });

  it("applies the latest click preference after cue initialization and bypasses all three music gains", async () => {
    const waiting = deferred();
    processing.clickWait = waiting.promise;
    const initial = props();
    const { result, rerender } = renderHook(useAudioPitchShift, { initialProps: initial });
    const ready = initial.playback.audioGraphReadyRef.current;
    await act(async () => { await vi.dynamicImportSettled(); });
    expect(processing.effects).toHaveLength(1);
    expect(processing.clickCreationRequests).toBe(1);
    expect(initial.playback.audioProcessingRef.current).toBeNull();
    result.current.setClickEnabled(true);
    result.current.setClickEnabled(false);
    result.current.setClickEnabled(true);
    await act(async () => { waiting.resolve(); await ready; });
    const click = processing.clicks[0];
    expect(click.setEnabled).toHaveBeenCalledExactlyOnceWith(true);
    const context = ContextMock.instances[0];
    rerender({ ...initial, originalVolume: 0, stemVolume: 0, remainderVolume: 0, semitones: 6 });
    expect(context.gains[2].gain.linearRampToValueAtTime).toHaveBeenLastCalledWith(0, expect.closeTo(2.018, 8));
    expect(context.gains[3].gain.linearRampToValueAtTime).toHaveBeenLastCalledWith(0, expect.closeTo(2.018, 8));
    expect(click.setEnabled).toHaveBeenCalledOnce();
    expect(click.prepare).not.toHaveBeenCalled();
    expect(context.mergers[3].connect).toHaveBeenCalledExactlyOnceWith(click.node);
    expect(click.node.connect).toHaveBeenCalledExactlyOnceWith(context.gains[4]);
    expect(context.gains[4].connect).toHaveBeenCalledExactlyOnceWith(context.destination);
    expect(processing.effects[0].node.connect).toHaveBeenCalledExactlyOnceWith(context.gains[0]);
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
    expect(processing.clickCreationRequests).toBe(0);
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
    expect(current.gains).toHaveLength(5);
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

  it("rejects readiness and disposes the ready music processor when cue initialization fails", async () => {
    processing.clickFail = true;
    const initial = props();
    const { result } = renderHook(() => useAudioPitchShift(initial));
    await act(async () => {
      await expect(initial.playback.audioGraphReadyRef.current).rejects.toThrow("Click graph initialization failed");
    });
    const context = ContextMock.instances[0];
    expect(context.close).toHaveBeenCalledOnce();
    expect(processing.effects[0].dispose).toHaveBeenCalledOnce();
    expect(context.gains[0].gain.setValueAtTime).toHaveBeenLastCalledWith(0, 2);
    expect(context.gains[4].gain.setValueAtTime).toHaveBeenLastCalledWith(0, 2);
    expect(initial.playback.audioContextRef.current).toBeNull();
    expect(initial.playback.audioProcessingRef.current).toBeNull();
    expect(result.current.pitchShiftErrorMessage).toContain("Click graph initialization failed");
  });

  it.each(["music", "click"] as const)("closes both outputs and exposes %s processor failures during playback", async (kind) => {
    const initial = props();
    const { result } = renderHook(() => useAudioPitchShift(initial));
    await act(async () => { await initial.playback.audioGraphReadyRef.current; });
    const pause = vi.spyOn(initial.playback.audioRef.current!, "pause");
    const control = initial.playback.audioProcessingRef.current!;
    control.open();
    act(() => {
      const processor = kind === "music" ? processing.effects[0] : processing.clicks[0];
      processor.onError(new Error("Processor failed"));
    });
    expect(ContextMock.instances[0].gains[0].gain.setValueAtTime).toHaveBeenLastCalledWith(0, 2);
    expect(ContextMock.instances[0].gains[4].gain.setValueAtTime).toHaveBeenLastCalledWith(0, 2);
    expect(pause).toHaveBeenCalledOnce();
    expect(result.current.pitchShiftErrorMessage).toContain("Processor failed");
    expect(initial.playback.audioProcessingRef.current).toBeNull();
    expect(processing.effects[0].dispose).toHaveBeenCalledOnce();
    expect(processing.clicks[0].dispose).toHaveBeenCalledOnce();
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

  it.each(["import", "factory", "click-import", "click-factory", "reconciliation"] as const)("bounds pending %s and ignores its late completion", async (stage) => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const waiting = deferred();
    const clickImportStarted = deferred();
    if (stage === "import") processing.importWait = waiting.promise;
    if (stage === "factory") processing.wait = waiting.promise;
    if (stage === "click-import") {
      processing.clickImportWait = waiting.promise;
      processing.clickImportStarted = clickImportStarted.resolve;
    }
    if (stage === "click-factory") processing.clickWait = waiting.promise;
    if (stage === "reconciliation") processing.updateWait = waiting.promise;
    const initial = props();
    const pause = vi.spyOn(initial.playback.audioRef.current!, "pause");
    const { result } = renderHook(() => useAudioPitchShift(initial));
    const ready = initial.playback.audioGraphReadyRef.current;
    if (stage === "click-import") await act(async () => { await clickImportStarted.promise; });
    if (stage !== "import" && stage !== "click-import") await act(async () => { await vi.dynamicImportSettled(); });
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
    expect(context.gains[4].gain.setValueAtTime).toHaveBeenLastCalledWith(0, 2);
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
    if (stage === "click-import") expect(processing.clickCreationRequests).toBe(0);
    if (stage === "click-factory") {
      expect(processing.clicks[0].dispose).toHaveBeenCalledOnce();
      expect(processing.clicks[0].node.connect).not.toHaveBeenCalled();
      expect(processing.clicks[0].signal.aborted).toBe(true);
    }
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

  it("disposes a late cue processor without attaching it to the replacement transport", async () => {
    const waiting = deferred();
    processing.clickWait = waiting.promise;
    const initial = props();
    const { rerender, result } = renderHook(useAudioPitchShift, { initialProps: initial });
    const oldReady = initial.playback.audioGraphReadyRef.current;
    await act(async () => { await vi.dynamicImportSettled(); });
    expect(processing.clickCreationRequests).toBe(1);
    const oldContext = ContextMock.instances[0];
    result.current.setClickEnabled(true);
    processing.clickWait = Promise.resolve();
    initial.playback.audioRef.current = document.createElement("audio");
    rerender({ ...initial, mediaUrl: "/replacement.wav" });
    const currentReady = initial.playback.audioGraphReadyRef.current;
    await expect(oldReady).rejects.toMatchObject({ name: "AbortError" });
    await act(async () => { await currentReady; });
    const currentContext = ContextMock.instances[1];
    const currentClick = processing.clicks.find((processor) => processor.context === currentContext)!;
    expect(currentClick.setEnabled).toHaveBeenCalledExactlyOnceWith(true);
    await act(async () => { waiting.resolve(); });
    const oldClick = processing.clicks.find((processor) => processor.context === oldContext)!;
    expect(oldClick.dispose).toHaveBeenCalledOnce();
    expect(oldClick.signal.aborted).toBe(true);
    expect(oldClick.node.connect).not.toHaveBeenCalled();
    expect(oldContext.mergers[3].connect).not.toHaveBeenCalled();
    expect(oldClick.setEnabled).not.toHaveBeenCalled();
    result.current.setClickEnabled(false);
    expect(currentClick.setEnabled).toHaveBeenLastCalledWith(false);
    act(() => { oldClick.onError(new Error("Late old click error")); });
    expect(result.current.audioContext).toBe(currentContext);
    expect(result.current.pitchShiftErrorMessage).toBeNull();
    expect(initial.playback.audioProcessingRef.current).not.toBeNull();
    expect(currentClick.dispose).not.toHaveBeenCalled();
    expect(currentContext.close).not.toHaveBeenCalled();
  });
});
