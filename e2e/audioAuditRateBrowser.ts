import { installAudioAuditProbe, type AudioMeasurement } from "./audioAuditSignal";

// Separate diagnostic entry point. Only real production controls change media.
installAudioAuditProbe();
const rates = [1, 0.75, 0.5, 0.25] as const;
type Rate = typeof rates[number];
type BaseReport = Window["__audioAuditReport"];
type BaseCase = BaseReport["cases"][number];
const labels = ["原音", "ギター", "ギター以外"] as const;
const ids = ["original", "stem", "remainder"] as const;
const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const params = new URLSearchParams(location.search);

function button(title: string): HTMLButtonElement {
  const element = document.querySelector<HTMLButtonElement>(`button[title="${title}"]`);
  if (!element || element.disabled) throw new Error(`Production button unavailable: ${title}`);
  return element;
}
function media(): HTMLAudioElement {
  const element = document.querySelector<HTMLAudioElement>('audio[aria-label="Original audio"]');
  if (!element) throw new Error("Shared native transport is missing");
  return element;
}
function requestedPlaying() { return Boolean(document.querySelector('button[title="停止"]')); }
function preparing() { return Boolean(document.querySelector('[aria-label="Playback preparation"]')); }
function readRate(): Rate {
  const value = Number(document.querySelector('[aria-label="Playback speed"] strong')?.textContent?.replace("x", ""));
  if (!rates.some((rate) => rate === value)) throw new Error("Playback speed UI is missing or invalid");
  return value as Rate;
}
function readMask() {
  let mask = 0;
  for (const [index, label] of labels.entries()) {
    const mute = document.querySelector<HTMLButtonElement>(`button[title="${label}をミュート"]`);
    const solo = document.querySelector<HTMLButtonElement>(`button[title="${label}をソロ"]`);
    if (!mute || !solo) return -1;
    if (mute.getAttribute("aria-pressed") === "true") mask |= 1 << (index * 2);
    if (solo.getAttribute("aria-pressed") === "true") mask |= 1 << (index * 2 + 1);
  }
  return mask;
}
function mediaSnapshot(): BaseCase["before"] {
  const audio = media();
  return [{ label: audio.getAttribute("aria-label"), time: audio.currentTime, paused: audio.paused,
    seeking: audio.seeking, ready: audio.readyState, rate: audio.playbackRate, volume: audio.volume,
    ended: audio.ended, error: audio.error?.code ?? null }];
}
function renderedCursor() {
  const waveform = document.querySelector<HTMLElement>('[aria-label="再生位置"]');
  const integer = Number(waveform?.getAttribute("aria-valuenow"));
  const first = waveform?.querySelector<HTMLElement>('button[title^="Audit seek target "]');
  const second = waveform?.querySelector<HTMLElement>('button[title^="Audit seek offset target "]');
  const playhead = waveform?.querySelector<HTMLElement>('div[style*="--playhead-left"]');
  const positions = [first?.style.getPropertyValue("--marker-left"),
    second?.style.getPropertyValue("--marker-left"), playhead?.style.getPropertyValue("--playhead-left")]
    .map((value) => value ? Number.parseFloat(value) : Number.NaN);
  const a = positions[0] ?? Number.NaN;
  const b = positions[1] ?? Number.NaN;
  const p = positions[2] ?? Number.NaN;
  const valid = positions.every(Number.isFinite) && b > a && a > 0 && b < 100 && p > 0 && p < 100;
  return { integer: waveform && Number.isFinite(integer) ? integer : null,
    precise: valid ? 10 + (p - a) / (b - a) * 0.1 : null,
    markerAndPlayheadPercent: positions.map((value) => Number.isFinite(value) ? value : null),
    precisionNote: valid ? "Rendered CSS percentages, calibrated by fixture markers at 10 and 10.1 seconds"
      : "Unresolved: accessible cursor is integer-only and precise rendered anchors are unavailable" };
}
function snapshot() {
  const audio = media();
  return { wallTimeMs: performance.now(), media: mediaSnapshot()[0], uiRate: readRate(),
    requestedPlaying: requestedPlaying(), preparing: preparing(), preservesPitch: audio.preservesPitch,
    context: window.__audioAuditProbe.status().contextState, cursor: renderedCursor() };
}
function initialDiagnosticSnapshot(stage: string) {
  const audio = document.querySelector<HTMLAudioElement>('audio[aria-label="Original audio"]');
  const controls = ["再生", ...labels.flatMap((label) => [`${label}をミュート`, `${label}をソロ`])]
    .map((title) => {
      const element = document.querySelector<HTMLButtonElement>(`button[title="${title}"]`);
      return { title, present: Boolean(element), disabled: element?.disabled ?? null };
    });
  let probeStatus: ReturnType<typeof window.__audioAuditProbe.status> | null = null;
  let probeError: string | null = null;
  try { probeStatus = window.__audioAuditProbe.status(); }
  catch (error) { probeError = String(error); }
  return { stage, wallTimeMs: performance.now(), audioCount: document.querySelectorAll("audio").length,
    media: audio ? { ready: audio.readyState, networkState: audio.networkState, seeking: audio.seeking,
      paused: audio.paused, time: audio.currentTime, rate: audio.playbackRate,
      error: audio.error?.code ?? null } : null,
    preparing: preparing(), controls, probeStatus, probeError,
    displayedRate: document.querySelector('[aria-label="Playback speed"] strong')?.textContent ?? null };
}
type Observation = ReturnType<typeof snapshot>;
type Scenario = {
  name: string; targetRate: Rate; expectedPlaying: boolean;
  preparationObserved: boolean; stopDuringPreparationObserved: boolean;
  before: Observation; after: Observation | null;
  actions: { name: string; before: Observation; after: Observation }[];
  timeline: Observation[];
};
type PcmLevels = {
  frames: number;
  final: { left: number; right: number };
  postGain: Record<typeof ids[number], { left: number; right: number }>;
};
type RateCase = BaseCase & {
  stage: "boundary" | "settled" | "paused";
  scenario: string;
  pcmLevels: PcmLevels | null;
};

