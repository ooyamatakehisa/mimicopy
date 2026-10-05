import { installAudioAuditProbe, type AudioMeasurement } from "./audioAuditSignal";

// Test-only entry point injected by audioAuditServer, before the real app starts.
// All state changes below go through the production buttons and React handlers.
installAudioAuditProbe();

const labels = ["原音", "ギター", "ギター以外"] as const;
const ids = ["original", "stem", "remainder"] as const;
const rates = [1, 0.75, 0.5, 0.25] as const;
const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const params = new URLSearchParams(location.search);
const runId = params.get("run") ?? `ios-${Date.now()}`;
const quick = params.get("quick") === "1";

type MediaSnapshot = {
  label: string | null; time: number; paused: boolean; seeking: boolean;
  ready: number; volume: number; rate: number; ended: boolean; error: number | null;
};
type AuditCase = {
  category: string; name: string; mask: number; rate: number;
  expectedAudible: boolean[]; uiMask: number;
  before: MediaSnapshot[]; after: MediaSnapshot[];
  maxClockSpreadMs: number; signal: AudioMeasurement;
  issues: string[];
};
type ClockPreparation = {
  durationMs: number; startTime: number; endTime: number; rate: number;
  requiredAdvanceSeconds: number; actualAdvanceSeconds: number; completed: boolean;
};
const report = {
  protocol: "mimicopy-audio-audit-v2",
  runId, startedAt: new Date().toISOString(), finishedAt: "", complete: false, suiteFinished: false,
  userAgent: navigator.userAgent, url: location.href,
  thresholds: { audibleRms: 0.0005, silenceRms: 0.00015, clockSpreadMs: 20, signalLagMs: 20 },
  method: "Production app, fixture HTTP API, real HTMLMediaElement playback and Web Audio output. Audio methods, clocks and volume are never mocked. Source taps and final mix captured on one AudioContext clock. All UI state changes use real button handlers; initial playback needs one trusted user gesture. One eight-channel PCM16 WAV (RIFF/RF64) transport drives three independently measured post-gain stereo music sources, with two silent cue lanes. The recorded transportFixture identifies the actual container. Shared +100ms seek cases replace impossible per-source clock injection.",
  cases: [] as AuditCase[], events: [] as { time: number; label: string; event: string; mediaTime: number }[],
  seekPreparation: [] as { name: string; durationMs: number; completed: boolean; expectedPlaying: boolean; after: MediaSnapshot[]; clock?: ClockPreparation }[],
  errors: [] as string[], phase: "Preparing"
};

