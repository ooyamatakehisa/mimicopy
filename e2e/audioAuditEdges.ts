import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium, webkit, type Browser, type Page } from "@playwright/test";
import type { AudioAuditStatus, AudioMeasurement } from "./audioAuditSignal";

// Run after the matrix audit to avoid competing for audio render resources:
// pnpm exec tsx e2e/audioAuditEdges.ts chromium --only=cold-500,cold-1500
// Omit the engine argument to run Chromium and WebKit sequentially.
type Engine = "chromium" | "webkit";
type CaseId = "cold-500" | "cold-1500" | "delayed-media-rapid-toggle" | "missing-media" | "visibility";
type MediaState = {
  label: string | null;
  currentTime: number;
  paused: boolean;
  seeking: boolean;
  readyState: number;
  volume: number;
  playbackRate: number;
  error: { code: number; message: string } | null;
};
type MediaEventTrace = {
  browserTimeMs: number;
  event: string;
  label: string | null;
  currentTime: number | null;
  visibility: DocumentVisibilityState;
};
type Snapshot = {
  atMs: number;
  browserTimeMs: number;
  visibility: DocumentVisibilityState;
  probe: AudioAuditStatus | null;
  media: MediaState[];
  playVisible: boolean;
  playEnabled: boolean;
  pauseVisible: boolean;
  waveformStatus: string;
};
type Observation = {
  name: string;
  before: Snapshot;
  after: Snapshot;
  measured: boolean;
  signal: AudioMeasurement | null;
  measurementError: string | null;
  checks: {
    allSourcesPlaying: boolean;
    allSourcesPaused: boolean;
    allCarriersAudible: boolean | null;
    outputSilent: boolean | null;
    signalLagWithin20Ms: boolean | null;
    maximumPairLagMs: number | null;
    mediaClockSpreadMs: number;
    playbackErrorVisible: boolean;
  };
};
type EdgeCase = {
  id: CaseId;
  engine: Engine;
  runId: string;
  url: string;
  expected: string;
  startedAt: string;
  finishedAt: string;
  outcome: "observed" | "skipped" | "harness-error";
  reason: string | null;
  actions: { atMs: number; action: string; completed: boolean; error?: string }[];
  network: { url: string; action: "delay" | "404"; startedMs: number; completedMs?: number; error?: string }[];
  samples: Snapshot[];
  observations: Observation[];
  events: MediaEventTrace[];
  pageErrors: string[];
  consoleErrors: string[];
};

declare global {
  interface Window { __audioAuditEdgeEvents: MediaEventTrace[]; }
}

const args = process.argv.slice(2);
const engineArgument = args.find((argument) => !argument.startsWith("--"));
if (engineArgument && engineArgument !== "chromium" && engineArgument !== "webkit" && engineArgument !== "all") {
  throw new Error("Engine must be chromium, webkit, or all.");
}
const engines: Engine[] = engineArgument === "chromium" || engineArgument === "webkit"
  ? [engineArgument] : ["chromium", "webkit"];
const requested = args.find((argument) => argument.startsWith("--only="))?.slice(7).split(",");
const allCases: CaseId[] = ["cold-500", "cold-1500", "delayed-media-rapid-toggle", "missing-media", "visibility"];
if (requested?.some((id) => !allCases.includes(id as CaseId))) throw new Error("Unknown --only case name.");
const caseIds = allCases.filter((id) => !requested || requested.includes(id));
const outputDirectory = process.env.MIMICOPY_AUDIO_AUDIT_OUTPUT
  ?? process.env.AUDIO_AUDIT_OUTPUT_DIR ?? "audio-audit.local/manual";
const port = process.env.MIMICOPY_AUDIO_AUDIT_PORT ?? "8197";
const runStamp = Date.now();
const sleep = (durationMs: number) => new Promise<void>((resolve) => setTimeout(resolve, durationMs));
const errorText = (error: unknown) => error instanceof Error ? error.message : String(error);