const report = {
  protocol: "mimicopy-audio-rate-diagnostic-v1",
  runId: params.get("run") ?? `rate-${Date.now()}`,
  startedAt: new Date().toISOString(), finishedAt: "", complete: false, suiteFinished: false, passed: false,
  userAgent: navigator.userAgent, url: location.href, phase: "Preparing",
  thresholds: { audibleRms: 0.0005, silenceRms: 0.00015, clockSpreadMs: 20, signalLagMs: 20 },
  method: "Separate 24-capture diagnostic: six adjacent playing speed transitions, two latest-intent bursts, and Stop during preparation at four target rates. All transport/rate changes use production buttons. Continuous boundary PCM retains intentional preparation silence without demanding gap-free output across reset. Settled signal and paused silence are explicitly checked. The accessible cursor is integer-only; optional numeric CSS marker/playhead positions preserve rendered subsecond evidence. Nonunity PCM is not claimed to exact-match the fixture timeline.",
  coverage: { expectedScenarios: 12, expectedCases: 24, adjacentTransitions: 6, rapidBursts: 2, stopDuringPreparation: 4 },
  cases: [] as RateCase[], scenarios: [] as Scenario[],
  events: [] as (BaseReport["events"][number] & { state: Observation })[],
  seekPreparation: [] as BaseReport["seekPreparation"],
  initialDiagnostics: [] as ReturnType<typeof initialDiagnosticSnapshot>[],
  errors: [] as string[], findings: [] as string[], inconclusive: [] as string[]
};
window.__audioAuditReport = report;

