import createStretch, { type StretchNode } from "signalsmith-stretch";
import stretchModuleUrl from "signalsmith-stretch?url";

const configuration = { blockMs: 120, intervalMs: 30, splitComputation: false };
const commandTimeoutMs = 15_000;
// Load the official module unchanged in the worklet. Serializing bundled
// functions into a Blob can break their closure dependencies after minifying.
createStretch.moduleUrl = stretchModuleUrl;

export type PitchProcessor = {
  node: AudioWorkletNode;
  latencySeconds: number;
  prepare(): Promise<void>;
  updatePitch(): Promise<void>;
  dispose(): void;
};

export function getCompensationSemitones(semitones: number, playbackRate: number) {
  return semitones - 12 * Math.log2(playbackRate);
}

function bounded<T>(request: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const finish = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
    };
    const abort = () => { finish(); reject(signal.reason); };
    const timer = setTimeout(() => {
      finish();
      reject(new Error("音声処理の応答がありません。ページを再読み込みしてください。"));
    }, commandTimeoutMs);
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
    void request.then((value) => { finish(); resolve(value); }, (error: unknown) => { finish(); reject(error); });
  });
}

export async function createPitchProcessor({ context, element, semitones, signal, onError }: {
  context: AudioContext;
  element: HTMLMediaElement;
  semitones(): number;
  signal: AbortSignal;
  onError(error: Error): void;
}): Promise<PitchProcessor> {
  const cancellation = new AbortController();
  const abort = () => cancellation.abort(signal.reason);
  signal.addEventListener("abort", abort, { once: true });
  if (signal.aborted) abort();
  let node: StretchNode | null = null;
  let commands = Promise.resolve();
  const check = () => cancellation.signal.throwIfAborted();
  const dispose = () => {
    cancellation.abort(new DOMException("Audio processor was disposed.", "AbortError"));
    signal.removeEventListener("abort", abort);
    node?.disconnect();
    node?.port.close();
  };
  const schedule = async () => {
    check();
    if (!node) throw new Error("Audio processor is unavailable.");
    await bounded(node.schedule({ active: true,
      semitones: getCompensationSemitones(semitones(), element.playbackRate),
      tonalityHz: 0, formantCompensation: false
    }), cancellation.signal);
    check();
  };
  const enqueue = (run: () => Promise<void>) => {
    const operation = commands.then(async () => { check(); await run(); check(); });
    // Keep ordering after a rejected request; graph ownership decides whether
    // a later operation can proceed. No completion callback opens the output.
    commands = operation.catch(() => undefined);
    return operation;
  };
  try {
    check();
    const creating = createStretch(context, { numberOfInputs: 1, numberOfOutputs: 1,
      outputChannelCount: [2], channelCount: 2, channelCountMode: "explicit" });
    // The upstream factory has no cancellation API. Close a node that becomes
    // available after cancellation/timeout instead of attaching a stale graph.
    void creating.then((created) => {
      if (cancellation.signal.aborted) { created.disconnect(); created.port.close(); }
    }, () => undefined);
    node = await bounded(creating, cancellation.signal);
    check();
    node.addEventListener("processorerror", () => {
      if (!cancellation.signal.aborted) onError(new Error("音声処理が停止しました。ページを再読み込みしてください。"));
    });
    await bounded(node.configure(configuration), cancellation.signal);
    check();
    const latencySeconds = await bounded(node.latency(), cancellation.signal);
    if (!Number.isFinite(latencySeconds) || latencySeconds < 0 || latencySeconds > 1) throw new Error("Invalid audio processing latency.");
    await schedule();
    return { node, latencySeconds, dispose,
      prepare: () => enqueue(async () => {
        if (!node) throw new Error("Audio processor is unavailable.");
        await bounded(node.configure(configuration), cancellation.signal);
        await schedule();
      }),
      updatePitch: () => enqueue(schedule)
    };
  } catch (error) {
    dispose();
    throw error;
  }
}