function button(title: string) {
  const element = document.querySelector<HTMLButtonElement>(`button[title="${title}"]`);
  if (!element) throw new Error(`Button missing: ${title}`);
  return element;
}
function media() { return Array.from(document.querySelectorAll<HTMLAudioElement>("audio")); }
function snapshot(): MediaSnapshot[] {
  return media().map((audio) => ({ label: audio.getAttribute("aria-label"), time: audio.currentTime,
    paused: audio.paused, seeking: audio.seeking, ready: audio.readyState,
    volume: audio.volume, rate: audio.playbackRate, ended: audio.ended, error: audio.error?.code ?? null }));
}
function readMask() {
  return labels.reduce((mask, label, channel) => mask |
    (button(`${label}をミュート`).getAttribute("aria-pressed") === "true" ? 1 << (channel * 2) : 0) |
    (button(`${label}をソロ`).getAttribute("aria-pressed") === "true" ? 1 << (channel * 2 + 1) : 0), 0);
}
function expectedAudible(mask: number) {
  const soloChannels = [0, 1, 2].filter((index) => Boolean(mask & (1 << (index * 2 + 1))));
  return [0, 1, 2].map((index) => !(mask & (1 << (index * 2))) &&
    (soloChannels.length === 0 || soloChannels.includes(index)));
}
async function setMask(mask: number) {
  const changed = readMask() ^ mask;
  for (let bit = 0; bit < 6; bit++) {
    if (changed & (1 << bit)) button(`${labels[Math.floor(bit / 2)]}を${bit % 2 ? "ソロ" : "ミュート"}`).click();
  }
  await delay(0);
}
async function setRate(rate: number) {
  const expectedPlaying = Boolean(document.querySelector('button[title="停止"]'));
  for (let index = 0; index < 3; index++) { button("速度を上げる").click(); await delay(0); }
  const steps = rates.indexOf(rate as typeof rates[number]);
  for (let index = 0; index < steps; index++) { button("速度を下げる").click(); await delay(0); }
  await waitForSeekPreparation(`Playback rate ${rate}x`, expectedPlaying, rate, 0);
  await delay(100);
}
async function playing(value: boolean) {
  const requested = Boolean(document.querySelector('button[title="停止"]'));
  if (requested !== value) {
    button(value ? "再生" : "停止").click();
  }
  await waitForSeekPreparation(value ? "Playback start" : "Playback pause", value, undefined, 0);
  await delay(80);
}
async function waitForSeekPreparation(name: string, expectedPlaying: boolean, expectedRate?: number, settleMs = 150) {
  const started = performance.now();
  // Let the real button's React update publish its preparation state first.
  await delay(0);
  const ready = () => {
    const audio = media()[0];
    return audio && audio.readyState >= 2 && !audio.seeking &&
      audio.paused === !expectedPlaying && !document.querySelector('[aria-label="Playback preparation"]') &&
      (expectedRate === undefined || (audio.playbackRate === expectedRate && audio.defaultPlaybackRate === expectedRate));
  };
  while (!ready() && performance.now() - started < 15_000) await delay(20);
  let completed = Boolean(ready());
  let clock: ClockPreparation | undefined;
  if (completed && expectedPlaying) {
    const audio = media()[0];
    const clockStarted = performance.now();
    const startTime = audio.currentTime;
    const rate = audio.playbackRate;
    const requiredAdvanceSeconds = 0.15 * rate;
    const advanced = () => Boolean(ready()) && media()[0] === audio &&
      audio.playbackRate === rate && audio.currentTime - startTime >= requiredAdvanceSeconds;
    while (!advanced() && performance.now() - clockStarted < 15_000) await delay(20);
    completed = advanced();
    clock = { durationMs: performance.now() - clockStarted, startTime, endTime: audio.currentTime,
      rate, requiredAdvanceSeconds, actualAdvanceSeconds: audio.currentTime - startTime, completed };
  }
  // The historical array also records preparation for pause/play and rate changes.
  // A playing event can precede native PCM delivery. Require 150 ms of real
  // media-clock advancement before steady captures, without inspecting PCM.
  report.seekPreparation.push({ name, durationMs: performance.now() - started, completed, expectedPlaying, after: snapshot(), clock });
  if (!completed) throw new Error(`Seek preparation did not complete: ${name}`);
  // This is a steady-state capture, not a fixed seek-latency assertion. The
  // boundary diagnostic records the silence/latency without waiting for PCM.
  if (settleMs > 0) await delay(settleMs);
}
async function seekMarker() {
  const expectedPlaying = Boolean(document.querySelector('button[title="停止"]'));
  button("マーカーへ移動").click();
  await waitForSeekPreparation("Audit seek target", expectedPlaying);
}
async function seekNamedMarker(label: string) {
  const input = document.querySelector<HTMLInputElement>(`input[aria-label="${label} label"]`);
  const control = input?.parentElement?.parentElement?.querySelector<HTMLButtonElement>('button[title="マーカーへ移動"]');
  if (!control) throw new Error(`Marker control missing: ${label}`);
  const expectedPlaying = Boolean(document.querySelector('button[title="停止"]'));
  control.click();
  await waitForSeekPreparation(label, expectedPlaying);
}

const panel = document.createElement("aside");
panel.id = "audio-audit-panel";
panel.style.cssText = "position:fixed;left:8px;right:8px;top:8px;z-index:99999;background:#102633;color:white;padding:10px;border:1px solid #4bdabb;border-radius:10px;font:13px system-ui;max-height:130px;overflow:auto";
const start = document.createElement("button");
start.textContent = "Start audio audit";
start.disabled = true;
start.style.cssText = "background:#d6ffec;color:#102633;padding:10px;border-radius:6px;font-weight:700;margin-right:10px";
const status = document.createElement("span");
status.textContent = "Loading three real audio sources…";
panel.append(start, status);
document.body.append(panel);

