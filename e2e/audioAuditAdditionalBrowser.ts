import { installAudioAuditProbe, type AudioMeasurement } from "./audioAuditSignal";

// Injected only by the isolated audit server, before the production app module.
installAudioAuditProbe();

const labels = ["原音", "ギター", "ギター以外"] as const;
const ids = ["original", "stem", "remainder"] as const;
const rates = [1, 0.75, 0.5, 0.25] as const;
const percentages = [0, 25, 50, 75, 100] as const;
const delay = (milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
type BaseReport = Window["__audioAuditReport"];
type MediaSnapshot = BaseReport["cases"][number]["before"][number];
type AdditionalCase = BaseReport["cases"][number] & {
  expectedVolumes: number[];
  sliderValues: number[];
  details: Record<string, string | number | boolean>;
};

const report = {
  protocol: "mimicopy-audio-audit-v2",
  runId: new URLSearchParams(location.search).get("run") ?? `additional-${Date.now()}`,
  startedAt: new Date().toISOString(), finishedAt: "", complete: false, suiteFinished: false,
  userAgent: navigator.userAgent, url: location.href,
  thresholds: { audibleRms: 0.0005, silenceRms: 0.00015, clockSpreadMs: 20, signalLagMs: 20 },
  method: "Supplementary production-app audit using real media playback and the same source/final-mix probe. All 14 mute/solo states with at least two expected audible sources receive long captures at all four playback speeds. Sliders use native input value setters plus bubbling input/change events to reach React handlers. Actual media time, playback methods, and media volume are never mocked or assigned by this harness. RMS levels are recorded without asserting linear volume ratios because the fixture envelope varies over time. Synchronization is source-envelope lag before shared pitch processing; carrier levels verify presence in the final mix. Programmatic clicks exercise handlers, not mobile touch hit targets.",
  cases: [] as AdditionalCase[],
  events: [] as BaseReport["events"], errors: [] as string[], phase: "Preparing",
  seekPreparation: [] as BaseReport["seekPreparation"],
  coverage: {
    expectedCases: 105,
    expectedLongStateCaptures: 56,
    expectedVolumeCaptures: 15,
    expectedRapidPlayPauseCaptures: 2,
    longStateMasks: [] as number[],
    rates: [...rates],
    sliderPercentages: [...percentages]
  }
};
window.__audioAuditReport = report;

function button(title: string): HTMLButtonElement {
  const candidate = document.querySelector<HTMLButtonElement>(`button[title="${title}"]`);
  if (!candidate) throw new Error(`Button missing: ${title}`);
  return candidate;
}

function transportButton(): HTMLButtonElement {
  const candidate = document.querySelector<HTMLButtonElement>('button[title="再生"], button[title="停止"]');
  if (!candidate) throw new Error("Transport button missing");
  return candidate;
}

function media(): HTMLAudioElement[] {
  const candidate = document.querySelector<HTMLAudioElement>('audio[aria-label="Original audio"]');
  if (!candidate) throw new Error("Shared audio transport missing");
  return [candidate];
}

function snapshot(): MediaSnapshot[] {
  return media().map((audio) => ({
    label: audio.getAttribute("aria-label"), time: audio.currentTime,
    paused: audio.paused, seeking: audio.seeking, ready: audio.readyState,
    volume: audio.volume, rate: audio.playbackRate, ended: audio.ended,
    error: audio.error?.code ?? null
  }));
}

function readMask(): number {
  return labels.reduce((mask, label, channel) => mask |
    (button(`${label}をミュート`).getAttribute("aria-pressed") === "true" ? 1 << (channel * 2) : 0) |
    (button(`${label}をソロ`).getAttribute("aria-pressed") === "true" ? 1 << (channel * 2 + 1) : 0), 0);
}

function audibleChannels(mask: number): boolean[] {
  const soloChannels = ids.map((_, index) => Boolean(mask & (1 << (index * 2 + 1))));
  const hasSolo = soloChannels.some(Boolean);
  return ids.map((_, index) => !(mask & (1 << (index * 2))) && (!hasSolo || soloChannels[index]));
}

const multiAudibleMasks = Array.from({ length: 64 }, (_, mask) => mask)
  .filter((mask) => audibleChannels(mask).filter(Boolean).length >= 2);
report.coverage.longStateMasks = multiAudibleMasks;

async function setMask(mask: number): Promise<void> {
  const changed = readMask() ^ mask;
  for (let bit = 0; bit < 6; bit++) {
    if (changed & (1 << bit)) {
      button(`${labels[Math.floor(bit / 2)]}を${bit % 2 ? "ソロ" : "ミュート"}`).click();
    }
  }
  await delay(0);
}

function slider(channel: number): HTMLInputElement {
  const candidate = document.querySelector<HTMLInputElement>(`input[aria-label="${labels[channel]}の音量"]`);
  if (!candidate) throw new Error(`Volume slider missing: ${labels[channel]}`);
  return candidate;
}

async function setSlider(channel: number, percentage: number): Promise<void> {
  const input = slider(channel);
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  if (!setter) throw new Error("Native input value setter unavailable");
  setter.call(input, String(percentage));
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
  await delay(30);
}

async function resetSliders(): Promise<void> {
  for (const channel of [0, 1, 2]) await setSlider(channel, 100);
}

async function setRate(rate: typeof rates[number]): Promise<void> {
  const expectedPlaying = transportButton().title === "停止";
  for (let step = 0; step < 3; step++) {
    button("速度を上げる").click(); await delay(0);
  }
  for (let step = 0; step < rates.indexOf(rate); step++) {
    button("速度を下げる").click(); await delay(0);
  }
  await waitForPreparation(`Playback rate ${rate}x`, expectedPlaying, rate);
  await delay(100);
  const speedText = document.querySelector('[aria-label="Playback speed"] strong')?.textContent?.trim();
  if (speedText !== `${rate}x`) throw new Error(`Playback speed UI mismatch: requested ${rate}x, observed ${speedText ?? "missing"}`);
}

async function playing(value: boolean): Promise<void> {
  const requested = transportButton().title === "停止";
  if (requested !== value) {
    transportButton().click();
  }
  await waitForPreparation(value ? "Playback start" : "Playback pause", value);
  await delay(100);
}

async function waitForPreparation(name: string, expectedPlaying: boolean, expectedRate?: number): Promise<void> {
  const started = performance.now();
  await delay(0);
  const ready = () => {
    const audio = media()[0];
    return audio.readyState >= 2 && !audio.seeking && audio.paused === !expectedPlaying &&
      !document.querySelector('[aria-label="Playback preparation"]') &&
      (expectedRate === undefined || (audio.playbackRate === expectedRate && audio.defaultPlaybackRate === expectedRate));
  };
  while (!ready() && performance.now() - started < 15_000) await delay(20);
  let completed = ready();
  let clock: BaseReport["seekPreparation"][number]["clock"];
  if (completed && expectedPlaying) {
    const audio = media()[0];
    const clockStarted = performance.now();
    const startTime = audio.currentTime;
    const rate = audio.playbackRate;
    const requiredAdvanceSeconds = 0.15 * rate;
    const advanced = () => ready() && media()[0] === audio &&
      audio.playbackRate === rate && audio.currentTime - startTime >= requiredAdvanceSeconds;
    while (!advanced() && performance.now() - clockStarted < 15_000) await delay(20);
    completed = advanced();
    clock = { durationMs: performance.now() - clockStarted, startTime, endTime: audio.currentTime,
      rate, requiredAdvanceSeconds, actualAdvanceSeconds: audio.currentTime - startTime, completed };
  }
  // The historical array also records preparation for pause/play and rate changes.
  // Observe native-clock advancement, not PCM, before steady captures. Boundary
  // diagnostics retain the unfiltered startup and preparation latency.
  report.seekPreparation.push({ name, durationMs: performance.now() - started,
    completed, expectedPlaying, after: snapshot(), clock });
  if (!completed) throw new Error(`Playback preparation did not complete: ${name}`);
}

async function seekMarker(): Promise<void> {
  const expectedPlaying = transportButton().title === "停止";
  button("マーカーへ移動").click();
  await waitForPreparation("Audit seek target", expectedPlaying);
  await delay(180);
}

const panel = document.createElement("aside");
panel.id = "audio-audit-panel";
panel.style.cssText = "position:fixed;left:8px;right:8px;top:8px;z-index:99999;background:#102633;color:white;padding:10px;border:1px solid #4bdabb;border-radius:10px;font:13px system-ui;max-height:130px;overflow:auto";
const start = document.createElement("button");
start.textContent = "Start audio audit";
start.disabled = true;
start.style.cssText = "background:#d6ffec;color:#102633;padding:10px;border-radius:6px;font-weight:700;margin-right:10px";
const status = document.createElement("span");
status.textContent = "Loading supplementary audio audit…";
const measure = document.createElement("button");
measure.textContent = "Measure current mix";
measure.disabled = true;
measure.style.cssText = start.style.cssText;
const pause = document.createElement("button");
pause.textContent = "Pause audio";
pause.disabled = true;
pause.style.cssText = start.style.cssText;
const currentMix = document.createElement("div");
currentMix.textContent = "Current mute/solo mask: loading";
panel.append(start, measure, pause, status, currentMix);
document.body.append(panel);

async function persist(): Promise<void> {
  const response = await fetch("/__audio-audit/report", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(report)
  });
  if (!response.ok) throw new Error("Unable to save supplementary audio audit evidence");
}