async function snapshot(page: Page, started: number): Promise<Snapshot> {
  const value = await page.evaluate(() => ({
    browserTimeMs: performance.now(),
    visibility: document.visibilityState,
    probe: window.__audioAuditProbe?.status() ?? null,
    media: Array.from(document.querySelectorAll("audio"), (audio) => ({
      label: audio.getAttribute("aria-label"),
      currentTime: audio.currentTime,
      paused: audio.paused,
      seeking: audio.seeking,
      readyState: audio.readyState,
      volume: audio.volume,
      playbackRate: audio.playbackRate,
      error: audio.error ? { code: audio.error.code, message: audio.error.message } : null
    })),
    playVisible: Boolean(document.querySelector('button[title="再生"]')),
    playEnabled: document.querySelector<HTMLButtonElement>('button[title="再生"]')?.disabled === false,
    pauseVisible: Boolean(document.querySelector('button[title="停止"]')),
    waveformStatus: document.querySelector('[aria-label="Waveform"] > div')?.textContent ?? ""
  }));
  return { atMs: Date.now() - started, ...value };
}

async function observe(page: Page, entry: EdgeCase, started: number, name: string): Promise<void> {
  const before = await snapshot(page, started);
  let signal: AudioMeasurement | null = null;
  let measurementError: string | null = null;
  if (!before.probe?.ready || before.probe.contextState !== "running") {
    measurementError = `Output was not measured: probe ready=${before.probe?.ready ?? false}, context=${before.probe?.contextState ?? "missing"}.`;
  } else {
    try {
      signal = await page.evaluate(() => window.__audioAuditProbe.capture(1600));
    } catch (error) {
      measurementError = errorText(error);
    }
  }
  const after = await snapshot(page, started);
  const lags = signal?.pairs.flatMap((pair) => pair.lagMs === null ? [] : [Math.abs(pair.lagMs)]) ?? [];
  const times = after.media.map((audio) => audio.currentTime);
  entry.observations.push({
    name, before, after,
    measured: signal?.valid ?? false,
    signal, measurementError,
    checks: {
      allSourcesPlaying: after.media.length === 1 && after.media.every((audio) => !audio.paused),
      allSourcesPaused: after.media.length === 1 && after.media.every((audio) => audio.paused),
      allCarriersAudible: signal?.valid ? Object.values(signal.mixedToneRms).every((rms) => rms >= 0.0005) : null,
      outputSilent: signal?.valid ? signal.mixedRms < 0.00015 : null,
      signalLagWithin20Ms: lags.length === 3 ? lags.every((lag) => lag <= 20) : null,
      maximumPairLagMs: lags.length ? Math.max(...lags) : null,
      mediaClockSpreadMs: times.length ? (Math.max(...times) - Math.min(...times)) * 1000 : 0,
      // The badge and message are adjacent elements: textContent can produce
      // "errorThe element...", so a word boundary after error is unreliable.
      playbackErrorVisible: /^error/i.test(after.waveformStatus.trim())
    }
  });
}