async function persist() {
  const response = await fetch("/__audio-audit/report", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(report) });
  if (!response.ok) throw new Error("Unable to save audio audit evidence");
}
function updateStatus() {
  status.textContent = `${report.phase}: ${report.cases.length} cases, ${report.cases.filter((entry) => entry.issues.length).length} flagged`;
}

async function capture(category: string, name: string, mask: number, rate: number, durationMs = 200, shouldPlay = true) {
  const before = snapshot();
  let maxClockSpreadMs = 0;
  const clockTimer = setInterval(() => {
    const times = media().map((element) => element.currentTime);
    maxClockSpreadMs = Math.max(maxClockSpreadMs, (Math.max(...times) - Math.min(...times)) * 1000);
  }, 20);
  let signal: AudioMeasurement;
  try { signal = await window.__audioAuditProbe.capture(durationMs, rate); }
  finally { clearInterval(clockTimer); }
  const entry: AuditCase = { category, name, mask, rate, expectedAudible: expectedAudible(mask).map((audible) => audible && shouldPlay),
    uiMask: readMask(), before, after: snapshot(), maxClockSpreadMs, signal, issues: [] };
  if (entry.uiMask !== mask) entry.issues.push("button-state-mismatch");
  // Signal interpretation is kept in the report renderer so probe validity,
  // clock drift and audible failures are never collapsed into one assertion.
  if (!signal.valid) entry.issues.push("invalid-audio-measurement");
  for (const [index, id] of ids.entries()) {
    const level = signal.mixedToneRms[id];
    if (entry.expectedAudible[index] && level < report.thresholds.audibleRms) entry.issues.push(`${id}-missing-output`);
    if (!entry.expectedAudible[index] && level > report.thresholds.silenceRms) entry.issues.push(`${id}-unexpected-output`);

  }
  if (entry.after.some((audio) => Math.abs(audio.rate - rate) > rate * 0.001)) entry.issues.push("shared-transport-wrong-playback-rate");
  for (const pair of signal.pairs) {
    if (pair.lagMs !== null && Math.abs(pair.lagMs) > report.thresholds.signalLagMs) entry.issues.push(`${pair.first}-${pair.second}-signal-lag-over-20ms`);
  }
  if (shouldPlay && entry.after.some((audio) => audio.paused)) entry.issues.push("unexpectedly-paused-source");
  if (!shouldPlay && entry.after.some((audio) => !audio.paused)) entry.issues.push("unexpectedly-playing-source");
  if (maxClockSpreadMs > report.thresholds.clockSpreadMs) entry.issues.push("media-clock-spread-over-20ms");
  report.cases.push(entry);
  updateStatus();
  if (report.cases.length % 16 === 0) await persist();
}

