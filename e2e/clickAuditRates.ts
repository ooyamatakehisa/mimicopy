import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium, expect, webkit, type Page } from "@playwright/test";
import { analyzeRateClickAudit, type ClickAuditExpectation } from "./clickAuditRateAnalysis";
import { runClickAuditCalibration } from "./clickAuditCheck";
import { runClickRateCalibration } from "./clickAuditRateCheck";
import type { ClickAuditCapture } from "./clickAuditSignal";
import { assessClickAuditCoverage } from "./clickAuditCoverage";

const output = path.resolve(process.env.MIMICOPY_CLICK_AUDIT_OUTPUT ?? "audio-audit.local/click-rates");
const port = process.env.MIMICOPY_CLICK_AUDIT_PORT ?? "8201";
const rateArgument = process.argv.find((argument) => argument.startsWith("--rates="));
const rates = rateArgument ? rateArgument.slice(8).split(",").map(Number) : [1, .75, .5, .25];
if (!rates.length || rates.some((rate) => ![1, .75, .5, .25].includes(rate))) throw new Error("Use --rates=1,0.75,0.5,0.25 or a subset.");
const requestedEngine = process.argv.find((argument) => argument === "chromium" || argument === "webkit");
const engines = requestedEngine ? [requestedEngine] : ["chromium", "webkit"];
const operations = process.argv.includes("--operations");
const plannedCaptures = engines.flatMap((engine) => rates.flatMap((rate) =>
  (operations ? ["fresh", "warm-replay", "seek5.2", "seek5.0-boundary", "click-toggle", "all-music-muted"] : ["fresh"])
    .map((scenario) => `${engine}-${rate}x-${scenario}`)));
await mkdir(output, { recursive: true });
const serverMetadata: unknown = await (await fetch(`http://127.0.0.1:${port}/__click-audit/metadata`)).json();
await writeFile(path.join(output, "click-rate-plan.json"), JSON.stringify({ expected: plannedCaptures.length, names: plannedCaptures,
  engines, rates, operations, serverMetadata }, null, 2), { flag: "wx" });