async function waitReady(name: string, expectedPlaying: boolean, expectedRate: Rate) {
  const started = performance.now();
  await delay(0);
  const ready = () => media().readyState >= 2 && !media().seeking && !preparing() &&
    media().paused === !expectedPlaying && requestedPlaying() === expectedPlaying &&
    readRate() === expectedRate && media().playbackRate === expectedRate &&
    media().defaultPlaybackRate === expectedRate && (!expectedPlaying || window.__audioAuditProbe.status().contextState === "running");
  while (!ready() && performance.now() - started < 15_000) await delay(20);
  const completed = ready();
  report.seekPreparation.push({ name, durationMs: performance.now() - started, completed, expectedPlaying, after: mediaSnapshot() });
  if (!completed) throw new Error(`Preparation timed out: ${name}`);
}
async function playing(value: boolean) {
  if (requestedPlaying() !== value) button(value ? "再生" : "停止").click();
  await waitReady(value ? "Play" : "Pause", value, readRate());
}
async function clickRate(target: Rate, scenario?: Scenario) {
  const before = snapshot();
  if (readRate() === target) throw new Error(`Diagnostic requires an actual rate change to ${target}`);
  button(target > readRate() ? "速度を上げる" : "速度を下げる").click();
  await delay(0);
  if (readRate() !== target) throw new Error(`Expected one adjacent speed step to ${target}, saw ${readRate()}`);
  const after = snapshot();
  if (scenario) {
    scenario.preparationObserved ||= after.preparing;
    scenario.actions.push({ name: `rate ${before.uiRate} -> ${target}`, before, after });
  }
}
async function setRatePaused(target: Rate) {
  if (requestedPlaying()) throw new Error("Paused setup unexpectedly requested playback");
  while (readRate() !== target) {
    const current = rates.indexOf(readRate());
    const next = rates[current + (target < readRate() ? 1 : -1)];
    if (next === undefined) throw new Error("Invalid adjacent speed setup");
    await clickRate(next);
  }
  await waitReady(`Paused setup ${target}x`, false, target);
}
async function seekMarker() {
  button("マーカーへ移動").click();
  await waitReady("Marker setup", requestedPlaying(), readRate());
}

function independentPcmLevels(signal: AudioMeasurement): PcmLevels | null {
  const raw = signal.retainedPcm;
  if (!raw || raw.frames <= 0 || raw.frames !== signal.frames || raw.sampleRate !== signal.sampleRate ||
    raw.encoding !== "float32-le-base64") return null;
  try {
    const rms = (encoded: string) => {
      const binary = atob(encoded);
      if (binary.length !== raw.frames * 4) throw new Error("Invalid PCM frame count");
      const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
      const view = new DataView(bytes.buffer);
      let squares = 0;
      for (let frame = 0; frame < raw.frames; frame++) {
        const value = view.getFloat32(frame * 4, true);
        if (!Number.isFinite(value)) throw new Error("Nonfinite PCM sample");
        squares += value * value;
      }
      return Math.sqrt(squares / raw.frames);
    };
    const source = (id: typeof ids[number]) => ({ left: rms(raw.postGain[id].left), right: rms(raw.postGain[id].right) });
    return { frames: raw.frames, final: { left: rms(raw.finalLeft), right: rms(raw.finalRight) },
      postGain: { original: source("original"), stem: source("stem"), remainder: source("remainder") } };
  } catch { return null; }
}

