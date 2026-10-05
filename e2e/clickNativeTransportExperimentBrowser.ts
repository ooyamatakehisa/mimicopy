type TransportSnapshot = {
  contextTime: number; mediaTime: number; performanceTime: number;
  paused: boolean; seeking: boolean; readyState: number; networkState: number; contextState: AudioContextState;
};
type NativeTransportCapture = {
  codec: string; sampleRate: number; frames: number; startFrame: number;
  streams: string[]; inputChannelCounts: number[];
  clocks: TransportSnapshot[];
  events: Array<TransportSnapshot & { event: string }>;
  userAgent: string; baseLatency: number; outputLatency: number | null;
  scenario: string; target: number; padded: boolean; order: "legacy" | "immediate" | "wait-seeked";
  actions: Array<TransportSnapshot & { event: string; trusted?: boolean; target?: number; workletFrame?: number }>;
};
declare global { interface Window { __nativeTransportResult: NativeTransportCapture | null; __nativeTransportError: string | null } }

const codec = new URL(location.href).searchParams.get("codec") === "flac" ? "flac" : "wav";
const options = new URL(location.href).searchParams;
const scenario = options.get("scenario") === "reload" ? "reload" : options.get("scenario") === "warm" ? "warm" : "fresh";
const target = Number(options.get("target") ?? 0);
if (!Number.isFinite(target) || target < 0 || target > 5) throw new Error("Experiment target must be between zero and five seconds.");
const order = options.get("order") === "immediate" ? "immediate" : options.get("order") === "wait-seeked" ? "wait-seeked" : "legacy";
const padded = options.get("padded") === "1";
const actions: NativeTransportCapture["actions"] = [];
const audio = document.createElement("audio");
audio.preload = "auto"; audio.src = `/fixture${padded ? "-padded" : ""}.${codec}`;
audio.setAttribute("aria-label", "Experimental eight channel transport");
document.body.append(audio);
const context = new AudioContext({ sampleRate: 48_000, latencyHint: "interactive" });
const source = context.createMediaElementSource(audio);
const snapshot = (): TransportSnapshot => ({ contextTime: context.currentTime, mediaTime: audio.currentTime,
  performanceTime: performance.now(), paused: audio.paused, seeking: audio.seeking,
  readyState: audio.readyState, networkState: audio.networkState, contextState: context.state });
