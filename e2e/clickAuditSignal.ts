export type ClickAuditClock = {
  performanceTime: number;
  contextTime: number;
  state: AudioContextState;
  sampleRate: number;
  baseLatency: number | null;
  outputLatency: number | null;
  outputTimestamp: { contextTime: number; performanceTime: number } | null;
  mediaTime: number | null;
  rate: number | null;
  paused: boolean | null;
  readyState: number | null;
};
export type ClickAuditEvent = ClickAuditClock & { event: string; scheduledTime?: number; frequency?: number };
export type ClickAuditCapture = {
  protocol: "mimicopy-click-pcm-v1";
  sampleRate: number;
  frames: number;
  startContextTime: number;
  encoding: "float32-le-base64";
  pcm: Record<"musicLeft" | "musicRight" | "clickLeft" | "clickRight" | "nativeLeft" | "nativeRight", string> &
    Partial<Record<"normalCue" | "downbeatCue", string>>;
  clocks: ClickAuditClock[];
  events: ClickAuditEvent[];
  routing: { musicDestinationNodes: number; clickDestinationNodes: number; sourceElements: number };
};
type ClickAuditProbe = {
  status(): { ready: boolean; error: string | null; clock: ClickAuditClock | null; musicDestinationNodes: number };
  arm(durationMs: number): Promise<void>;
  result(): Promise<ClickAuditCapture>;
};
declare global { interface Window { __clickAudit: ClickAuditProbe } }

