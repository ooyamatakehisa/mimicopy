import clickCueModuleUrl from "./clickCueProcessor.worklet.ts?worker&url";

const commandTimeoutMs = 15_000;

export type ClickCueProcessor = {
  /** Explicit/discrete stereo cue input (normal, downbeat), stereo click output. */
  node: AudioWorkletNode;
  prepare(): Promise<void>;
  setEnabled(enabled: boolean): void;
  dispose(): void;
};

function bounded<T>(request: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const finish = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
    };
    const abort = () => { finish(); reject(signal.reason); };
    const timer = setTimeout(() => {
      finish();
      reject(new Error("クリック音の音声処理の応答がありません。ページを再読み込みしてください。"));
    }, commandTimeoutMs);
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
    void request.then((value) => { finish(); resolve(value); }, (error: unknown) => { finish(); reject(error); });
  });
}

export async function createClickCueProcessor({ context, latencySeconds, signal, onError }: {
  context: AudioContext;
  latencySeconds: number;
  signal: AbortSignal;
  onError(error: Error): void;
}): Promise<ClickCueProcessor> {
  if (!Number.isFinite(latencySeconds) || latencySeconds < 0 || latencySeconds > 1) {
    throw new Error("Invalid click processing latency.");
  }
  const cancellation = new AbortController();
  let node: AudioWorkletNode | null = null;
  let disposed = false;
  let enabled = false;
  let requestId = 0;
  let commands = Promise.resolve();
  const pending = new Map<number, () => void>();
  const check = () => cancellation.signal.throwIfAborted();
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    cancellation.abort(new DOMException("Click processor was disposed.", "AbortError"));
    signal.removeEventListener("abort", abort);
    pending.clear();
    node?.disconnect();
    node?.port.close();
  };
  const abort = () => {
    cancellation.abort(signal.reason);
    dispose();
  };
  signal.addEventListener("abort", abort, { once: true });
  if (signal.aborted) abort();
  const prepare = () => {
    const operation = commands.then(async () => {
      check();
      if (!node) throw new Error("Click processor is unavailable.");
      const id = ++requestId;
      const response = new Promise<void>((resolve) => { pending.set(id, resolve); });
      try {
        node.port.postMessage({ type: "prepare", id });
        await bounded(response, cancellation.signal);
        check();
      } finally {
        pending.delete(id);
      }
    });
    commands = operation.catch(() => undefined);
    return operation;
  };
  try {
    check();
    // The worker URL pipeline transpiles and bundles TypeScript into standalone
    // JavaScript for addModule. A plain ?url import would ship uncompiled TS.
    await bounded(context.audioWorklet.addModule(clickCueModuleUrl), cancellation.signal);
    check();
    node = new AudioWorkletNode(context, "mimicopy-click-cue", {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [2],
      channelCount: 2,
      channelCountMode: "explicit",
      channelInterpretation: "discrete",
      processorOptions: { latencySeconds }
    });
    const gate = node.parameters.get("enabled");
    if (!gate) throw new Error("Click processor output gate is unavailable.");
    node.port.onmessage = ({ data }: MessageEvent<unknown>) => {
      if (typeof data !== "object" || data === null || !("type" in data) || data.type !== "prepared") return;
      if ("id" in data && typeof data.id === "number") pending.get(data.id)?.();
    };
    node.addEventListener("processorerror", () => {
      if (!cancellation.signal.aborted) {
        onError(new Error("クリック音の音声処理が停止しました。ページを再読み込みしてください。"));
      }
    });
    await prepare();
    check();
    return { node, prepare, dispose,
      setEnabled(nextEnabled) {
        if (cancellation.signal.aborted || nextEnabled === enabled) return;
        enabled = nextEnabled;
        gate.setValueAtTime(enabled ? 1 : 0, context.currentTime);
        // The AudioParam cuts output at the audio boundary. Requiring the
        // command too prevents a late update from erasing a newly enabled tone;
        // an off/on pair between render quanta still drops an active tone.
        node?.port.postMessage({ type: "set-enabled", enabled });
      }
    };
  } catch (error) {
    dispose();
    throw error;
  }
}
