type Rf64Clock = { performanceTime: number; contextTime: number; mediaTime: number; duration: number;
  paused: boolean; ended: boolean; seeking: boolean; readyState: number; contextState: AudioContextState };
type Rf64Capture = { protocol: string; target: number; sampleRate: number; startFrame: number; frames: number;
  streams: string[]; inputChannelCounts: number[]; userAgent: string; actions: Array<Rf64Clock & { name: string; trusted?: boolean }>;
  events: Array<Rf64Clock & { name: string }>; clocks: Rf64Clock[] };
declare global { interface Window { __rf64Result?: Rf64Capture; __rf64Error?: string } }
const target = 7198.4;
const run = new URL(location.href).searchParams.get("run") ?? "native-ios-rf64-2h";
const audio = document.createElement("audio"); audio.preload = "metadata"; audio.src = `/fixture-2h.rf64.wav?run=${encodeURIComponent(run)}`;
audio.setAttribute("aria-label", "Two-hour RF64 transport"); document.body.append(audio);
const context = new AudioContext({ sampleRate: 48_000, latencyHint: "interactive" });
const source = context.createMediaElementSource(audio);
const actions: Rf64Capture["actions"] = [], events: Rf64Capture["events"] = [], clocks: Rf64Clock[] = [];
const snapshot = (): Rf64Clock => ({ performanceTime: performance.now(), contextTime: context.currentTime,
  mediaTime: audio.currentTime, duration: audio.duration, paused: audio.paused, ended: audio.ended,
  seeking: audio.seeking, readyState: audio.readyState, contextState: context.state });
const action = (name: string, trusted?: boolean) => actions.push({ name, ...snapshot(), trusted });
for (const name of ["loadedmetadata", "durationchange", "play", "playing", "pause", "seeking", "seeked", "waiting", "stalled", "ended", "error"]) {
  audio.addEventListener(name, () => events.push({ name, ...snapshot() }));
}
const prepare = document.querySelector<HTMLButtonElement>("#prepare")!;
const start = document.querySelector<HTMLButtonElement>("#start")!;
const status = document.querySelector<HTMLElement>("#status")!;
const fail = (reason: unknown) => { audio.pause(); window.__rf64Error = String(reason); status.textContent = String(reason); };
const waitFor = (predicate: () => boolean) => new Promise<void>((resolve, reject) => {
  const deadline = performance.now() + 15_000;
  const poll = () => { if (predicate()) resolve(); else if (audio.error || performance.now() > deadline) reject(new Error(audio.error?.message ?? "Native preparation timeout")); else window.setTimeout(poll, 10); }; poll();
});
const code = `class Rf64Recorder extends AudioWorkletProcessor {
 constructor(){super();this.capture=null;this.port.onmessage=({data})=>{this.capture={position:0,start:null,frames:data.frames,counts:new Set(),streams:Array.from({length:8},()=>new Float32Array(data.frames))};};}
 process(inputs,outputs){for(const out of outputs)for(const channel of out)channel.fill(0);const c=this.capture;if(c){if(c.start===null){c.start=currentFrame;this.port.postMessage({type:'armed'});}const count=Math.min(128,c.frames-c.position);c.counts.add(inputs[0]?.length??0);for(let channel=0;channel<8;channel++){const input=inputs[0]?.[channel];if(input)c.streams[channel].set(input.subarray(0,count),c.position);}c.position+=count;if(c.position===c.frames){this.capture=null;this.port.postMessage({type:'capture',start:c.start,frames:c.frames,streams:c.streams,counts:[...c.counts]},c.streams.map(s=>s.buffer));}}return true;}
}registerProcessor('rf64-recorder',Rf64Recorder);`;
const url = URL.createObjectURL(new Blob([code], { type: "text/javascript" }));
try {
  await context.audioWorklet.addModule(url);
  const recorder = new AudioWorkletNode(context, "rf64-recorder", { numberOfInputs: 1, numberOfOutputs: 1,
    outputChannelCount: [1], channelCount: 8, channelCountMode: "explicit", channelInterpretation: "discrete" });
  source.connect(recorder); recorder.connect(context.destination);
  prepare.disabled = false; status.textContent = "Ready. Prepare warms native transport, then seeks to 7198.4 seconds.";
  prepare.addEventListener("click", (event) => {
    action("trusted-prepare", event.isTrusted); prepare.disabled = true;
    void (async () => {
      await Promise.all([context.resume(), audio.play()]);
      await waitFor(() => audio.currentTime >= .3); audio.pause(); action("warm-paused");
      audio.load(); await waitFor(() => audio.readyState >= 1); action("reloaded-metadata");
      await new Promise<void>((resolve, reject) => {
        const timer = window.setTimeout(() => { audio.removeEventListener("seeked", done); reject(new Error("Seeked timeout")); }, 15_000);
        const done = () => { window.clearTimeout(timer); resolve(); };
        audio.addEventListener("seeked", done, { once: true }); action("seek-call"); audio.currentTime = target;
      });
      await waitFor(() => !audio.seeking && audio.readyState >= 2 && Math.abs(audio.currentTime - target) < 1 / 48_000);
      action("seek-ready"); start.disabled = false;
      status.textContent = `Prepared: duration ${audio.duration}s, position ${audio.currentTime}s. Press Start capture.`;
    })().catch(fail);
  });
  start.addEventListener("click", (event) => {
    action("trusted-start", event.isTrusted); start.disabled = true; status.textContent = "Recording three seconds of actual native eight-channel PCM…";
    const interval = window.setInterval(() => clocks.push(snapshot()), 10);
    const timeout = window.setTimeout(() => { window.clearInterval(interval); fail(new Error("RF64 capture timeout")); }, 15_000);
    recorder.port.onmessage = ({ data }: MessageEvent<{ type: string; start: number; frames: number; streams: Float32Array[]; counts: number[] }>) => {
      if (data.type === "armed") { action("capture-armed"); void audio.play().catch(fail); return; }
      window.clearInterval(interval); window.clearTimeout(timeout); action("capture-complete"); audio.pause();
      const streams = data.streams.map((stream) => { const bytes = new Uint8Array(stream.buffer); let text = "";
        for (let i = 0; i < bytes.length; i += 8192) text += String.fromCharCode(...bytes.subarray(i, i + 8192)); return btoa(text); });
      const capture: Rf64Capture = { protocol: "mimicopy-large-rf64-v1", target, sampleRate: context.sampleRate,
        startFrame: data.start, frames: data.frames, streams, inputChannelCounts: data.counts,
        userAgent: navigator.userAgent, actions, events, clocks };
      window.__rf64Result = capture;
      void fetch(`/report?run=${encodeURIComponent(run)}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(capture) })
        .then(async (response) => { if (!response.ok) throw new Error(`Save failed ${response.status}`); status.textContent = `Saved ${await response.text()}. Playback paused.`; })
        .catch(fail);
    };
    void context.resume().then(() => recorder.port.postMessage({ frames: context.sampleRate * 3 })).catch(fail);
  });
} catch (reason) { fail(reason); } finally { URL.revokeObjectURL(url); }
