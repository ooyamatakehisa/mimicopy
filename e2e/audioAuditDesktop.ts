import { mkdir, writeFile } from "node:fs/promises";
import { chromium, webkit, expect } from "@playwright/test";

// Intentionally separate from the fast default E2E suite: a full run takes
// several minutes and records failures without aborting the remaining cases.
const engine = process.argv[2] === "webkit" ? "webkit" : "chromium";
const quick = process.argv.includes("--quick");
const rate = process.argv.includes("--rate");
if (rate && (quick || process.argv.includes("--additional"))) throw new Error("Use --rate separately from --quick/--additional");
const scope = rate ? "rate" : process.argv.includes("--additional") ? "mp3-additional" : quick ? "quick" : "full";
const runId = `${engine}-${scope}-${Date.now()}`;
const directory = process.env.MIMICOPY_AUDIO_AUDIT_OUTPUT ?? "audio-audit.local/manual";
const port = process.env.MIMICOPY_AUDIO_AUDIT_PORT ?? "8197";
const browser = await (engine === "webkit" ? webkit : chromium).launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
page.on("pageerror", (error) => console.error("Page error:", error.message));
await mkdir(directory, { recursive: true });
try {
  await page.goto(`http://127.0.0.1:${port}/tracks/audio-audit?run=${runId}${quick ? "&quick=1" : ""}`);
  const start = page.getByRole("button", { name: "Start audio audit", exact: true });
  await start.waitFor();
  if (rate) {
    await page.waitForFunction(() => window.__audioAuditReport?.complete ||
      [...document.querySelectorAll<HTMLButtonElement>("button")].some((button) => button.textContent === "Start audio audit" && !button.disabled),
    undefined, { timeout: 45000 });
    const initial = await page.evaluate(() => ({ protocol: window.__audioAuditReport?.protocol, complete: window.__audioAuditReport?.complete }));
    if (initial.protocol !== "mimicopy-audio-rate-diagnostic-v1") throw new Error("--rate requires an audit server started with MIMICOPY_AUDIO_AUDIT_SUITE=rate");
    if (!initial.complete) await start.click({ timeout: 45000 });
  } else await start.click({ timeout: 45000 });
  const deadline = Date.now() + 20 * 60 * 1000;
  for (;;) {
    await page.waitForTimeout(5000);
    const progress = await page.evaluate(() => {
      const report = window.__audioAuditReport;
      return { complete: report?.complete, phase: report?.phase, cases: report?.cases.length, errors: report?.errors };
    });
    console.log(JSON.stringify({ runId, ...progress }));
    if (progress.complete) break;
    if (Date.now() > deadline) throw new Error("Audit timed out");
  }
  await page.screenshot({ path: `${directory}/${runId}.png`, fullPage: true });
  if (rate) {
    // Preserve partial/error reports even if the fixture server POST failed.
    const result = await page.evaluate(() => window.__audioAuditReport);
    await writeFile(`${directory}/${runId}.json`, JSON.stringify(result, null, 2));
    const passed = "passed" in result && result.passed === true;
    console.log(JSON.stringify({ runId, complete: result.complete, suiteFinished: result.suiteFinished, passed, errors: result.errors }));
    if (!passed) process.exitCode = 1;
  } else {
  // These are trusted keyboard events, unlike synthetic KeyboardEvents.
  const keyboardResults: unknown[] = [];
  for (const label of ["原音", "ギター", "ギター以外"]) {
    for (const action of ["ミュート", "ソロ"]) {
      for (const key of ["Enter", "Space"]) {
        const target = page.getByTitle(`${label}を${action}`, { exact: true });
        const play = page.getByTitle("再生", { exact: true });
        const pauseBefore = page.getByTitle("停止", { exact: true });
        if (await pauseBefore.count()) await pauseBefore.click();
        await expect(play).toBeEnabled();
        await expect(page.getByLabel("Playback preparation")).toHaveCount(0, { timeout: 16000 });
        const before = await target.getAttribute("aria-pressed");
        const playingBefore = await page.locator("audio").first().evaluate((audio: HTMLAudioElement) => !audio.paused);
        await target.focus(); await page.keyboard.press(key);
        await page.waitForFunction(() => {
          const audio = document.querySelector("audio");
          return audio && !audio.paused && audio.currentTime > 0;
        }, undefined, { timeout: 16000 });
        const after = await target.getAttribute("aria-pressed");
        const playingAfter = await page.locator("audio").first().evaluate((audio: HTMLAudioElement) => !audio.paused);
        keyboardResults.push({ policy: "playback-priority", label, action, key, before, after, toggled: before !== after,
          playingBefore, playing: playingAfter });
        const pause = page.getByTitle("停止", { exact: true });
        if (await pause.count()) await pause.click();
      }
    }
  }
  await writeFile(`${directory}/${runId}-keyboard.json`, JSON.stringify(keyboardResults, null, 2));
  }
  console.log(`Saved ${directory}/${runId}.json`);
} finally {
  await browser.close();
}
