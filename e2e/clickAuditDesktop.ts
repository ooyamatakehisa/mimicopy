import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium, expect, webkit } from "@playwright/test";
import { analyzeClickAudit } from "./clickAuditAnalysis";
import { analyzeIdentifiedClicks } from "./clickAuditIdentity";
import { runClickAuditCalibration } from "./clickAuditCheck";
import type { ClickAuditCapture } from "./clickAuditSignal";
import { assessClickAuditCoverage } from "./clickAuditCoverage";

const output = path.resolve(process.env.MIMICOPY_CLICK_AUDIT_OUTPUT ?? "audio-audit.local/click-manual");
const port = process.env.MIMICOPY_CLICK_AUDIT_PORT ?? "8201";
const engineArgument = process.argv[2];
const engines = engineArgument === "chromium" || engineArgument === "webkit" ? [engineArgument] : ["chromium", "webkit"];
const plannedCaptures = engines.flatMap((engine) => Array.from({ length: process.argv.includes("--once") ? 1 : 2 }, (_, repeat) =>
  (process.argv.includes("--replay") ? ["fresh", "warm-replay"] : ["fresh"]).map((scenario) => `${engine}-${scenario}-1x-${repeat + 1}`)).flat());
await mkdir(output, { recursive: true });
await writeFile(path.join(output, "click-plan.json"), JSON.stringify({ expected: plannedCaptures.length, names: plannedCaptures }, null, 2), { flag: "wx" });
const calibration = runClickAuditCalibration();
await writeFile(path.join(output, "click-calibration.json"), JSON.stringify(calibration, null, 2), { flag: "wx" });
const serverMetadata: unknown = await (await fetch(`http://127.0.0.1:${port}/__click-audit/metadata`)).json();
const fixture = await readFile(path.join(output, "click-pulses.wav"))
  .catch(() => readFile(path.join(output, "..", "click-pulses.wav")));
const metadata = { startedAt: new Date().toISOString(), revision: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
  scope: "Fresh-start 1x, known 120 BPM pulses, actual production music and click output. Desktop browsers only.", calibration, serverMetadata };
await writeFile(path.join(output, "click-run-metadata.json"), JSON.stringify(metadata, null, 2), { flag: "wx" });
const summaries: { name: string; status: string; [key: string]: unknown }[] = [];
for (const engine of engines) {
  const browser = await (engine === "webkit" ? webkit : chromium).launch();
  try {
    for (let repeat = 0; repeat < (process.argv.includes("--once") ? 1 : 2); repeat++) {
      const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      const name = `${engine}-fresh-1x-${repeat + 1}`;
      let currentName = name;
      try {
        await page.goto(`http://127.0.0.1:${port}/tracks/click-audit?run=${name}`);
        await expect(page.getByTitle("再生", { exact: true })).toBeEnabled({ timeout: 45_000 });
        await page.waitForFunction(() => window.__clickAudit?.status().ready || window.__clickAudit?.status().error, undefined, { timeout: 45_000 });
        const status = await page.evaluate(() => window.__clickAudit.status());
        if (!status.ready || status.musicDestinationNodes !== 1) throw new Error(JSON.stringify(status));
        const click = page.getByTitle("クリック音をオン/オフ", { exact: true });
        await expect(click).toBeEnabled(); await click.click();
        await expect(click).toHaveAttribute("aria-pressed", "true");
        await page.waitForFunction(() => window.__clickAudit.status().clock?.state === "running");
        const measure = async (captureName: string) => {
          currentName = captureName;
          await page.waitForFunction(() => { const audio = document.querySelector("audio");
            return audio?.paused && !audio.seeking && Math.abs(audio.currentTime) <= .002;
          }, undefined, { timeout: 16_000 });
          await page.evaluate(() => window.__clickAudit.arm(8000));
          await page.getByTitle("再生", { exact: true }).click();
          const capture: ClickAuditCapture = await page.evaluate(() => window.__clickAudit.result());
          const report = { name: captureName, engine, repeat, requestedStartSeconds: 0, captureContract: "armed-before-trusted-play",
            userAgent: await page.evaluate(() => navigator.userAgent), errors, serverMetadata, ...capture };
          await writeFile(path.join(output, `${captureName}.json`), JSON.stringify(report), { flag: "wx" });
          const timing = analyzeClickAudit(capture);
          await writeFile(path.join(output, `${captureName}-timing.json`), JSON.stringify(timing, null, 2), { flag: "wx" });
          const identity = analyzeIdentifiedClicks(capture, fixture, 0);
          await writeFile(path.join(output, `${captureName}-identity.json`), JSON.stringify(identity, null, 2), { flag: "wx" });
          const summary = { name: captureName, status: errors.length ? "inconclusive" : identity.status,
            failures: identity.failures, inconclusive: identity.inconclusive, counts: timing.counts,
            musicMinusNativeMs: timing.musicMinusNativeMs, clickMinusNativeMs: timing.clickMinusNativeMs,
            clickMinusMusicMs: identity.pairs.map((pair) => ({ beatTime: pair.beatTime, milliseconds: pair.clickMinusMusicMs })), errors };
          summaries.push(summary); console.log(JSON.stringify(summary));
          if (await page.getByTitle("停止", { exact: true }).count()) await page.getByTitle("停止", { exact: true }).click();
        };
        await measure(name);
        if (process.argv.includes("--replay")) {
          currentName = `${engine}-warm-replay-1x-${repeat + 1}`;
          await expect(page.getByLabel("Playback preparation")).toHaveCount(0, { timeout: 16_000 });
          await page.getByLabel("Click restart target label", { exact: true }).locator("..").locator("..").getByTitle("マーカーへ移動", { exact: true }).click();
          await expect(page.getByLabel("Playback preparation")).toHaveCount(0, { timeout: 16_000 });
          await page.waitForFunction(() => { const audio = document.querySelector("audio"); return audio?.paused && audio.currentTime === 0 && !audio.seeking; });
          await measure(currentName);
        }
      } catch (error) {
        const failed = { name: currentName, status: "inconclusive", error: error instanceof Error ? error.message : String(error), errors };
        summaries.push(failed);
        await writeFile(path.join(output, `${currentName}-error.json`), JSON.stringify(failed, null, 2), { flag: "wx" });
        console.log(JSON.stringify(failed));
      } finally { await page.close(); }
    }
  } finally { await browser.close(); }
}
const expectedCaptures = engines.length * (process.argv.includes("--once") ? 1 : 2) * (process.argv.includes("--replay") ? 2 : 1);
const coverage = assessClickAuditCoverage([{ expected: expectedCaptures, names: plannedCaptures }], summaries.filter((item) => !item.error).map((item) => item.name));
const counts = { expected: expectedCaptures, recorded: summaries.length,
  passed: summaries.filter((item) => item.status === "passed").length,
  failed: summaries.filter((item) => item.status === "failed").length,
  inconclusive: summaries.filter((item) => item.status === "inconclusive").length,
  missing: coverage.missing,
  recordingsWithConfirmedFailures: summaries.filter((item) => Array.isArray(item.failures) && item.failures.length > 0).length };
await writeFile(path.join(output, "click-summary.json"), JSON.stringify({ ...metadata, finishedAt: new Date().toISOString(), plannedCaptures, coverage, counts, summaries }, null, 2), { flag: "wx" });
process.exitCode = counts.inconclusive || counts.missing ? 2 : counts.failed ? 1 : 0;
