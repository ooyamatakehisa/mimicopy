import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium, webkit } from "@playwright/test";
import type { AudioMeasurement } from "./audioAuditSignal";

// Targeted diagnostic, separate from the matrix gate. Capture continuously
// across the exact transport/control boundaries that raised spectral candidates.
const engine = process.argv[2] ?? "webkit";
if (engine !== "webkit" && engine !== "chromium") throw new Error("Use chromium or webkit.");
const output = path.resolve(process.env.MIMICOPY_AUDIO_AUDIT_OUTPUT ?? "audio-audit.local/manual");
const port = process.env.MIMICOPY_AUDIO_AUDIT_PORT ?? "8197";
const disablePreservePitch = process.argv.includes("--disable-preserve-pitch");
const pauseBeforeSeek = process.argv.includes("--pause-before-seek");
const reloadBeforeSeek = process.argv.includes("--reload-before-seek");
const reloadBeforePlay = process.argv.includes("--reload-before-play");
const gainReversals = process.argv.includes("--gain-reversals");
await mkdir(output, { recursive: true });
const browser = await (engine === "webkit" ? webkit : chromium).launch();
try {
  const page = await browser.newPage();
  // tsx preserves nested function names with this helper when serializing the
  // diagnostic callback. It affects names only, never browser/media behavior.
  await page.addInitScript("window.__name = (value) => value");
  const runId = `stereo-replay-${engine}-${Date.now()}`;
  await page.goto(`http://127.0.0.1:${port}/tracks/audio-audit?run=${runId}`);
  await page.waitForFunction(() => window.__audioAuditProbe?.status().ready &&
    document.querySelector<HTMLButtonElement>('button[title="再生"]')?.disabled === false);
  if (disablePreservePitch) await page.evaluate(() => {
    // Explicit browser-mechanism experiment, never a production regression pass.
    document.querySelector("audio")!.preservesPitch = false;
  });
  await page.locator('button[title="再生"]').click();
  const results = await page.evaluate(async ({ pauseBeforeSeek, reloadBeforeSeek, reloadBeforePlay, gainReversals }) => {
    const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
    const labels = ["原音", "ギター", "ギター以外"];
    const button = (title: string) => {
      const element = document.querySelector<HTMLButtonElement>(`button[title="${title}"]`);
      if (!element) throw new Error(`Missing button: ${title}`);
      return element;
    };
    const setMask = async (mask: number) => {
      for (let bit = 0; bit < 6; bit++) {
        const control = button(`${labels[Math.floor(bit / 2)]}を${bit % 2 ? "ソロ" : "ミュート"}`);
        if ((control.getAttribute("aria-pressed") === "true") !== Boolean(mask & (1 << bit))) control.click();
      }
      await delay(0);
    };
    const samples: { name: string; signal: AudioMeasurement; mediaTime: number; preservesPitch: boolean }[] = [];
    const media = () => document.querySelector("audio")!;
    const reload = async () => {
      await new Promise<void>((resolve, reject) => {
        const audio = media();
        const timer = setTimeout(() => reject(new Error("Diagnostic media reload did not finish")), 3000);
        audio.addEventListener("loadedmetadata", () => { clearTimeout(timer); resolve(); }, { once: true });
        audio.load();
      });
    };
    const waitForSeek = async () => {
      await delay(20);
      const deadline = performance.now() + 3000;
      while (media().seeking && performance.now() < deadline) await delay(10);
      if (media().seeking) throw new Error("Diagnostic seek did not finish");
    };
    const resumePlayback = async () => {
      if (reloadBeforePlay) {
        const target = media().currentTime;
        await reload();
        media().currentTime = target;
        await waitForSeek();
      }
      button("再生").click();
    };
    const seekMarker = async () => {
      const resume = (pauseBeforeSeek || reloadBeforeSeek) && !media().paused;
      if (resume) { button("停止").click(); await delay(20); }
      if (reloadBeforeSeek) await reload();
      button("マーカーへ移動").click();
      if (resume) {
        await waitForSeek();
        button("再生").click();
      }
    };
    const record = async (name: string, duration: number) => {
      const signal = await window.__audioAuditProbe.capture(duration, 1, 0, true);
      samples.push({ name, signal, mediaTime: media().currentTime, preservesPitch: media().preservesPitch });
    };
    await delay(1200);
    for (let iteration = 0; iteration < 5; iteration++) {
      await setMask(0);
      await seekMarker(); await delay(150);
      await setMask(32); await delay(60); await setMask(33); await delay(160);
      await setMask(32); await delay(60);
      const transition = record(`transition boundary ${iteration}`, 1600);
      await delay(40); await setMask(34);
      await transition;
      await record(`transition settled ${iteration}`, 160);
      await setMask(0);
      button("停止").click(); await delay(120);
      const resume = record(`resume boundary ${iteration}`, 1600);
      await delay(40); await resumePlayback();
      await resume;
      await record(`resume settled ${iteration}`, 180);
      await setMask(4); await delay(120);
      const seek = record(`seek boundary ${iteration}`, 1600);
      await delay(40); await seekMarker();
      await seek;
      await record(`seek settled ${iteration}`, 200);
    }
    if (gainReversals) for (const gapMs of [0, 2, 4, 8, 16]) {
      await setMask(32); await seekMarker(); await delay(700);
      const reversal = record(`gain reversal ${gapMs}ms`, 600);
      await delay(80); await setMask(34); await delay(gapMs); await setMask(32);
      await reversal;
    }
    button("停止").click();
    return samples;
  }, { pauseBeforeSeek, reloadBeforeSeek, reloadBeforePlay, gainReversals });
  await writeFile(path.join(output, `${runId}.json`), JSON.stringify({
    runId, engine, disablePreservePitch, pauseBeforeSeek, reloadBeforeSeek, reloadBeforePlay, gainReversals,
    userAgent: await page.evaluate(() => navigator.userAgent),
    method: "Continuous real output across seek, 32 → 33 → 32 → 34, resume 0 and seek 4; five repeats, with settled captures. Diagnostic only.",
    cases: results
  }));
  console.log(`Saved ${results.length} diagnostic captures to ${path.join(output, `${runId}.json`)}`);
} finally {
  await browser.close();
}
