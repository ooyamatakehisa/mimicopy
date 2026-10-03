import { installAudioAuditProbe, type AudioMeasurement } from "./audioAuditSignal";

// This separate diagnostic never calls play/currentTime directly. Every
// transport action goes through a production button in a fresh document.
installAudioAuditProbe();
const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const report = {
  protocol: "mimicopy-native-play-policy-v1",
  runId: new URLSearchParams(location.search).get("run") ?? `ios-policy-${Date.now()}`,
  userAgent: navigator.userAgent,
  startedAt: new Date().toISOString(), finishedAt: "", complete: false,
  mode: "" as "" | "pending-seek" | "settled-seek",
  beforePlay: null as ReturnType<typeof snapshot> | null,
  afterPlay: null as ReturnType<typeof snapshot> | null,
  events: [] as { event: string; elapsedMs: number; state: ReturnType<typeof snapshot> }[],
  errors: [] as string[], findings: [] as string[],
  cases: [] as { name: string; signal: AudioMeasurement }[]
};

function media() {
  const audio = document.querySelector<HTMLAudioElement>('audio[aria-label="Original audio"]');
  if (!audio) throw new Error("Production media element is missing.");
  return audio;
}

function snapshot() {
  const audio = media();
  return {
    time: audio.currentTime, readyState: audio.readyState, paused: audio.paused,
    seeking: audio.seeking, error: audio.error?.code ?? null,
    preparing: Boolean(document.querySelector('[aria-label="Playback preparation"]')),
    context: window.__audioAuditProbe.status().contextState
  };
}

function productionButton(title: string) {
  const button = document.querySelector<HTMLButtonElement>(`button[title="${title}"]`);
  if (!button || button.disabled) throw new Error(`Production button unavailable: ${title}`);
  return button;
}

function seek() {
  const row = document.querySelector('input[value="Audit seek target"]')?.closest("li");
  const button = row?.querySelector<HTMLButtonElement>('button[title="マーカーへ移動"]') ??
    document.querySelector<HTMLButtonElement>('button[title="マーカーへ移動"]');
  if (!button) throw new Error("Production marker seek button is missing.");
  button.click();
}

const panel = document.createElement("aside");
panel.style.cssText = "position:fixed;left:8px;right:8px;top:8px;z-index:99999;background:#102633;color:white;padding:10px;border:1px solid #4bdabb;border-radius:10px;font:13px system-ui";
const pending = document.createElement("button");
pending.textContent = "Seek then immediately Play";
const settled = document.createElement("button");
settled.textContent = "Seek and wait";
const play = document.createElement("button");
play.textContent = "Play and measure";
const status = document.createElement("div");
status.textContent = "Preparing fresh-document policy diagnostic…";
for (const button of [pending, settled, play]) {
  button.disabled = true;
  button.style.cssText = "background:#d6ffec;color:#102633;padding:10px;border-radius:6px;font-weight:700;margin:4px";
}
panel.append(pending, settled, play, status);
document.body.append(panel);

async function persist() {
  const response = await fetch("/__audio-audit/report", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(report)
  });
  if (!response.ok) throw new Error("Unable to save policy evidence.");
}

function disableActions() {
  pending.disabled = true; settled.disabled = true; play.disabled = true;
}

async function finishMeasurement() {
  try {
    const deadline = performance.now() + 5000;
    const ready = () => !media().paused && !media().seeking && !snapshot().preparing &&
      window.__audioAuditProbe.status().contextState === "running";
    while (!ready() && performance.now() < deadline) await delay(20);
    report.afterPlay = snapshot();
    if (!ready()) report.findings.push("first-play-did-not-settle-within-five-seconds");
    if (window.__audioAuditProbe.status().contextState === "running") {
      const signal = await window.__audioAuditProbe.capture(2000, 1, 0, true);
      report.cases.push({ name: report.mode, signal });
      if (!signal.valid) report.findings.push("invalid-audio-capture");
      for (const channel of ["original", "stem", "remainder"] as const) {
        if (signal.rms[channel] < 0.0005 || signal.mixedToneRms[channel] < 0.0005) report.findings.push(`${channel}-missing-output`);
      }
      if (signal.pairs.some((pair) => pair.confidence !== "high" || pair.lagMs === null || Math.abs(pair.lagMs) > 20)) report.findings.push("source-alignment-not-established");
    } else report.findings.push("audio-context-not-running");
    if (!report.beforePlay || report.beforePlay.time > 10.01 || report.afterPlay.time < 9.99) report.findings.push("requested-seek-position-not-established");
  } catch (error) {
    report.errors.push(String(error));
  } finally {
    document.querySelector<HTMLButtonElement>('button[title="停止"]')?.click();
    report.complete = true; report.finishedAt = new Date().toISOString();
    status.textContent = `Complete: ${report.findings.length} findings, ${report.errors.length} errors. Use a fresh URL for the other mode.`;
    await persist();
  }
}

function firstPlay() {
  disableActions();
  if (report.events.some((event) => event.event === "play")) report.findings.push("document-already-played-before-test");
  report.beforePlay = snapshot();
  if (report.mode === "pending-seek" && report.beforePlay.readyState >= 2 && !report.beforePlay.seeking && !report.beforePlay.preparing) report.findings.push("pending-restoration-not-observed");
  // Called synchronously within the trusted UI gesture, including pending mode.
  productionButton("再生").click();
  status.textContent = "Measuring first Play…";
  void finishMeasurement();
}

pending.onclick = () => {
  report.mode = "pending-seek";
  seek();
  firstPlay();
};
settled.onclick = () => {
  disableActions(); report.mode = "settled-seek"; seek();
  void (async () => {
    const deadline = performance.now() + 15000;
    await delay(0);
    while ((media().readyState < 2 || media().seeking || snapshot().preparing) && performance.now() < deadline) await delay(20);
    if (media().readyState < 2 || media().seeking || snapshot().preparing) {
      report.findings.push("seek-restoration-timeout");
      report.complete = true;
      status.textContent = "Seek did not settle. Evidence saved.";
      await persist();
    } else {
      status.textContent = "Seek ready. Tap Play and measure for the first trusted Play.";
      play.disabled = false;
    }
  })();
};
play.onclick = firstPlay;
window.addEventListener("error", (event) => report.errors.push(event.message));
window.addEventListener("unhandledrejection", (event) => report.errors.push(String(event.reason)));

async function prepare() {
  const deadline = performance.now() + 30_000;
  const ready = () => document.querySelector('button[title="再生"]:not(:disabled)') &&
    document.querySelector('button[title="ギターをソロ"]:not(:disabled)') &&
    document.querySelector('button[title="マーカーへ移動"]');
  while (!ready() && performance.now() < deadline) await delay(100);
  if (!ready()) throw new Error("Production mixer and playback controls did not become ready.");
  await window.__audioAuditProbe.ready();
  for (const event of ["play", "playing", "pause", "seeking", "seeked", "loadedmetadata", "waiting", "error"]) {
    media().addEventListener(event, () => report.events.push({ event, elapsedMs: performance.now(), state: snapshot() }));
  }
  pending.disabled = false; settled.disabled = false;
  status.textContent = "Ready. Choose one mode; this document has never played audio.";
}
void prepare().catch((error: unknown) => { status.textContent = String(error); report.errors.push(String(error)); void persist(); });