async function runCase(browser: Browser, engine: Engine, id: CaseId): Promise<EdgeCase> {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  page.setDefaultTimeout(12_000);
  const started = Date.now();
  const runId = `edge-${engine}-${id}-${runStamp}`;
  const entry: EdgeCase = {
    id, engine, runId,
    url: `http://127.0.0.1:${port}/tracks/audio-audit?run=${runId}`,
    expected: id.startsWith("cold-")
      ? "Play stays disabled and media time stays at zero until the graph is ready; then one trusted Play produces synchronized output."
      : id === "missing-media"
      ? "A failed shared media play request should visibly report an error and pause all sources; any measured output should be silent."
      : id === "visibility"
        ? "Only count genuine document visibility changes. Record playback and audio output before, during, and after backgrounding."
        : "After the final trusted Play action and delayed resources finish loading, all three sources should play audibly with matching envelopes; no extra user gesture should be necessary.",
    startedAt: new Date().toISOString(), finishedAt: "", outcome: "observed", reason: null,
    actions: [], network: [], samples: [], observations: [], events: [], pageErrors: [], consoleErrors: []
  };
  page.on("pageerror", (error) => entry.pageErrors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") entry.consoleErrors.push(message.text()); });
  let releaseGate = () => {};
  const gate = new Promise<void>((resolve) => { releaseGate = resolve; });
  let releaseTimer: ReturnType<typeof setTimeout> | undefined;
  const action = async (title: "再生" | "停止", timeout = 700) => {
    const item: EdgeCase["actions"][number] = {
      atMs: Date.now() - started, action: `Trusted button click: ${title}`, completed: false
    };
    entry.actions.push(item);
    try {
      await page.getByTitle(title, { exact: true }).click({ timeout });
      item.completed = true;
    } catch (error) { item.error = errorText(error); }
    entry.samples.push(await snapshot(page, started));
    return item.completed;
  };
  const sampleFor = async (durationMs: number) => {
    const deadline = Date.now() + durationMs;
    do {
      entry.samples.push(await snapshot(page, started));
      await sleep(100);
    } while (Date.now() < deadline);
  };
  const releaseAfter = (delayMs: number) => {
    entry.actions.push({ atMs: Date.now() - started, action: `Schedule held network responses to release in ${delayMs} ms`, completed: true });
    releaseTimer = setTimeout(() => {
      entry.actions.push({ atMs: Date.now() - started, action: "Release held network responses", completed: true });
      releaseGate();
    }, delayMs);
  };

  try {
    await page.addInitScript(() => {
      window.__audioAuditEdgeEvents = [];
      for (const name of ["play", "playing", "pause", "waiting", "stalled", "seeking", "seeked", "ended", "error", "loadedmetadata", "canplay"]) {
        document.addEventListener(name, (event) => {
          if (!(event.target instanceof HTMLMediaElement)) return;
          window.__audioAuditEdgeEvents.push({
            browserTimeMs: performance.now(), event: name,
            label: event.target.getAttribute("aria-label"), currentTime: event.target.currentTime,
            visibility: document.visibilityState
          });
        }, true);
      }
      document.addEventListener("visibilitychange", () => window.__audioAuditEdgeEvents.push({
        browserTimeMs: performance.now(), event: "visibilitychange", label: null,
        currentTime: null, visibility: document.visibilityState
      }));
    });
    if (id.startsWith("cold-")) {
      await page.route(/signalsmith[-_]?stretch/i, async (route) => {
        const network: EdgeCase["network"][number] = {
          url: route.request().url(), action: "delay", startedMs: Date.now() - started
        };
        entry.network.push(network);
        await gate;
        try { await route.continue(); network.completedMs = Date.now() - started; }
        catch (error) { network.error = errorText(error); }
      });
    } else if (id === "delayed-media-rapid-toggle" || id === "missing-media") {
      await page.route("**/media/audio-audit-mixer.wav", async (route) => {
        const network: EdgeCase["network"][number] = {
          url: route.request().url(), action: id === "missing-media" ? "404" : "delay",
          startedMs: Date.now() - started
        };
        entry.network.push(network);
        if (id === "delayed-media-rapid-toggle") await gate;
        try {
          if (id === "missing-media") await route.fulfill({ status: 404, contentType: "text/plain", body: "Missing audit mixer fixture" });
          else await route.continue();
          network.completedMs = Date.now() - started;
        } catch (error) { network.error = errorText(error); }
      });
    }
    await page.goto(entry.url, { waitUntil: "domcontentloaded", timeout: 20_000 });
    await page.getByTitle("再生", { exact: true }).waitFor();
    await page.waitForFunction(() => document.querySelectorAll("audio").length === 1);
    // Confirm the cold graph fault setup. Playback must remain unavailable
    // while initialization is held, without consuming any source audio.
    if (id.startsWith("cold-") && !entry.network.length) {
      await page.waitForTimeout(100);
      if (!entry.network.length) throw new Error("No Signalsmith network module was intercepted; cold graph setup was not achieved.");
    }
    if (id.startsWith("cold-")) {
      const preparing = await snapshot(page, started);
      entry.samples.push(preparing);
      if (preparing.playEnabled) throw new Error("Play must stay disabled while the graph is loading.");
      const auditStartEnabled = await page.getByRole("button", { name: "Start audio audit", exact: true }).isEnabled();
      if (auditStartEnabled) throw new Error("Audit Start must not bypass a disabled production Play button.");
      releaseAfter(id === "cold-500" ? 500 : 1500);
      await sampleFor(id === "cold-500" ? 350 : 1000);
      const pending = await snapshot(page, started);
      entry.samples.push(pending);
      if (pending.media.some((audio) => !audio.paused || audio.currentTime > 0.01)) {
        throw new Error("Media advanced before the graph was ready, discarding initial audio.");
      }
      await page.waitForFunction(() => document.querySelector<HTMLButtonElement>('button[title="再生"]')?.disabled === false);
    }
    entry.samples.push(await snapshot(page, started));
    if (!await action("再生", 5000)) throw new Error("Initial trusted Play button could not be clicked.");

    if (id.startsWith("cold-")) {
      await sampleFor(1200);
      await observe(page, entry, started, "First trusted Play after graph preparation; no skipped opening audio");
    } else if (id === "delayed-media-rapid-toggle") {
      releaseAfter(1500);
      for (const title of ["停止", "再生", "停止", "再生"] as const) {
        await sleep(60);
        await action(title);
      }
      await sampleFor(3500);
      await observe(page, entry, started, "After delayed shared media and play-pause-play-pause-play");
    } else if (id === "missing-media") {
      await sampleFor(1800);
      await observe(page, entry, started, "After shared media HTTP 404 and real Play attempt");
    } else {
      await sampleFor(1200);
      await observe(page, entry, started, "Foreground baseline");
      const otherPage = await context.newPage();
      await otherPage.goto("about:blank");
      await otherPage.bringToFront();
      entry.actions.push({ atMs: Date.now() - started, action: "Bring a separate real browser tab to front", completed: true });
      await sleep(300);
      const hidden = await snapshot(page, started);
      entry.samples.push(hidden);
      if (hidden.visibility !== "hidden") {
        entry.outcome = "skipped";
        entry.reason = "This browser session did not report document.visibilityState=hidden after a genuine tab switch; no synthetic visibility event or property override was used.";
      } else {
        await observe(page, entry, started, "Actually hidden browser tab");
        await page.bringToFront();
        entry.actions.push({ atMs: Date.now() - started, action: "Bring original real browser tab to front", completed: true });
        await sampleFor(500);
        await observe(page, entry, started, "Foreground after real tab switch");
      }
      await otherPage.close();
    }
  } catch (error) {
    entry.outcome = "harness-error";
    entry.reason = errorText(error);
  } finally {
    if (releaseTimer) clearTimeout(releaseTimer);
    releaseGate();
    try {
      entry.events = await page.evaluate(() => window.__audioAuditEdgeEvents ?? []);
      entry.samples.push(await snapshot(page, started));
      await page.screenshot({ path: path.join(outputDirectory, `${runId}.png`), fullPage: true });
    } catch (error) { entry.pageErrors.push(`Final evidence collection: ${errorText(error)}`); }
    entry.finishedAt = new Date().toISOString();
    await context.close();
  }
  await writeFile(path.join(outputDirectory, `${runId}.json`), JSON.stringify(entry, null, 2));
  return entry;
}

await mkdir(outputDirectory, { recursive: true });
const results: EdgeCase[] = [];
for (const engine of engines) {
  const browser = await (engine === "webkit" ? webkit : chromium).launch();
  try {
    for (const id of caseIds) {
      const result = await runCase(browser, engine, id);
      results.push(result);
      console.log(JSON.stringify({ engine, id, outcome: result.outcome, reason: result.reason,
        observations: result.observations.map(({ name, measured, measurementError, checks }) => ({ name, measured, measurementError, checks })) }));
    }
  } finally { await browser.close(); }
}
await writeFile(path.join(outputDirectory, `edge-summary-${runStamp}.json`), JSON.stringify({
  method: "Actual application, native trusted Play/Pause clicks, real media and audio output; only selected network responses are deliberately delayed or failed. Visibility is tested only if the real tab switch changes the browser-reported visibility state.",
  results
}, null, 2));