function signalIssues(signal: AudioMeasurement, stage: RateCase["stage"], name: string, levels: PcmLevels | null) {
  const issues: string[] = [];
  if (!signal.valid) issues.push("invalid-audio-measurement");
  if (!levels) report.inconclusive.push(`${name}/independent-stereo-pcm-levels-unavailable`);
  if (stage === "boundary") return issues; // Changing rate/reset is intentionally not stationary.
  if (stage === "paused") {
    if (levels) for (const side of ["left", "right"] as const) {
      if (levels.final[side] > report.thresholds.silenceRms) issues.push(`paused-final-${side}-output-not-silent`);
    }
    return issues;
  }
  for (const id of ids) {
    if (!Number.isFinite(signal.rms[id]) || !Number.isFinite(signal.mixedToneRms[id]) || signal.rms[id] < 0 || signal.mixedToneRms[id] < 0) {
      report.inconclusive.push(`${name}/${id}-invalid-rms`);
    } else if (signal.rms[id] < report.thresholds.audibleRms || signal.mixedToneRms[id] < report.thresholds.audibleRms) {
      issues.push(`${id}-missing-steady-output`);
    }
    for (const side of ["left", "right"] as const) {
      if (levels && levels.postGain[id][side] < report.thresholds.audibleRms) issues.push(`${id}-${side}-missing-post-gain-source`);
      const level = signal.stereo?.[side][id];
      if (level === undefined || !Number.isFinite(level) || level < 0) report.inconclusive.push(`${name}/${id}-${side}-invalid-final-carrier-rms`);
      else if (level < report.thresholds.audibleRms) issues.push(`${id}-${side}-missing-final-carrier`);
    }
  }
  for (let first = 0; first < ids.length; first++) for (let second = first + 1; second < ids.length; second++) {
    const pair = signal.pairs.find((candidate) => candidate.first === ids[first] && candidate.second === ids[second]);
    const label = `${ids[first]}-${ids[second]}`;
    if (!pair || pair.confidence !== "high" || pair.lagMs === null || !Number.isFinite(pair.lagMs)) {
      report.inconclusive.push(`${name}/${label}-lag-inconclusive`);
    } else if (Math.abs(pair.lagMs) > report.thresholds.signalLagMs) issues.push(`${label}-lag-over-20ms`);
  }
  if (signal.stereoEvidence) {
    for (const direction of ["rightCarriersInLeft", "leftCarriersInRight"] as const) {
      for (const id of ids) {
        const evidence = signal.stereoEvidence[direction][id];
        const rawBand = signal.stereo?.[direction][id];
        if (rawBand === undefined || !Number.isFinite(rawBand) || rawBand < 0) report.inconclusive.push(`${name}/${direction}/${id}-invalid-cross-band-rms`);
        if (evidence.classification === "carrier-like") issues.push(`${direction}/${id}-corroborated-crosstalk`);
        else if (evidence.classification !== "below-threshold" || evidence.rawCandidate || evidence.windowCandidate ||
          (rawBand !== undefined && rawBand > report.thresholds.silenceRms)) report.inconclusive.push(`${name}/${direction}/${id}-spectral-candidate`);
      }
    }
  } else report.inconclusive.push(`${name}/stereo-discriminator-unavailable`);
  return issues;
}
function addCase(scenario: Scenario, stage: RateCase["stage"], before: BaseCase["before"], signal: AudioMeasurement) {
  const name = `${scenario.name}/${stage}`;
  const unresolvedBefore = report.inconclusive.length;
  const pcmLevels = independentPcmLevels(signal);
  const issues = signalIssues(signal, stage, name, pcmLevels);
  if (media().error) issues.push("native-media-error");
  if (media().preservesPitch) issues.push("unexpected-native-pitch-preservation");
  if (readMask() !== 0) issues.push("unexpected-mute-solo-state");
  if (stage !== "boundary" && (requestedPlaying() !== scenario.expectedPlaying || media().paused === scenario.expectedPlaying ||
    preparing() || media().playbackRate !== scenario.targetRate || readRate() !== scenario.targetRate)) issues.push("latest-transport-intent-mismatch");
  const archivedSignal = { ...signal };
  // Retain boundary/paused evidence and every suspicious steady recording.
  // Clean steady captures retain independent side RMS without duplicating PCM.
  if (stage === "settled" && issues.length === 0 && report.inconclusive.length === unresolvedBefore) delete archivedSignal.retainedPcm;
  const entry: RateCase = { category: `rate-${stage}`, stage, scenario: scenario.name, name, mask: 0,
    rate: scenario.targetRate, expectedAudible: ids.map(() => stage !== "paused"), uiMask: readMask(),
    before, after: mediaSnapshot(), maxClockSpreadMs: 0, signal: archivedSignal, pcmLevels, issues };
  report.cases.push(entry);
  report.findings.push(...issues.map((issue) => `${name}/${issue}`));
}
async function measureScenario(name: string, targetRate: Rate, expectedPlaying: boolean,
  actions: (scenario: Scenario) => Promise<void>) {
  report.phase = name;
  status.textContent = `${name} · ${report.cases.length}/24 captures`;
  const scenario: Scenario = { name, targetRate, expectedPlaying, preparationObserved: false,
    stopDuringPreparationObserved: false, before: snapshot(), after: null, actions: [], timeline: [] };
  report.scenarios.push(scenario);
  const before = mediaSnapshot();
  const recording = window.__audioAuditProbe.capture(1800, targetRate, 0, true);
  void recording.catch(() => undefined);
  const sample = () => {
    const state = snapshot(); scenario.timeline.push(state); scenario.preparationObserved ||= state.preparing;
  };
  const timer = setInterval(sample, 20);
  sample();
  let actionError: unknown;
  try {
    try {
      await delay(200);
      await actions(scenario);
      await waitReady(name, expectedPlaying, targetRate);
    } catch (error) { actionError = error; }
    const boundary = await recording;
    addCase(scenario, "boundary", before, boundary);
  } finally { clearInterval(timer); }
  if (actionError !== undefined) throw actionError;
  // Fixed settling margin follows explicit readiness; it is not a PCM-dependent wait.
  await delay(300);
  const stage = expectedPlaying ? "settled" : "paused";
  const settledBefore = mediaSnapshot();
  const signal = await window.__audioAuditProbe.capture(expectedPlaying ? (targetRate === 0.25 ? 2400 : 1800) : 600, targetRate, 0, true);
  addCase(scenario, stage, settledBefore, signal);
  scenario.after = snapshot();
}