const action = (event: string, detail: { trusted?: boolean; target?: number; workletFrame?: number } = {}) => actions.push({ event, ...snapshot(), ...detail });
const events: NativeTransportCapture["events"] = [];
for (const event of ["play", "playing", "pause", "waiting", "seeking", "seeked", "loadedmetadata", "loadeddata", "canplay", "emptied", "ended", "error"]) {
  audio.addEventListener(event, () => events.push({ event, ...snapshot() }));
}
const code = `class CaptureEight extends AudioWorkletProcessor {
  constructor(){super();this.capture=null;this.warm=null;this.port.onmessage=({data})=>{
    if(data.type==='arm')this.capture={position:0,start:null,frames:data.frames,counts:new Set(),streams:Array.from({length:8},()=>new Float32Array(data.frames))};
    if(data.type==='warm')this.warm={started:false,frames:0};
  };}
  process(inputs,outputs){for(const output of outputs)for(const channel of output)channel.fill(0);
    if(this.warm){const input=inputs[0]?.[0];if(!this.warm.started&&input?.some(value=>Math.abs(value)>.0001)){this.warm.started=true;this.port.postMessage({type:'warm-first-pcm',frame:currentFrame});}
      if(this.warm.started){this.warm.frames+=128;if(this.warm.frames>=sampleRate*.3){this.warm=null;this.port.postMessage({type:'warm-complete',frame:currentFrame+128});}}}
    const capture=this.capture;if(capture){if(capture.start===null)capture.start=currentFrame;
      const count=Math.min(128,capture.frames-capture.position);capture.counts.add(inputs[0]?.length??0);
      for(let channel=0;channel<8;channel++){const input=inputs[0]?.[channel];if(input)capture.streams[channel].set(input.subarray(0,count),capture.position);}
      capture.position+=count;if(capture.position===capture.frames){this.capture=null;this.port.postMessage({start:capture.start,frames:capture.frames,streams:capture.streams,counts:[...capture.counts]},capture.streams.map(stream=>stream.buffer));}
    }return true;
  }
}registerProcessor('capture-eight',CaptureEight);`;
const moduleUrl = URL.createObjectURL(new Blob([code], { type: "text/javascript" }));
const button = document.querySelector<HTMLButtonElement>("#start")!;
const status = document.querySelector<HTMLElement>("#status")!;
window.__nativeTransportResult = null; window.__nativeTransportError = null;
try {
  await context.audioWorklet.addModule(moduleUrl);
  const recorder = new AudioWorkletNode(context, "capture-eight", {
    numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1],
    channelCount: 8, channelCountMode: "explicit", channelInterpretation: "discrete"
  });
  source.connect(recorder); recorder.connect(context.destination);
  // The experiment records the actual media source; quiet monitor playback is unchanged PCM.
  const monitor = context.createGain(); monitor.gain.value = .05;
  source.connect(monitor); monitor.connect(context.destination);
  const waitForMedia = (predicate: () => boolean) => new Promise<void>((resolve, reject) => {
    const deadline = performance.now() + 10_000;
    const poll = () => {
      if (predicate()) { resolve(); return; }
      if (performance.now() >= deadline || audio.error) { reject(new Error(audio.error?.message ?? "Native media preparation timed out.")); return; }
      window.setTimeout(poll, 10);
    }; poll();
  });
  const assignTarget = () => {
    action("seek-call", { target });
    audio.currentTime = target;
    action("seek-assigned", { target });
  };
  const seekAndWait = async () => {
    // A one-frame target is inside the old 1ms polling tolerance. Require a real
    // seeked event so the paused-seek control cannot accidentally become immediate.
    await new Promise<void>((resolve, reject) => {
      const cleanup = () => { window.clearTimeout(timer); audio.removeEventListener("seeked", onSeeked); };
      const onSeeked = () => { cleanup(); action("seeked-observed", { target }); resolve(); };
      const timer = window.setTimeout(() => { cleanup(); reject(new Error("Explicit seeked event timed out.")); }, 10_000);
      audio.addEventListener("seeked", onSeeked);
      try { assignTarget(); } catch (error) { cleanup(); reject(error); }
    });
    await waitForMedia(() => !audio.seeking && Math.abs(audio.currentTime - target) <= 1 / 48_000 && audio.readyState >= 2);
    action("seek-ready", { target });
  };
  const play = (phase: "warm" | "capture") => {
    action(`${phase}-play-call`);
    const promise = audio.play();
    action(`${phase}-play-returned`);
    return promise.then(() => { action(`${phase}-play-resolved`); });
  };
  let prepared = scenario === "fresh";
  if (order !== "legacy") {
    await waitForMedia(() => audio.readyState >= 1);
    action("initial-metadata-ready");
    if (scenario === "fresh" && order === "wait-seeked") await seekAndWait();
  }
  if (!prepared) button.textContent = "Prepare warm transport";
  button.disabled = false; status.textContent = `Ready: native ${codec.toUpperCase()} with 8 channels. Press Start once.`;
  button.addEventListener("click", (gesture) => {
    button.disabled = true;
    action(prepared ? "trusted-replay" : "trusted-warm", { trusted: gesture.isTrusted });
    if (!prepared) {
      monitor.gain.value = 0;
      const warm = new Promise<void>((resolve, reject) => {
        const timer = window.setTimeout(() => reject(new Error("No 300ms native warm PCM arrived.")), 10_000);
        recorder.port.onmessage = ({ data }: MessageEvent<{ type?: string; frame?: number }>) => {
          if (data.type === "warm-first-pcm") action(data.type, { workletFrame: data.frame });
          if (data.type === "warm-complete") { action(data.type, { workletFrame: data.frame }); window.clearTimeout(timer); resolve(); }
        };
      });
      recorder.port.postMessage({ type: "warm" });
      void (async () => {
        await Promise.all([context.resume(), play("warm"), warm]);
        audio.pause(); action("warm-pause");
        if (scenario === "reload") {
          audio.load(); action("reload");
          await waitForMedia(() => audio.readyState >= 1);
          action("reload-metadata-ready");
        }
        if (order === "wait-seeked") await seekAndWait();
        else if (order === "legacy") {
          assignTarget();
          await waitForMedia(() => !audio.seeking && Math.abs(audio.currentTime - target) < .001 && audio.readyState >= 2);
          action("seek-ready", { target });
        } else action("seek-deferred-to-trusted-start", { target });
        prepared = true; button.textContent = "Start capture"; button.disabled = false;
        status.textContent = `Prepared ${scenario} target ${target}; press Start for trusted replay.`;
      })().catch((error: unknown) => { window.__nativeTransportError = String(error); status.textContent = String(error); });
      return;
    }
    monitor.gain.value = .05;
    const clocks: NativeTransportCapture["clocks"] = [];
    const sampleClock = () => clocks.push(snapshot());
    sampleClock();
    const interval = window.setInterval(sampleClock, 10);
    const timeout = window.setTimeout(() => {
      window.clearInterval(interval); audio.pause();
      window.__nativeTransportError = "Native eight-channel capture timed out.";
      status.textContent = window.__nativeTransportError;
    }, 15_000);
    recorder.port.onmessage = (event: MessageEvent<{ start: number; frames: number; streams: Float32Array[]; counts: number[] }>) => {
      window.clearInterval(interval); window.clearTimeout(timeout); audio.pause();
      const streams = event.data.streams.map((stream) => {
        const bytes = new Uint8Array(stream.buffer, stream.byteOffset, stream.byteLength);
        let value = ""; for (let offset = 0; offset < bytes.length; offset += 8192) value += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
        return btoa(value);
      });
      const capture: NativeTransportCapture = { codec, sampleRate: context.sampleRate,
        frames: event.data.frames, startFrame: event.data.start, streams, inputChannelCounts: event.data.counts,
        clocks, events, userAgent: navigator.userAgent, baseLatency: context.baseLatency,
        outputLatency: Number.isFinite(context.outputLatency) ? context.outputLatency : null,
        scenario, target, padded, order, actions };
      window.__nativeTransportResult = capture;
      const run = new URL(location.href).searchParams.get("run") ?? `manual-${codec}`;
      void fetch(`/report?run=${encodeURIComponent(run)}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(capture) })
        .then((response) => { if (!response.ok) throw new Error(`Report save failed ${response.status}`); status.textContent = `Saved ${run}; playback is paused.`; })
        .catch((error: unknown) => { window.__nativeTransportError = String(error); status.textContent = String(error); });
    };
    recorder.port.postMessage({ type: "arm", frames: 4 * context.sampleRate });
    action("capture-armed");
    // Both native operations execute in the real trusted button gesture.
    // In the immediate cases there is deliberately no await, timer, or seeked
    // callback between assigning currentTime and invoking play(). Raw PCM must
    // establish whether any old source frames escape before the native seek.
    const resumed = context.resume();
    if (order === "immediate") assignTarget();
    void Promise.all([resumed, play("capture")]).catch((error: unknown) => {
      window.__nativeTransportError = String(error); status.textContent = String(error);
    });
    status.textContent = "Recording the first four seconds, including native startup.";
  });
} catch (error) { window.__nativeTransportError = String(error); status.textContent = String(error); }
finally { URL.revokeObjectURL(moduleUrl); }