function updateStatus(): void {
  status.textContent = `${report.phase}: ${report.cases.length}/${report.coverage.expectedCases} cases, ${report.cases.filter((entry) => entry.issues.length).length} flagged`;
}

async function capture({ category, name, mask, rate, durationMs, volumes = [1, 1, 1], details = {} }: {
  category: string;
  name: string;
  mask: number;
  rate: number;
  durationMs: number;
  volumes?: number[];
  details?: Record<string, string | number | boolean>;
}): Promise<void> {
  const before = snapshot();
  let maxClockSpreadMs = 0;
  const observeClocks = () => {
    const times = media().map((audio) => audio.currentTime);
    maxClockSpreadMs = Math.max(maxClockSpreadMs, (Math.max(...times) - Math.min(...times)) * 1000);
  };
  observeClocks();
  const timer = setInterval(observeClocks, 20);
  let signal: AudioMeasurement;
  try {
    signal = await window.__audioAuditProbe.capture(durationMs, rate, Number(details.semitones ?? 0));
  } finally {
    clearInterval(timer);
  }
  observeClocks();
  const expectedVolumes = audibleChannels(mask).map((audible, index) => audible ? volumes[index] : 0);
  const entry: AdditionalCase = {
    category, name, mask, rate, expectedVolumes,
    expectedAudible: expectedVolumes.map((volume) => volume > 0),
    uiMask: readMask(), before, after: snapshot(), maxClockSpreadMs, signal,
    sliderValues: ids.map((_, index) => Number(slider(index).value)), details, issues: []
  };
  if (entry.uiMask !== mask) entry.issues.push("button-state-mismatch");
  if (!signal.valid) entry.issues.push("invalid-audio-measurement");
  for (const [index, id] of ids.entries()) {
    const level = signal.mixedToneRms[id];
    if (entry.expectedAudible[index] && level < report.thresholds.audibleRms) entry.issues.push(`${id}-missing-output`);
    if (!entry.expectedAudible[index] && level > report.thresholds.silenceRms) entry.issues.push(`${id}-unexpected-output`);
    if (entry.sliderValues[index] !== Math.round(volumes[index] * 100)) entry.issues.push(`${id}-slider-value-mismatch`);
  }
  for (const pair of signal.pairs) {
    const expectedPair = entry.expectedAudible[ids.indexOf(pair.first)] && entry.expectedAudible[ids.indexOf(pair.second)];
    if (expectedPair && (pair.confidence !== "high" || pair.lagMs === null)) {
      entry.issues.push(`${pair.first}-${pair.second}-signal-lag-inconclusive`);
    }
    if (pair.lagMs !== null && Math.abs(pair.lagMs) > report.thresholds.signalLagMs) {
      entry.issues.push(`${pair.first}-${pair.second}-signal-lag-over-20ms`);
    }
  }
  if (entry.after.some((audio) => audio.error !== null)) entry.issues.push("shared-transport-media-error");
  if (entry.after.some((audio) => audio.ready < HTMLMediaElement.HAVE_CURRENT_DATA)) entry.issues.push("shared-transport-media-not-ready");
  if (entry.after.some((audio) => Math.abs(audio.rate - rate) > rate * 0.001)) entry.issues.push("shared-transport-wrong-playback-rate");
  if (entry.after.some((audio) => audio.paused)) entry.issues.push("unexpectedly-paused-source");
  if (maxClockSpreadMs > report.thresholds.clockSpreadMs) entry.issues.push("media-clock-spread-over-20ms");
  report.cases.push(entry);
  updateStatus();
  if (report.cases.length % 4 === 0) await persist();
}