const panel = document.createElement("aside");
panel.id = "audio-audit-panel";
panel.style.cssText = "position:fixed;left:8px;right:8px;top:8px;z-index:99999;background:#102633;color:white;padding:12px;font:13px system-ui";
const start = document.createElement("button");
start.textContent = "Start audio audit";
start.disabled = true;
start.style.cssText = "background:#d6ffec;color:#102633;padding:12px;border-radius:6px;margin-right:10px";
const status = document.createElement("span");
status.textContent = "Preparing separate rate-transition diagnostic…";
panel.append(start, status); document.body.append(panel);

async function persist() {
  const response = await fetch("/__audio-audit/report", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(report) });
  if (!response.ok) throw new Error("Unable to persist rate diagnostic");
}
async function finishReport() {
  report.finishedAt = new Date().toISOString();
  report.suiteFinished = report.scenarios.length === report.coverage.expectedScenarios &&
    report.cases.length === report.coverage.expectedCases;
  // Completion is termination, not acceptance. Drivers must stop waiting even
  // when the run stopped early or a completed suite found an audio failure.
  report.complete = true;
  report.passed = report.suiteFinished && report.errors.length === 0 && report.findings.length === 0 && report.inconclusive.length === 0;
  report.phase = report.suiteFinished ? "Finished" : "Stopped early";
  status.textContent = `${report.phase}: ${report.cases.length}/24 captures, ${report.findings.length} findings, ${report.inconclusive.length} unresolved, ${report.errors.length} errors`;
  try { await persist(); }
  catch (error) {
    // Keep the terminal report and persistence error available to the desktop
    // driver through window.__audioAuditReport, even if the server is gone.
    report.errors.push(`Report persistence failed: ${String(error)}`);
    report.passed = false;
    status.textContent = `${report.phase}; report persistence failed: ${String(error)}`;
  }
}
async function run() {
  try {
    await waitReady("Trusted initial Play", true, 1);
    for (const label of labels) for (const action of ["ミュート", "ソロ"]) {
      const control = button(`${label}を${action}`);
      if (control.getAttribute("aria-pressed") === "true") control.click();
    }
    await seekMarker(); await delay(400);
    for (const target of [0.75, 0.5, 0.25, 0.5, 0.75, 1] as const) {
      await measureScenario(`playing ${readRate()} -> ${target}`, target, true, async (scenario) => { await clickRate(target, scenario); });
    }
    for (const burst of [[0.75, 0.5, 0.25, 0.5, 0.75, 1], [0.75, 0.5, 0.25, 0.5, 0.25]] as const) {
      const target = burst[burst.length - 1];
      if (target === undefined) throw new Error("Empty speed burst");
      await measureScenario(`latest intent ${burst.join(" -> ")}`, target, true, async (scenario) => {
        for (const rate of burst) { await clickRate(rate, scenario); await delay(15); }
      });
    }
    for (const target of rates) {
      await playing(false);
      const initialRate = target === 0.25 ? 0.5 : rates[rates.indexOf(target) + 1];
      if (initialRate === undefined) throw new Error("Missing Stop scenario starting rate");
      await setRatePaused(initialRate);
      await seekMarker(); await playing(true); await delay(350);
      await measureScenario(`Stop during ${target}x preparation`, target, false, async (scenario) => {
        await clickRate(target, scenario);
        const before = snapshot();
        scenario.stopDuringPreparationObserved = before.preparing;
        if (!before.preparing) report.inconclusive.push(`${scenario.name}/preparation-was-not-observed-before-Stop`);
        if (!requestedPlaying()) throw new Error("Playing intent disappeared before explicit Stop");
        button("停止").click(); await delay(0);
        scenario.actions.push({ name: "Stop", before, after: snapshot() });
      });
    }
    if (report.scenarios.length !== 12 || report.cases.length !== 24) throw new Error("Rate diagnostic coverage is incomplete");
  } catch (error) { report.errors.push(String(error)); }
  finally {
    await playing(false).catch((error: unknown) => report.errors.push(String(error)));
    await finishReport();
  }
}
start.onclick = () => {
  start.disabled = true;
  try {
    if (!initialControlsReady()) throw new Error("Production controls became unavailable before trusted Start");
    button("再生").click();
    void run().catch((error: unknown) => { report.errors.push(String(error)); void finishReport(); });
  } catch (error) {
    report.initialDiagnostics.push(initialDiagnosticSnapshot("trusted-start-failed"));
    report.errors.push(String(error)); void finishReport();
  }
};
window.addEventListener("error", (event) => report.errors.push(event.message));
window.addEventListener("unhandledrejection", (event) => report.errors.push(String(event.reason)));
function initialControlsReady() {
  return document.querySelectorAll("audio").length === 1 &&
    Boolean(document.querySelector('audio[aria-label="Original audio"]')) && !preparing() &&
    Boolean(document.querySelector('button[title="再生"]:not(:disabled)')) &&
    labels.every((label) => ["ミュート", "ソロ"].every((action) =>
      Boolean(document.querySelector(`button[title="${label}を${action}"]:not(:disabled)`))));
}
async function prepare() {
  const deadline = performance.now() + 30_000;
  while (!initialControlsReady() && performance.now() < deadline) await delay(100);
  if (!initialControlsReady()) throw new Error("Production audio controls did not become ready within 30 seconds");
  await window.__audioAuditProbe.ready();
  if (!initialControlsReady()) throw new Error("Production audio controls changed while probe initialized");
  // Native iOS may defer preload until the trusted Play gesture. The prepared
  // graph and enabled controls suffice here; waitReady checks media after Play.
  if (readRate() !== 1) throw new Error("Initial playback rate is not 1x");
  report.initialDiagnostics.push(initialDiagnosticSnapshot("ready-before-trusted-start"));
  for (const event of ["play", "playing", "pause", "seeking", "seeked", "ratechange", "waiting", "stalled", "ended", "error"]) {
    media().addEventListener(event, () => report.events.push({ time: performance.now(), event,
      label: "Original audio", mediaTime: media().currentTime, state: snapshot() }));
  }
  start.disabled = false; status.textContent = "Ready · separate 24-capture playing-rate diagnostic";
}
void prepare().catch((error: unknown) => {
  report.initialDiagnostics.push(initialDiagnosticSnapshot("initial-preparation-failed"));
  report.errors.push(String(error)); void finishReport();
});