async function run() {
  try {
    await delay(1200);
    report.phase = "Signal calibration";
    await capture("calibration", "all audible", 0, 1, 2400);
    await setMask(21); await delay(250);
    await capture("calibration", "all muted", 21, 1, 600);
    await setMask(0); await delay(200);
    if (quick) { report.suiteFinished = true; return; }

    report.phase = "64 states × 4 speeds";
    for (const rate of rates) {
      await playing(false); await setRate(rate); await seekMarker(); await playing(true); await delay(450);
      for (let sequence = 0; sequence < 64; sequence++) {
        const mask = sequence ^ (sequence >> 1); // Gray order covers each state with one toggle.
        await setMask(mask); await delay(180);
        await capture("state-matrix", `state ${mask} at ${rate}x`, mask, rate);
      }
    }

    report.phase = "All 384 directed button transitions";
    await playing(false); await setRate(1); await seekMarker(); await setMask(0); await playing(true); await delay(400);
    for (let from = 0; from < 64; from++) {
      for (let bit = 0; bit < 6; bit++) {
        await setMask(from); await delay(60);
        if (readMask() !== from) throw new Error(`Transition precondition failed: wanted ${from}, got ${readMask()}`);
        const to = from ^ (1 << bit);
        await setMask(to); await delay(160);
        await capture("button-transition", `${from} -> ${to}, bit ${bit}`, to, 1, 160);
      }
      if (from % 16 === 15) await seekMarker();
    }

    report.phase = "64 states while paused, resumed, and seeking";
    for (let mask = 0; mask < 64; mask++) {
      await playing(false); await setMask(mask); await delay(120);
      await capture("paused-state", `paused ${mask}`, mask, 1, 100, false);
      await playing(true); await delay(250);
      await capture("resume-state", `resume ${mask}`, mask, 1, 180);
      await seekMarker(); await delay(180);
      await capture("seek-state", `seek ${mask}`, mask, 1, 200);
    }

    report.phase = "Waveform synchronization and stress";
    for (const rate of rates) {
      await playing(false); await setMask(0); await setRate(rate); await seekMarker(); await playing(true); await delay(400);
      await capture("signal-sync", `baseline ${rate}x`, 0, rate, 4000);
      for (let index = 0; index < 48; index++) { await setMask((index * 37) % 64); await delay(16); }
      await setMask(0); await delay(200);
      await capture("signal-sync", `after rapid 48 state assignments ${rate}x`, 0, rate, 4000);
      button("10秒進む").click(); await delay(200);
      button("5秒戻る").click(); await waitForSeekPreparation(`forward/back ${rate}x`, true);
      await delay(250);
      await capture("signal-sync", `after forward/back seek ${rate}x`, 0, rate, 4000);
      // Exercise the production seek owner with markers 100 ms apart. Direct
      // native currentTime writes bypass its decoder-queue restoration.
      await playing(false); await seekMarker();
      await seekNamedMarker("Audit seek offset target"); await playing(true);
      await delay(2000);
      await capture("shared-seek", `shared +100ms, after 2s at ${rate}x`, 0, rate, 3000);
    }

    report.phase = "Natural end and replay";
    await playing(false); await setRate(1); await setMask(0);
    await seekNamedMarker("Audit end target");
    await playing(true); await delay(1800);
    await capture("end", "natural end pauses all sources", 0, 1, 200, false);
    await playing(true); await delay(1000);
    await capture("end", "replay after natural end", 0, 1, 1600);
    report.suiteFinished = true;
  } catch (error) {
    report.errors.push(error instanceof Error ? `${error.message}\n${error.stack ?? ""}` : String(error));
  } finally {
    await playing(false).catch(() => undefined);
    report.complete = true; report.finishedAt = new Date().toISOString();
    report.phase = report.errors.length ? "Stopped with error" : "Complete";
    updateStatus(); await persist();
    start.textContent = "Audit finished";
  }
}

start.onclick = () => {
  start.disabled = true;
  // This synchronous click preserves the trusted tap's user activation on iOS.
  const play = button("再生");
  if (play.disabled) {
    report.errors.push("Production Play became unavailable before the trusted start.");
    report.complete = true;
    void persist();
    return;
  }
  play.click();
  void run();
};
window.addEventListener("error", (event) => report.errors.push(event.message));
window.addEventListener("unhandledrejection", (event) => report.errors.push(String(event.reason)));

async function prepare() {
  const deadline = performance.now() + 30_000;
  const ready = () => media().length === 1 &&
    document.querySelector('button[title="再生"]:not(:disabled)') &&
    document.querySelector('button[title="ギターをソロ"]:not(:disabled)');
  while (!ready() && performance.now() < deadline) await delay(100);
  if (!ready()) throw new Error("Production mixer and playback controls did not become ready.");
  await window.__audioAuditProbe.ready();
  for (const audio of media()) {
    for (const name of ["play", "playing", "pause", "waiting", "stalled", "seeking", "seeked", "ended", "error"]) {
      audio.addEventListener(name, () => report.events.push({ time: performance.now(), label: audio.getAttribute("aria-label") ?? "", event: name, mediaTime: audio.currentTime }));
    }
  }
  start.disabled = false; status.textContent = "Ready · runs the actual app and measures audio signals";
}
void prepare().catch((error: unknown) => { status.textContent = String(error); report.errors.push(String(error)); void persist(); });

declare global {
  interface Window { __audioAuditReport: typeof report; }
}
window.__audioAuditReport = report;