function verifyCoverage(): void {
  const longStates = report.cases.filter((entry) => entry.category === "long-state-sync");
  const sliderCases = report.cases.filter((entry) => entry.category === "volume-slider");
  const stressCases = report.cases.filter((entry) => entry.category === "rapid-play-pause");
  const stateKeys = new Set(longStates.map((entry) => `${entry.rate}:${entry.mask}`));
  if (multiAudibleMasks.length !== 14 || stateKeys.size !== 56 || longStates.length !== 56 || sliderCases.length !== 15 || stressCases.length !== 2 || report.cases.filter((entry) => entry.category === "transpose").length !== 32 || report.cases.length !== report.coverage.expectedCases) {
    throw new Error(`Supplementary coverage incomplete: states=${stateKeys.size}, sliders=${sliderCases.length}, stress=${stressCases.length}, total=${report.cases.length}`);
  }
}

async function run(): Promise<void> {
  try {
    await delay(1200);
    if (multiAudibleMasks.length !== 14) throw new Error("Unexpected multi-source state enumeration");
    report.phase = "14 audible-pair states × 4 speeds";
    for (const rate of rates) {
      await playing(false); await resetSliders(); await setMask(0);
      await setRate(rate); await seekMarker(); await playing(true); await delay(400);
      for (const mask of multiAudibleMasks) {
        await setMask(mask); await delay(200);
        await capture({ category: "long-state-sync", name: `long state ${mask} at ${rate}x`, mask, rate,
          durationMs: rate === 0.25 ? 3000 : 2000 });
      }
    }

    report.phase = "Individual volume sliders";
    await playing(false); await setRate(1); await resetSliders(); await setMask(0);
    await seekMarker(); await playing(true); await delay(300);
    for (const channel of [0, 1, 2]) {
      await resetSliders();
      const mask = 1 << (channel * 2 + 1);
      await setMask(mask);
      for (const percentage of percentages) {
        await setSlider(channel, percentage); await delay(180);
        const volumes = [1, 1, 1];
        volumes[channel] = percentage / 100;
        await capture({ category: "volume-slider", name: `${ids[channel]} solo volume ${percentage}%`, mask,
          rate: 1, durationMs: 1000, volumes, details: { channel: ids[channel], percentage } });
      }
    }

    report.phase = "Rapid play/pause";
    for (const gapMs of [30, 100]) {
      await playing(false); await resetSliders(); await setMask(0); await setRate(1);
      await seekMarker(); await playing(true); await delay(300);
      let unexpectedPauseStates = 0;
      let unexpectedPlayStates = 0;
      let pendingPlayStates = 0;
      for (let cycle = 0; cycle < 20; cycle++) {
        transportButton().click(); await delay(gapMs);
        if (media().some((audio) => !audio.paused)) unexpectedPauseStates++;
        transportButton().click(); await delay(gapMs);
        if (media().some((audio) => audio.paused)) {
          // A reload may be pending after 30 ms. It must be visible, retain
          // Play intent and remain stoppable; the final capture requires sound.
          if (transportButton().title === "停止" && document.querySelector('[aria-label="Playback preparation"]')) pendingPlayStates++;
          else unexpectedPlayStates++;
        }
      }
      await playing(true);
      await delay(300);
      await capture({ category: "rapid-play-pause", name: `20 play/pause cycles with ${gapMs}ms gaps`,
        mask: 0, rate: 1, durationMs: 3000,
        details: { cycles: 20, buttonClicks: 40, gapMs, pendingPlayStates, unexpectedPauseStates, unexpectedPlayStates } });
      const entry = report.cases[report.cases.length - 1];
      if (unexpectedPauseStates) entry.issues.push("rapid-pause-did-not-pause-all-sources");
      if (unexpectedPlayStates) entry.issues.push("rapid-play-did-not-start-all-sources");
    }
    report.phase = "Transpose with shared transport";
    for (const semitones of [-6, 6]) {
      button("転調を0に戻す").click(); await delay(0);
      for (let step = 0; step < Math.abs(semitones); step++) {
        button(semitones < 0 ? "半音下げる" : "半音上げる").click(); await delay(0);
      }
      for (const rate of rates) {
        await playing(false); await resetSliders(); await setRate(rate);
        await seekMarker(); await playing(true); await delay(500);
        for (const mask of [0, 2, 8, 32]) {
          await setMask(mask); await delay(250);
          await capture({ category: "transpose", name: `${semitones} semitones state ${mask} at ${rate}x`,
            mask, rate, durationMs: 1600, details: { semitones } });
        }
      }
    }
    button("転調を0に戻す").click(); await delay(0);
    await setRate(1); await resetSliders(); await setMask(0);
    verifyCoverage();
    report.suiteFinished = true;
  } catch (error) {
    report.errors.push(error instanceof Error ? `${error.message}\n${error.stack ?? ""}` : String(error));
  } finally {
    await playing(false).catch(() => undefined);
    report.complete = true;
    report.finishedAt = new Date().toISOString();
    report.phase = report.suiteFinished ? "Complete" : "Stopped with error";
    updateStatus();
    start.textContent = "Audit finished";
    measure.disabled = false;
    pause.disabled = false;
    await persist();
  }
}