/** Observe real connections and timestamps; never replace native media playback or clocks. */
export function installClickAuditProbe() {
  const nativeConnect = AudioNode.prototype.connect;
  const nativeDisconnect = AudioNode.prototype.disconnect;
  const nativeSource = AudioContext.prototype.createMediaElementSource;
  const nativeStart = OscillatorNode.prototype.start;
  const clickNodes = new WeakSet<AudioNode>();
  const edges = new Map<AudioNode, Set<AudioNode>>();
  const sources = new Map<AudioContext, Set<HTMLMediaElement>>();
  const destinations = new Map<AudioContext, { music: Set<AudioNode>; clicks: Set<AudioNode> }>();
  const events: ClickAuditEvent[] = [];
  let context: AudioContext | null = null;
  let element: HTMLMediaElement | null = null;
  let ready = false;
  let error: string | null = null;
  let recorder: AudioWorkletNode | null = null;
  let buses: GainNode[] = [];
  const tapped = new WeakMap<AudioNode, number>();
  let recording: Promise<ClickAuditCapture> | null = null;
  let resolveRecording: ((value: ClickAuditCapture) => void) | null = null;
  let rejectRecording: ((reason: unknown) => void) | null = null;
  let resolveArmed: (() => void) | null = null;
  let rejectArmed: ((reason: unknown) => void) | null = null;
  let interval = 0;
  let timeout = 0;
  let clocks: ClickAuditClock[] = [];
  let eventStart = 0;

  const clock = (audioContext: AudioContext): ClickAuditClock => {
    const timestamp = typeof audioContext.getOutputTimestamp === "function" ? audioContext.getOutputTimestamp() : null;
    return {
      performanceTime: performance.now(), contextTime: audioContext.currentTime,
      state: audioContext.state, sampleRate: audioContext.sampleRate,
      baseLatency: Number.isFinite(audioContext.baseLatency) ? audioContext.baseLatency : null,
      outputLatency: Number.isFinite(audioContext.outputLatency) ? audioContext.outputLatency : null,
      outputTimestamp: timestamp && Number.isFinite(timestamp.contextTime) && Number.isFinite(timestamp.performanceTime)
        ? { contextTime: timestamp.contextTime!, performanceTime: timestamp.performanceTime! } : null,
      mediaTime: element?.currentTime ?? null, rate: element?.playbackRate ?? null,
      paused: element?.paused ?? null, readyState: element?.readyState ?? null
    };
  };
  const connect = (from: AudioNode, to: AudioNode, input = 0) => {
    Reflect.apply(nativeConnect, from, [to, 0, input]);
  };
  const tap = (node: AudioNode, index: number) => {
    if (!buses[index] || tapped.get(node) === index) return;
    const previous = tapped.get(node);
    if (previous !== undefined && buses[previous]) Reflect.apply(nativeDisconnect, node, [buses[previous]]);
    connect(node, buses[index]);
    tapped.set(node, index);
  };
  const markClick = (node: AudioNode) => {
    if (clickNodes.has(node)) return;
    clickNodes.add(node);
    const audioContext = node.context as AudioContext;
    const routes = destinations.get(audioContext);
    if (routes?.music.delete(node)) {
      routes.clicks.add(node);
      if (audioContext === context) tap(node, 1);
    }
    edges.get(node)?.forEach((next) => { if (!(next instanceof AudioDestinationNode)) markClick(next); });
  };
  window.AudioWorkletNode = new Proxy(AudioWorkletNode, {
    construct(target, argumentsList, newTarget) {
      const node = Reflect.construct(target, argumentsList, newTarget) as AudioWorkletNode;
      if (argumentsList[1] === "mimicopy-click-cue") markClick(node);
      return node;
    }
  });
  const toBase64 = (value: Float32Array) => {
    const bytes = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    let binary = "";
    for (let offset = 0; offset < bytes.length; offset += 8192) {
      binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
    }
    return btoa(binary);
  };
  const initialize = async (audioContext: AudioContext, source: MediaElementAudioSourceNode) => {
    try {
      buses = Array.from({ length: 4 }, () => {
        const gain = audioContext.createGain();
        gain.channelCount = 2; gain.channelCountMode = "explicit";
        return gain;
      });
      // Discard cue channels6/7 and other stems explicitly. A speaker downmix
      // of the new eight-channel stream would contaminate the native reference.
      const nativeSplitter = audioContext.createChannelSplitter(8);
      const nativeStereo = audioContext.createChannelMerger(2);
      Reflect.apply(nativeConnect, source, [nativeSplitter]);
      Reflect.apply(nativeConnect, nativeSplitter, [nativeStereo, 0, 0]);
      Reflect.apply(nativeConnect, nativeSplitter, [nativeStereo, 1, 1]);
      tap(nativeStereo, 2);
      const cueStereo = audioContext.createChannelMerger(2);
      Reflect.apply(nativeConnect, nativeSplitter, [cueStereo, 6, 0]);
      Reflect.apply(nativeConnect, nativeSplitter, [cueStereo, 7, 1]);
      tap(cueStereo, 3);
      const existing = destinations.get(audioContext);
      existing?.music.forEach((node) => tap(node, 0));
      existing?.clicks.forEach((node) => tap(node, 1));
      const worklet = `class ClickAuditRecorder extends AudioWorkletProcessor {
        constructor() { super(); this.capture = null; this.port.onmessage = ({data}) => {
          if (data.type === 'arm') this.capture = { frames:data.frames, position:0, start:null,
            streams:Array.from({length:8},()=>new Float32Array(data.frames)) };
        }; }
        process(inputs, outputs) {
          for (const output of outputs) for (const channel of output) channel.fill(0);
          const capture = this.capture;
          if (capture) {
            if (capture.start === null) { capture.start = currentFrame; this.port.postMessage({type:'armed'}); }
            const count = Math.min(128, capture.frames - capture.position);
            for (let input=0;input<4;input++) for (let side=0;side<2;side++) {
              const source = inputs[input]?.[side] ?? inputs[input]?.[0];
              if (source) capture.streams[input*2+side].set(source.subarray(0,count),capture.position);
            }
            capture.position += count;
            if (capture.position === capture.frames) {
              this.capture = null;
              this.port.postMessage({type:'capture',frames:capture.frames,start:capture.start,
                streams:capture.streams},capture.streams.map(stream=>stream.buffer));
            }
          }
          return true;
        }
      }; registerProcessor('click-audit-recorder',ClickAuditRecorder);`;
      const url = URL.createObjectURL(new Blob([worklet], { type: "text/javascript" }));
      try { await audioContext.audioWorklet.addModule(url); } finally { URL.revokeObjectURL(url); }
      if (context !== audioContext || audioContext.state === "closed") return;
      recorder = new AudioWorkletNode(audioContext, "click-audit-recorder", {
        numberOfInputs: 4, numberOfOutputs: 1, outputChannelCount: [1], channelCount: 2, channelCountMode: "explicit"
      });
      buses.forEach((bus, index) => connect(bus, recorder!, index));
      connect(recorder, audioContext.destination);
      recorder.port.onmessage = (message: MessageEvent<{ type: string; frames: number; start: number; streams: Float32Array[] }>) => {
        if (message.data.type === "armed") { resolveArmed?.(); resolveArmed = null; rejectArmed = null; return; }
        if (message.data.type !== "capture") return;
        clearInterval(interval); clearTimeout(timeout);
        const streams = message.data.streams.map(toBase64);
        const routes = destinations.get(audioContext);
        resolveRecording?.({ protocol: "mimicopy-click-pcm-v1", sampleRate: audioContext.sampleRate,
          frames: message.data.frames, startContextTime: message.data.start / audioContext.sampleRate,
          encoding: "float32-le-base64", pcm: {
            musicLeft: streams[0], musicRight: streams[1], clickLeft: streams[2], clickRight: streams[3],
            nativeLeft: streams[4], nativeRight: streams[5], normalCue: streams[6], downbeatCue: streams[7]
          }, clocks, events: events.slice(eventStart), routing: {
            musicDestinationNodes: routes?.music.size ?? 0, clickDestinationNodes: routes?.clicks.size ?? 0,
            sourceElements: [...sources].reduce((count, [owner, elements]) => count + (owner.state === "closed" ? 0 : elements.size), 0)
          } });
        resolveRecording = null; rejectRecording = null;
      };
      ready = true;
    } catch (reason) { if (context === audioContext) error = reason instanceof Error ? reason.message : String(reason); }
  };

  AudioNode.prototype.connect = function (this: AudioNode, destination: AudioNode | AudioParam, output?: number, input?: number) {
    const args: unknown[] = [destination];
    if (output !== undefined) args.push(output);
    if (input !== undefined) args.push(input);
    const result: unknown = Reflect.apply(nativeConnect, this, args);
    if (destination instanceof AudioNode) {
      let outgoing = edges.get(this);
      if (!outgoing) { outgoing = new Set(); edges.set(this, outgoing); }
      outgoing.add(destination);
      if (!(destination instanceof AudioDestinationNode) && (this instanceof OscillatorNode || clickNodes.has(this))) markClick(destination);
    }
    if (destination instanceof AudioDestinationNode && this.context instanceof AudioContext) {
      const audioContext = this.context;
      let routes = destinations.get(audioContext);
      if (!routes) { routes = { music: new Set(), clicks: new Set() }; destinations.set(audioContext, routes); }
      const isClick = clickNodes.has(this);
      (isClick ? routes.clicks : routes.music).add(this);
      if (audioContext === context) tap(this, isClick ? 1 : 0);
    }
    return result;
  } as typeof AudioNode.prototype.connect;
  AudioContext.prototype.createMediaElementSource = function (mediaElement) {
    const source = nativeSource.call(this, mediaElement);
    if (mediaElement.getAttribute("aria-label") === "Original audio") {
      context = source.context as AudioContext; element = mediaElement;
      let elements = sources.get(context);
      if (!elements) { elements = new Set(); sources.set(context, elements); }
      elements.add(mediaElement);
      ready = false; error = null; recorder = null; buses = [];
      for (const name of ["play", "playing", "pause", "seeking", "seeked", "loadedmetadata", "waiting", "ended", "ratechange"]) {
        mediaElement.addEventListener(name, () => { if (context === this) events.push({ event: name, ...clock(this) }); });
      }
      void initialize(this, source);
    }
    return source;
  };
  OscillatorNode.prototype.start = function (when = 0) {
    if (this.context instanceof AudioContext && this.context === context) {
      events.push({ event: "oscillator.start", scheduledTime: when, frequency: this.frequency.value, ...clock(this.context) });
    }
    return nativeStart.call(this, when);
  };
  window.__clickAudit = {
    status: () => ({ ready, error, clock: context ? clock(context) : null,
      musicDestinationNodes: context ? destinations.get(context)?.music.size ?? 0 : 0 }),
    arm: async (durationMs) => {
      if (!ready || !context || !recorder || context.state !== "running") throw new Error("Click probe is not ready on a running context.");
      if (resolveRecording) throw new Error("A click capture is already running.");
      const audioContext = context;
      clocks = [clock(context)]; eventStart = events.length;
      recording = new Promise((resolve, reject) => { resolveRecording = resolve; rejectRecording = reject; });
      void recording.catch(() => undefined);
      interval = window.setInterval(() => clocks.push(clock(audioContext)), 20);
      timeout = window.setTimeout(() => {
        const failure = new Error("Click PCM capture timed out.");
        clearInterval(interval); rejectRecording?.(failure); rejectArmed?.(failure);
        resolveRecording = null; rejectRecording = null;
        resolveArmed = null; rejectArmed = null;
      }, durationMs + 10_000);
      const armed = new Promise<void>((resolve, reject) => { resolveArmed = resolve; rejectArmed = reject; });
      recorder.port.postMessage({ type: "arm", frames: Math.round(durationMs * context.sampleRate / 1000) });
      await armed;
    },
    result: () => recording ?? Promise.reject(new Error("Click capture has not been armed."))
  };
}

installClickAuditProbe();
