import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { detectClickAuditPulses } from "./clickAuditAnalysis";
import { clickAuditBeatTimes } from "./clickAuditFixtures";
import type { ClickAuditCapture } from "./clickAuditSignal";
import { inspectClickAuditStart } from "./clickAuditStart";
import { assessClickAuditStereo } from "./clickAuditStereo";

/** Exact fixture identity avoids confusing a skipped beat with a one-beat lag. */
export function analyzeIdentifiedClicks(capture: ClickAuditCapture, fixture: Buffer, requestedStartSeconds?: number) {
  if (!capture || capture.protocol !== "mimicopy-click-pcm-v1" || capture.encoding !== "float32-le-base64" ||
      !Number.isSafeInteger(capture.frames) || capture.frames <= 0 || !Array.isArray(capture.clocks) || !Array.isArray(capture.events)) {
    throw new Error("Invalid or empty click PCM capture.");
  }
  if (capture.sampleRate !== 48_000 || fixture.readUInt32LE(24) !== 48_000 || fixture.readUInt16LE(22) !== 2) {
    throw new Error("Identity matching requires the exact stereo 48 kHz fixture.");
  }
  if (!capture.clocks.length || capture.clocks.some((clock) => clock.rate !== 1)) {
    throw new Error("This calibrated fixture identity estimator supports only constant 1x captures.");
  }
  const decode = (value: string) => {
    if (typeof value !== "string" || value.length % 4 !== 0) throw new Error("Invalid PCM base64.");
    // Avoid a repeated regex group: V8 can overflow its regex stack on a
    // valid35-second recording. These equivalent checks are linear in size.
    const padding = value.endsWith("==") ? 2 : value.endsWith("=") ? 1 : 0;
    if (/[^A-Za-z0-9+/]/.test(value.slice(0, value.length - padding))) throw new Error("Invalid PCM base64.");
    const bytes = Buffer.from(value, "base64");
    if (bytes.length !== capture.frames * 4) throw new Error("PCM length does not match capture frames.");
    const values = new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
    if (values.some((value) => !Number.isFinite(value))) throw new Error("PCM contains nonfinite samples.");
    return values;
  };
  const templates = clickAuditBeatTimes.map((time) => Float32Array.from({ length: 960 }, (_, frame) =>
    fixture.readInt16LE(44 + (Math.round(time * 48_000) + frame) * 4) / 32768));
  const identify = (value: string) => {
    const samples = decode(value);
    return detectClickAuditPulses(samples, capture.sampleRate).map((onsetFrame) => {
      const matches: { beatIndex: number; beatTime: number; pulseStartFrame: number; contextTime: number; fitMaximumError: number }[] = [];
      if (onsetFrame + 256 <= samples.length) {
        for (const [beatIndex, template] of templates.entries()) {
          for (let offset = 0; offset < 96; offset++) {
            if ([0, 1, 7, 31, 63, 127, 255].some((index) => Math.abs(samples[onsetFrame + index] - template[offset + index]) > 1e-5)) continue;
            let maximumError = 0;
            for (let index = 0; index < 256; index++) maximumError = Math.max(maximumError, Math.abs(samples[onsetFrame + index] - template[offset + index]));
            if (maximumError > 1e-5) continue;
            const pulseStartFrame = onsetFrame - offset;
            matches.push({ beatIndex, beatTime: clickAuditBeatTimes[beatIndex], pulseStartFrame,
              contextTime: capture.startContextTime + pulseStartFrame / capture.sampleRate, fitMaximumError: maximumError });
          }
        }
      }
      return { onsetFrame, status: matches.length === 1 ? "identified" : "unresolved", matches };
    });
  };
  const native = identify(capture.pcm.nativeLeft);
  const music = identify(capture.pcm.musicLeft);
  // Validate both sides even though beat identity is fitted on the left channel.
  const stereo = (["native", "music", "click"] as const).map((channel) => {
    const left = decode(capture.pcm[`${channel}Left`]), right = decode(capture.pcm[`${channel}Right`]);
    return assessClickAuditStereo(channel, left, right, capture.sampleRate, channel === "music" ? music.flatMap((pulse) =>
      pulse.matches.length === 1 && pulse.onsetFrame + .22 * capture.sampleRate < capture.frames
        ? [{ startFrame: Math.max(0, pulse.onsetFrame - Math.ceil(.04 * capture.sampleRate)),
          endFrame: pulse.onsetFrame + Math.ceil(.22 * capture.sampleRate), beatIndex: pulse.matches[0].beatIndex }] : []) : []);
  });
  const starts = capture.events.filter((event) => event.event === "oscillator.start" && event.scheduledTime !== undefined);
  const clicks = detectClickAuditPulses(decode(capture.pcm.clickLeft), capture.sampleRate).map((onsetFrame) => {
    const contextTime = capture.startContextTime + onsetFrame / capture.sampleRate;
    const matched = starts.filter((event) => Math.abs(contextTime - event.scheduledTime!) < .01);
    const event = matched.length === 1 ? matched[0] : null;
    // This inversion applies to the captured pre-fix scheduler formula only.
    // Retain the estimate and error instead of assuming an arbitrary ordinal.
    const estimate = event && event.mediaTime !== null && event.rate !== null
      ? event.mediaTime + (event.scheduledTime! - event.contextTime - .12) * event.rate : null;
    const beatTime = estimate === null ? null : Math.round(estimate * 2) / 2;
    return { onsetFrame, contextTime, scheduledTime: event?.scheduledTime ?? null,
      beatTime, estimatedBeatTime: estimate,
      status: beatTime !== null && estimate !== null && Math.abs(beatTime - estimate) < .03 ? "identified-from-current-scheduler" : "unresolved" };
  });
  const pairs = native.flatMap((source) => {
    if (source.matches.length !== 1) return [];
    const first = source.matches[0];
    const second = music.find((item) => item.matches.length === 1 && item.matches[0].beatIndex === first.beatIndex)?.matches[0];
    const nearby = second ? clicks.filter((item) => Math.abs(item.contextTime - second.contextTime) < .2) : [];
    const click = starts.length ? clicks.find((item) => item.status !== "unresolved" && item.beatTime === first.beatTime)
      : nearby.length === 1 ? nearby[0] : undefined;
    return [{ beatIndex: first.beatIndex, beatTime: first.beatTime,
      nativeContextTime: first.contextTime, musicContextTime: second?.contextTime ?? null,
      clickContextTime: click?.contextTime ?? null,
      musicMinusNativeMs: second ? (second.contextTime - first.contextTime) * 1000 : null,
      clickMinusNativeMs: click ? (click.contextTime - first.contextTime) * 1000 : null,
      clickMinusMusicMs: second && click ? (click.contextTime - second.contextTime) * 1000 : null }];
  });
  const nativeBeatTimes = native.flatMap((item) => item.matches.length === 1 ? [item.matches[0].beatTime] : []);
  const musicBeatTimes = music.flatMap((item) => item.matches.length === 1 ? [item.matches[0].beatTime] : []);
  const clickBeatTimes = clicks.flatMap((item) => item.status !== "unresolved" && item.beatTime !== null ? [item.beatTime] : []);
  const start = inspectClickAuditStart(capture, requestedStartSeconds);
  const failures: string[] = [...start.failures];
  const inconclusive: string[] = [...start.inconclusive];
  failures.push(...stereo.flatMap((channel) => channel.failures));
  const captureEnd = capture.startContextTime + capture.frames / capture.sampleRate;
  if (native.some((item) => item.status === "unresolved") || music.some((item) => item.status === "unresolved")) inconclusive.push("At least one native/music pulse has no unique fixture identity.");
  if (native.length < 6 || music.length < 6) inconclusive.push("Fewer than six native/music pulses were measured.");
  if (capture.routing.musicDestinationNodes !== 1 || capture.routing.sourceElements !== 1) inconclusive.push("Unexpected music/source tap routing.");
  const initialBeatTime = start.firstExpectedBeatIndex === null ? null : start.firstExpectedBeatIndex / 2;
  if (start.initialCoverageVerified && initialBeatTime !== null && native.length >= 6 && !nativeBeatTimes.includes(initialBeatTime)) {
    failures.push(`Fixture beat ${initialBeatTime} is missing from the native source after the requested/recorded start.`);
  }
  if (start.initialCoverageVerified && initialBeatTime !== null && nativeBeatTimes[0] !== undefined && nativeBeatTimes[0] < initialBeatTime) {
    failures.push(`Native PCM begins with stale beat ${nativeBeatTimes[0]}, before the first expected beat ${initialBeatTime}.`);
  }
  for (let index = 1; index < nativeBeatTimes.length; index++) {
    if (nativeBeatTimes[index] !== nativeBeatTimes[index - 1] + .5) {
      failures.push(`Native fixture identity skips or repeats between ${nativeBeatTimes[index - 1]}s and ${nativeBeatTimes[index]}s.`);
    }
  }
  const matchedClicks = new Set<number>();
  const physicalPairs = music.flatMap((item) => {
    if (item.matches.length !== 1) return [];
    const pulse = item.matches[0];
    if (pulse.contextTime + .025 >= captureEnd) return [];
    const matching = clicks.flatMap((click, index) => Math.abs(click.contextTime - pulse.contextTime) <= .020 ? [index] : []);
    if (matching.length !== 1) failures.push(`Music beat ${pulse.beatTime}s has ${matching.length} clicks within ±20 ms.`);
    for (const index of matching) matchedClicks.add(index);
    return [{ beatTime: pulse.beatTime, musicContextTime: pulse.contextTime,
      clickContextTime: matching.length === 1 ? clicks[matching[0]].contextTime : null,
      clickMinusMusicMs: matching.length === 1 ? (clicks[matching[0]].contextTime - pulse.contextTime) * 1000 : null }];
  });
  for (const pair of pairs) {
    if (pair.nativeContextTime + .145 < captureEnd && pair.musicContextTime === null) failures.push(`Native beat ${pair.beatTime}s has no identified processed-music pulse.`);
  }
  const orphanClicks = clicks.filter((click, index) => !matchedClicks.has(index) &&
    click.contextTime < captureEnd - .025);
  if (orphanClicks.length) failures.push(`${orphanClicks.length} measured clicks have no processed-music pulse within ±20 ms.`);
  const status = inconclusive.length ? "inconclusive" : failures.length ? "failed" : "passed";
  return { method: "Fresh or replayed 1x diagnostic. Each native/music pulse is identified by a unique 256-sample fit to the saved PCM16 fixture within 1e-5 absolute error, with actual residual retained; Chromium sample conversion is not bit-exact. This identity tolerance is not an audio acceptance threshold. Music/native times are fitted fixture pulse starts. Click time is its 0.0005 threshold onset (~0.5 ms attack bias). The verdict pairs actual click/music PCM within unchanged ±20 ms and preserves missing/orphan pulses. Scheduling-formula inversion is diagnostic only. Incomplete trailing pairs within 25 ms of capture end are excluded explicitly; unmatched interior pulses are failures.",
    native, music, clicks, pairs,
    nativeBeatTimes, musicBeatTimes, clickBeatTimes, start, stereo,
    status, failures, inconclusive, physicalPairs, orphanClicks,
    unresolved: inconclusive.length > 0 };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) for (const filename of process.argv.slice(2)) try {
  const capture = JSON.parse(await readFile(filename, "utf8")) as ClickAuditCapture & { requestedStartSeconds?: number };
  const fixture = await readFile(path.join(path.dirname(filename), "click-pulses.wav"))
    .catch(() => readFile(path.join(path.dirname(filename), "..", "click-pulses.wav")));
  const result = analyzeIdentifiedClicks(capture, fixture, capture.requestedStartSeconds);
  await writeFile(filename.replace(/\.json$/, "-identity.json"), JSON.stringify(result, null, 2), { flag: "wx" });
  console.log(JSON.stringify({ filename, native: result.nativeBeatTimes, music: result.musicBeatTimes, click: result.clickBeatTimes,
    status: result.status, failures: result.failures, inconclusive: result.inconclusive, pairs: result.pairs.slice(0, 4) }));
  if (result.status === "inconclusive") process.exitCode = 2;
  else if (result.status === "failed" && process.exitCode !== 2) process.exitCode = 1;
} catch (error) {
  const result = { status: "inconclusive", error: error instanceof Error ? error.message : String(error) };
  await writeFile(filename.replace(/\.json$/, "-identity-error.json"), JSON.stringify(result, null, 2), { flag: "wx" });
  console.log(JSON.stringify({ filename, ...result }));
  process.exitCode = 2;
}