start.onclick = () => {
  start.disabled = true;
  // Preserve the trusted native Start tap's user activation for the real play handler.
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
measure.onclick = () => {
  measure.disabled = true;
  pause.disabled = true;
  // The actual play handler runs synchronously inside this trusted tap.
  if (media()[0].paused) transportButton().click();
  void (async () => {
    try {
      await delay(200);
      const mask = readMask();
      const volumes = ids.map((_, index) => Number(slider(index).value) / 100);
      const speedText = document.querySelector('[aria-label="Playback speed"] strong')?.textContent?.trim() ?? "";
      const rate = Number.parseFloat(speedText);
      if (!Number.isFinite(rate) || rate <= 0) throw new Error(`Cannot read playback speed: ${speedText}`);
      report.phase = "Manual touch measurement";
      const measuredAt = new Date().toISOString();
      await capture({ category: "manual-touch", name: `manual mix ${mask} at ${measuredAt}`, mask, rate,
        durationMs: 1000, volumes, details: { measuredAt } });
      report.phase = "Manual sample saved";
      updateStatus();
      await persist();
    } catch (error) {
      report.errors.push(error instanceof Error ? error.message : String(error));
      report.phase = "Manual measurement error";
      updateStatus();
      await persist();
    } finally {
      measure.disabled = false;
      pause.disabled = false;
    }
  })();
};
pause.onclick = () => {
  if (!media()[0].paused) transportButton().click();
};
window.addEventListener("error", (event) => report.errors.push(event.message));
window.addEventListener("unhandledrejection", (event) => report.errors.push(String(event.reason)));
document.addEventListener("visibilitychange", () => {
  report.events.push({ time: performance.now(), label: "document", event: `visibility:${document.visibilityState}`,
    mediaTime: document.querySelector("audio")?.currentTime ?? 0 });
});

async function prepare(): Promise<void> {
  const deadline = performance.now() + 30_000;
  const ready = () => document.querySelectorAll("audio").length === 1 &&
    document.querySelector('button[title="再生"]:not(:disabled)') &&
    document.querySelector('button[title="ギターをソロ"]:not(:disabled)');
  while (!ready() && performance.now() < deadline) await delay(100);
  if (!ready()) throw new Error("Production mixer and playback controls did not become ready.");
  await window.__audioAuditProbe.ready();
  for (const audio of media()) {
    for (const name of ["play", "playing", "pause", "waiting", "stalled", "seeking", "seeked", "ended", "error"]) {
      audio.addEventListener(name, () => report.events.push({
        time: performance.now(), label: audio.getAttribute("aria-label") ?? "", event: name, mediaTime: audio.currentTime
      }));
    }
  }
  const showCurrentMask = () => { currentMix.textContent = `Current mute/solo mask: ${readMask()}`; };
  const stateObserver = new MutationObserver(showCurrentMask);
  stateObserver.observe(document.body, { subtree: true, attributes: true, attributeFilter: ["aria-pressed"] });
  showCurrentMask();
  start.disabled = false;
  status.textContent = "Ready · 105 supplementary captures with real app playback";
}

void prepare().catch((error: unknown) => {
  status.textContent = String(error);
  report.errors.push(String(error));
  void persist();
});
