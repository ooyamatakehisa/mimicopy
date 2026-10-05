import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { expect, webkit } from "@playwright/test";
import type { AudioMeasurement } from "./audioAuditSignal";

type EndSnapshot = {
  performanceTime: number; contextTime: number | null; mediaTime: number | null; duration: number | null;
  paused: boolean | null; ended: boolean | null; seeking: boolean | null; readyState: number | null;
  contextState: AudioContextState | null; preparation: boolean; playEnabled: boolean; stopVisible: boolean;
};
type EndAction = EndSnapshot & { name: string; trusted?: boolean };
type EndPcm = { sampleRate: number; startFrame: number; frames: number; streams: string[] };
type EndProbe = {
  prepare(): Promise<void>; arm(durationMs: number): Promise<void>; result(): Promise<EndPcm>;
  record(name: string): EndSnapshot; snapshot(): EndSnapshot;
  finish(): { actions: EndAction[]; events: EndAction[]; clocks: EndSnapshot[]; outputNodes: number };
};
declare global { interface Window { __endAudit: EndProbe } }

// This file is a separate diagnostic. It does not replace production routes,
// seek native media directly, or relax the matrix's historical failed evidence.
const output = path.resolve(process.env.MIMICOPY_AUDIO_AUDIT_OUTPUT ?? "audio-audit.local/end-replay");
const port = process.env.MIMICOPY_AUDIO_AUDIT_PORT ?? "8197";
const repetitions = Number(process.env.MIMICOPY_AUDIO_AUDIT_REPEATS ?? 3);
if (!Number.isInteger(repetitions) || repetitions < 1 || repetitions > 3) throw new Error("Expected 1–3 diagnostic repetitions.");
const container = process.env.MIMICOPY_AUDIO_AUDIT_CONTAINER ?? "wav";
const fixturePath = path.resolve(process.env.MIMICOPY_AUDIO_AUDIT_MIXER_FIXTURE ?? path.join(output, "fixture-mixer-wav.wav"));
await mkdir(output, { recursive: true });
const modulePaths = ["src/features/track/usePlaybackState.ts", "src/features/track/useAudioPitchShift.ts",
  "src/features/track/PlaybackAudio.tsx", "e2e/audioAuditSignal.ts", "e2e/audioAuditBrowser.ts", "e2e/audioAuditEndReplay.ts"];
const moduleHashes = Object.fromEntries(await Promise.all(modulePaths.map(async (filename) => [filename,
  createHash("sha256").update(await readFile(filename)).digest("hex")])));