const calibrations = { original: runClickAuditCalibration(), rates: runClickRateCalibration() };
await writeFile(path.join(output, "click-rate-calibration.json"), JSON.stringify(calibrations, null, 2), { flag: "wx" });
const summaries: Array<{ name: string; status: string; failures?: string[]; inconclusive?: string[]; error?: string }> = [];
const pause = async (page: Page) => {
  if (await page.getByTitle("停止", { exact: true }).count()) await page.getByTitle("停止", { exact: true }).click();
  await expect(page.getByLabel("Playback preparation")).toHaveCount(0, { timeout: 16_000 });
  await page.waitForFunction(() => document.querySelector("audio")?.paused === true);
};
const seek = async (page: Page, label: string, requestedStartSeconds: number) => {
  await page.getByLabel(`${label} label`, { exact: true }).locator("..").locator("..").getByTitle("マーカーへ移動", { exact: true }).click();
  await expect(page.getByLabel("Playback preparation")).toHaveCount(0, { timeout: 16_000 });
  await page.waitForFunction((target) => { const audio = document.querySelector("audio");
    return audio?.paused && !audio.seeking && audio.readyState >= 2 && Math.abs(audio.currentTime - target) <= .002;
  }, requestedStartSeconds, { timeout: 16_000 });
};
const contextTime = async (page: Page) => {
  const value = await page.evaluate(() => window.__clickAudit.status().clock?.contextTime);
  if (value === undefined) throw new Error("Missing context clock for the trusted control action.");
  return value;
};
const setAllMusicMuted = async (page: Page, muted: boolean) => {
  for (const label of ["原音", "ギター", "ギター以外"]) {
    const button = page.getByTitle(`${label}をミュート`, { exact: true });
    await expect(button).toBeEnabled();
    if ((await button.getAttribute("aria-pressed") === "true") !== muted) await button.click();
    await expect(button).toHaveAttribute("aria-pressed", String(muted));
  }
};
for (const engine of engines) {
  const browser = await (engine === "webkit" ? webkit : chromium).launch();
  try {
    for (const rate of rates) {
      const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
      const pageErrors: string[] = [];
      page.on("pageerror", (error) => pageErrors.push(error.message));
      let currentName = `${engine}-${rate}x-fresh`;
      try {
        await page.goto(`http://127.0.0.1:${port}/tracks/click-audit?run=${currentName}`);
        await expect(page.getByTitle("再生", { exact: true })).toBeEnabled({ timeout: 45_000 });
        await page.waitForFunction(() => window.__clickAudit?.status().ready || window.__clickAudit?.status().error);
        const probe = await page.evaluate(() => window.__clickAudit.status());
        if (!probe.ready || probe.musicDestinationNodes !== 1) throw new Error(JSON.stringify(probe));
        for (let index = 0; index < Math.round((1 - rate) / .25); index++) await page.keyboard.press("Shift+,");
        await page.waitForFunction((expectedRate) => document.querySelector("audio")?.playbackRate === expectedRate, rate);
        await expect(page.getByLabel("Playback preparation")).toHaveCount(0, { timeout: 16_000 });
        const toggle = page.getByTitle("クリック音をオン/オフ", { exact: true });
        await expect(toggle).toBeEnabled(); await toggle.click();
        await expect(toggle).toHaveAttribute("aria-pressed", "true");
        await page.waitForFunction(() => window.__clickAudit.status().clock?.state === "running");
        const measure = async (name: string, requestedStartSeconds: number, mode: "normal" | "toggle" | "all-music-muted" = "normal") => {
          currentName = name;
          await page.waitForFunction((target) => { const audio = document.querySelector("audio");
            return audio?.paused && !audio.seeking && Math.abs(audio.currentTime - target) <= .002;
          }, requestedStartSeconds, { timeout: 16_000 });
          const actions: Array<{ action: string; rate?: number; contextTime?: number; capturedAt?: string }> = [
            { action: "arm-before-trusted-play", rate, capturedAt: new Date().toISOString() }
          ];
          let expectation: ClickAuditExpectation = mode === "all-music-muted" ? { kind: "all-music-muted" } : { kind: "music-and-click" };
          await page.evaluate((durationMs) => window.__clickAudit.arm(durationMs), Math.round(mode === "toggle" ? 5500 / rate + 1500 : 5000 / rate + 1000));
          await page.getByTitle("再生", { exact: true }).click();
          actions.push({ action: "trusted-play-click-completed", contextTime: await contextTime(page) });
          if (mode === "toggle") {
            await page.waitForTimeout(2000 / rate);
            const beforeOff = await contextTime(page);
            await toggle.click();
            await expect(toggle).toHaveAttribute("aria-pressed", "false");
            const afterOff = await contextTime(page);
            actions.push({ action: "trusted-click-off-before", contextTime: beforeOff }, { action: "trusted-click-off-after", contextTime: afterOff });
            await page.waitForTimeout(1500 / rate);
            const beforeOn = await contextTime(page);
            await toggle.click();
            await expect(toggle).toHaveAttribute("aria-pressed", "true");
            const afterOn = await contextTime(page);
            actions.push({ action: "trusted-click-on-before", contextTime: beforeOn }, { action: "trusted-click-on-after", contextTime: afterOn });
            expectation = { kind: "click-toggle", off: { beforeContextTime: beforeOff, afterContextTime: afterOff },
              on: { beforeContextTime: beforeOn, afterContextTime: afterOn } };
          }
          const capture: ClickAuditCapture = await page.evaluate(() => window.__clickAudit.result());
          const raw = { name, engine, rate, serverMetadata, actions, expectation, requestedStartSeconds,
            captureContract: "armed-before-trusted-play", pageErrors, userAgent: await page.evaluate(() => navigator.userAgent), ...capture };
          await writeFile(path.join(output, `${name}.json`), JSON.stringify(raw), { flag: "wx" });
          const report = analyzeRateClickAudit(capture, expectation, requestedStartSeconds);
          await writeFile(path.join(output, `${name}-rate-analysis.json`), JSON.stringify(report, null, 2), { flag: "wx" });
          const summary = { name, status: pageErrors.length ? "inconclusive" : report.status, failures: report.failures,
            inconclusive: [...report.inconclusive, ...pageErrors],
            gating: report.gating, musicSynchronizationMeasured: report.musicSynchronizationMeasured,
            pairs: report.pairs.map((pair) => ({ beat: pair.beatTime, centroidMs: pair.clickMinusMusicCentroidMs, leadingMs: pair.clickMinusMusicLeadingMs, cueToClickMs: pair.cueToClickMs })) };
          summaries.push(summary); console.log(JSON.stringify(summary));
          await pause(page);
        };
        await measure(currentName, 0);
        if (operations) {
          currentName = `${engine}-${rate}x-warm-replay`;
          await seek(page, "Click restart target", 0);
          await measure(currentName, 0);
          currentName = `${engine}-${rate}x-seek5.2`;
          await seek(page, "Click seek target", 5.2);
          await measure(currentName, 5.2);
          currentName = `${engine}-${rate}x-seek5.0-boundary`;
          await seek(page, "Click beat boundary", 5);
          await measure(currentName, 5);
          currentName = `${engine}-${rate}x-click-toggle`;
          await seek(page, "Click seek target", 5.2);
          await measure(currentName, 5.2, "toggle");
          currentName = `${engine}-${rate}x-all-music-muted`;
          await setAllMusicMuted(page, true);
          await seek(page, "Click seek target", 5.2);
          await measure(currentName, 5.2, "all-music-muted");
          await setAllMusicMuted(page, false);
        }
      } catch (error) {
        const report = { name: currentName, status: "inconclusive", error: String(error), pageErrors };
        await writeFile(path.join(output, `${currentName}-error.json`), JSON.stringify(report, null, 2), { flag: "wx" });
        summaries.push(report); console.log(JSON.stringify(report));
      } finally { await page.close(); }
    }
  } finally { await browser.close(); }
}
const expected = engines.length * rates.length * (operations ? 6 : 1);
const coverage = assessClickAuditCoverage([{ expected, names: plannedCaptures }], summaries.filter((item) => !item.error).map((item) => item.name));
const counts = { expected, recorded: summaries.length, passed: summaries.filter((item) => item.status === "passed").length,
  failed: summaries.filter((item) => item.status === "failed").length, inconclusive: summaries.filter((item) => item.status === "inconclusive").length,
  missing: coverage.missing, confirmedFailureRecordings: summaries.filter((item) => item.failures?.length).length };
await writeFile(path.join(output, "click-rate-summary.json"), JSON.stringify({ serverMetadata, calibrations, plannedCaptures, coverage, counts, summaries }, null, 2), { flag: "wx" });
// Keep source fixture linkage accessible to offline/native analysis commands.
await readFile(path.join(output, "click-pulses.wav"));
process.exitCode = counts.inconclusive || counts.missing ? 2 : counts.failed ? 1 : 0;