const fixtureHash = createHash("sha256").update(await readFile(fixturePath)).digest("hex");
const browser = await webkit.launch();
const summaries: Array<{ repeat: number; error: string | null; endReady?: EndSnapshot; replayReady?: EndSnapshot; signal?: Omit<AudioMeasurement, "retainedPcm" | "stereoEvidence"> }> = [];
try {
  for (let repeat = 1; repeat <= repetitions; repeat++) {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    await page.addInitScript("window.__name = (value) => value");
    await page.addInitScript(() => {
      let context: AudioContext | null = null, source: MediaElementAudioSourceNode | null = null;
      let recorder: AudioWorkletNode | null = null;
      const outputs = new Set<GainNode>();
      const actions: EndAction[] = [], events: EndAction[] = [], clocks: EndSnapshot[] = [];
      const nativeConnect = AudioNode.prototype.connect;
      const nativeSource = AudioContext.prototype.createMediaElementSource;
      const snapshot = (): EndSnapshot => {
        const audio = document.querySelector<HTMLAudioElement>('audio[aria-label="Original audio"]');
        return { performanceTime: performance.now(), contextTime: context?.currentTime ?? null,
          mediaTime: audio?.currentTime ?? null, duration: audio?.duration ?? null,
          paused: audio?.paused ?? null, ended: audio?.ended ?? null, seeking: audio?.seeking ?? null,
          readyState: audio?.readyState ?? null, contextState: context?.state ?? null,
          preparation: Boolean(document.querySelector('[aria-label="Playback preparation"]')),
          playEnabled: document.querySelector<HTMLButtonElement>('button[title="再生"]')?.disabled === false,
          stopVisible: Boolean(document.querySelector('button[title="停止"]')) };
      };
      AudioContext.prototype.createMediaElementSource = function (audio) {
        const node = nativeSource.call(this, audio);
        if (audio.getAttribute("aria-label") === "Original audio") { context = node.context as AudioContext; source = node; }
        return node;
      };
      AudioNode.prototype.connect = function (this: AudioNode, destination: AudioNode | AudioParam, output?: number, input?: number) {
        const args: unknown[] = [destination];
        if (output !== undefined) args.push(output);
        if (input !== undefined) args.push(input);
        const result: unknown = Reflect.apply(nativeConnect, this, args);
        if (destination === this.context.destination && this instanceof GainNode) outputs.add(this);
        return result;
      } as typeof AudioNode.prototype.connect;
      for (const name of ["loadedmetadata", "durationchange", "play", "playing", "pause", "ended", "seeking", "seeked", "waiting", "stalled", "error"]) {
        document.addEventListener(name, (event) => {
          if (event.target instanceof HTMLAudioElement && event.target.getAttribute("aria-label") === "Original audio") events.push({ name, ...snapshot() });
        }, true);
      }
      document.addEventListener("click", (event) => {
        const button = event.target instanceof Element ? event.target.closest("button") : null;
        if (button) actions.push({ name: `button:${button.getAttribute("title") ?? button.textContent}`, trusted: event.isTrusted, ...snapshot() });
      }, true);
      let result: Promise<EndPcm> | null = null;
      let resolveResult: ((value: EndPcm) => void) | null = null;
      let rejectResult: ((reason: unknown) => void) | null = null;
      let resolveArmed: (() => void) | null = null;
      let rejectArmed: ((reason: unknown) => void) | null = null;
      let timeout = 0;
      const interval = window.setInterval(() => clocks.push(snapshot()), 10);
      window.__endAudit = {
        snapshot,
        record: (name) => { const state = snapshot(); actions.push({ name, ...state }); return state; },
        prepare: async () => {
          if (!context || !source || outputs.size !== 2) throw new Error("Expected one native source and two final production GainNodes.");
          const code = `class EndRecorder extends AudioWorkletProcessor {
            constructor(){super();this.capture=null;this.port.onmessage=({data})=>{
              this.capture={position:0,start:null,frames:data.frames,streams:Array.from({length:10},()=>new Float32Array(data.frames))};
            };}
            process(inputs,outputs){for(const output of outputs)for(const channel of output)channel.fill(0);
              const capture=this.capture;if(capture){if(capture.start===null){capture.start=currentFrame;this.port.postMessage({type:'armed'});}
                const count=Math.min(128,capture.frames-capture.position);
                for(let channel=0;channel<10;channel++){const input=channel<8?inputs[0]?.[channel]:inputs[1]?.[channel-8];
                  if(input)capture.streams[channel].set(input.subarray(0,count),capture.position);}
                capture.position+=count;if(capture.position===capture.frames){this.capture=null;
                  this.port.postMessage({type:'capture',startFrame:capture.start,frames:capture.frames,streams:capture.streams},capture.streams.map(stream=>stream.buffer));}
              }return true;}
          }registerProcessor('end-recorder',EndRecorder);`;
          const url = URL.createObjectURL(new Blob([code], { type: "text/javascript" }));
          try { await context.audioWorklet.addModule(url); } finally { URL.revokeObjectURL(url); }
          recorder = new AudioWorkletNode(context, "end-recorder", { numberOfInputs: 2, numberOfOutputs: 1,
            outputChannelCount: [1], channelCount: 8, channelCountMode: "explicit", channelInterpretation: "discrete" });
          Reflect.apply(nativeConnect, source, [recorder, 0, 0]);
          for (const node of outputs) Reflect.apply(nativeConnect, node, [recorder, 0, 1]);
          Reflect.apply(nativeConnect, recorder, [context.destination]);
          recorder.port.onmessage = ({ data }: MessageEvent<{ type: string; startFrame: number; frames: number; streams: Float32Array[] }>) => {
            if (data.type === "armed") { resolveArmed?.(); resolveArmed = null; rejectArmed = null; return; }
            window.clearTimeout(timeout);
            const streams = data.streams.map((stream) => {
              const bytes = new Uint8Array(stream.buffer); let encoded = "";
              for (let offset = 0; offset < bytes.length; offset += 8192) encoded += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
              return btoa(encoded);
            });
            resolveResult?.({ sampleRate: context!.sampleRate, startFrame: data.startFrame, frames: data.frames, streams });
            resolveResult = null; rejectResult = null;
          };
        },
        arm: async (durationMs) => {
          if (!context || context.state !== "running" || !recorder || resolveResult) throw new Error("End recorder is not ready.");
          result = new Promise((resolve, reject) => { resolveResult = resolve; rejectResult = reject; });
          void result.catch(() => undefined);
          const armed = new Promise<void>((resolve, reject) => { resolveArmed = resolve; rejectArmed = reject; });
          timeout = window.setTimeout(() => { const failure = new Error("Continuous end PCM timed out."); rejectResult?.(failure); rejectArmed?.(failure); }, durationMs + 15_000);
          recorder.port.postMessage({ frames: Math.round(durationMs * context.sampleRate / 1000) });
          await armed;
        },
        result: () => result ?? Promise.reject(new Error("End recorder was not armed.")),
        finish: () => { window.clearInterval(interval); return { actions, events, clocks, outputNodes: outputs.size }; }
      };
    });
    const runId = `end-replay-webkit-${repeat}`;
    let endPcm: EndPcm | null = null, replayPcm: EndPcm | null = null;
    let activeCapture: "end" | "replay" | null = null;
    let endReady: EndSnapshot | undefined, replayReady: EndSnapshot | undefined;
    let signal: AudioMeasurement | undefined, error: string | null = null;
    try {
      await page.goto(`http://127.0.0.1:${port}/tracks/audio-audit?run=${runId}`);
      await expect(page.getByTitle("再生", { exact: true })).toBeEnabled({ timeout: 45_000 });
      await page.waitForFunction(() => window.__audioAuditProbe?.status().ready);
      await page.getByTitle("再生", { exact: true }).click();
      await page.waitForFunction(() => { const audio = document.querySelector("audio"); return audio && !audio.paused && audio.currentTime > .3; }, undefined, { timeout: 15_000 });
      await page.getByTitle("停止", { exact: true }).click();
      await expect(page.getByLabel("Playback preparation")).toHaveCount(0, { timeout: 16_000 });
      await page.getByLabel("Audit end target label", { exact: true }).locator("..").locator("..").getByTitle("マーカーへ移動", { exact: true }).click();
      await page.waitForFunction(() => { const state = window.__endAudit.snapshot(); return state.paused && !state.seeking && !state.preparation &&
        state.readyState !== null && state.readyState >= 2 && state.mediaTime !== null && Math.abs(state.mediaTime - 239.4) < .001; }, undefined, { timeout: 16_000 });
      await page.evaluate(() => window.__endAudit.prepare());
      activeCapture = "end";
      await page.evaluate(() => window.__endAudit.arm(6000));
      await page.evaluate(() => window.__endAudit.record("end-play-before"));
      await page.getByTitle("再生", { exact: true }).click();
      await page.waitForFunction(() => { const state = window.__endAudit.snapshot(); return state.paused === false && !state.preparation &&
        state.mediaTime !== null && state.mediaTime >= 239.55; }, undefined, { timeout: 15_000 });
      await page.evaluate(() => window.__endAudit.record("legacy-play-readiness"));
      // Match the old helper's80ms settle then its1800ms end delay and200ms capture.
      await page.waitForTimeout(1880);
      await page.evaluate(() => window.__endAudit.record("legacy-end-capture-before"));
      await page.waitForTimeout(200);
      await page.evaluate(() => window.__endAudit.record("legacy-end-capture-after"));
      await page.waitForFunction(() => { const state = window.__endAudit.snapshot(); return state.paused && state.ended &&
        state.playEnabled && !state.stopVisible && !state.preparation; }, undefined, { timeout: 15_000 });
      endReady = await page.evaluate(() => window.__endAudit.record("native-and-ui-end-ready"));
      endPcm = await page.evaluate(() => window.__endAudit.result());
      activeCapture = "replay";
      await page.evaluate(() => window.__endAudit.arm(4000));
      await page.evaluate(() => window.__endAudit.record("explicit-replay-before"));
      await page.getByTitle("再生", { exact: true }).click();
      await page.waitForFunction(() => { const state = window.__endAudit.snapshot(); return state.paused === false && !state.ended && !state.preparation &&
        state.mediaTime !== null && state.mediaTime >= .15 && state.mediaTime < 2; }, undefined, { timeout: 15_000 });
      replayReady = await page.evaluate(() => window.__endAudit.record("explicit-replay-ready"));
      replayPcm = await page.evaluate(() => window.__endAudit.result());
      signal = await page.evaluate(() => window.__audioAuditProbe.capture(1000, 1, 0, true));
      await page.getByTitle("停止", { exact: true }).click();
    } catch (reason) {
      error = String(reason);
      // Recover a completed continuous capture even if the control wait failed.
      if (activeCapture === "end" && !endPcm) endPcm = await page.evaluate(() => window.__endAudit.result()).catch(() => null);
      if (activeCapture === "replay" && !replayPcm) replayPcm = await page.evaluate(() => window.__endAudit.result()).catch(() => null);
    } finally {
      const evidence = await page.evaluate(() => window.__endAudit.finish()).catch(() => null);
      await writeFile(path.join(output, `${runId}.json`), JSON.stringify({ protocol: "mimicopy-end-replay-diagnostic-v1",
        runId, repeat, engine: "webkit", userAgent: await page.evaluate(() => navigator.userAgent),
        fixtureHash, fixturePath, container, moduleHashes,
        scope: `Fresh warmed production 8ch ${container}; native8 + final stereo PCM. Real marker/Play/Stop controls; no native-time writes. ${repetitions} fresh pages.`,
        streamOrder: ["nativeOriginalL", "nativeOriginalR", "nativeStemL", "nativeStemR", "nativeRemainderL", "nativeRemainderR", "normalCue", "downbeatCue", "finalL", "finalR"],
        endReady, replayReady, endPcm, replayPcm, signal, error, pageErrors, ...evidence }), { flag: "wx" });
      const compactSignal = signal ? { ...signal, retainedPcm: undefined, stereoEvidence: undefined } : undefined;
      summaries.push({ repeat, error, endReady, replayReady, signal: compactSignal });
      console.log(JSON.stringify({ repeat, error, pageErrors, endReady, replayReady, signalValid: signal?.valid, sourceRms: signal?.rms, mixedToneRms: signal?.mixedToneRms }));
      await page.close();
    }
  }
} finally { await browser.close(); }
await writeFile(path.join(output, "end-replay-summary.json"), JSON.stringify({ moduleHashes, fixtureHash, fixturePath, container, summaries }, null, 2), { flag: "wx" });
process.exitCode = summaries.some(({ error, signal }) => error || !signal?.valid) ? 2 : 0;
