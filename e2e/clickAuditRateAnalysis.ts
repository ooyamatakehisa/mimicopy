import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { detectClickAuditPulses } from "./clickAuditAnalysis";
import { clickAuditBeatTimes, clickAuditHannCenterSeconds, clickAuditPulseFrequency } from "./clickAuditFixtures";
import type { ClickAuditCapture } from "./clickAuditSignal";
import { inspectClickAuditStart } from "./clickAuditStart";
import { assessClickAuditStereo } from "./clickAuditStereo";

export type ClickAuditExpectation = { kind: "music-and-click" } | { kind: "all-music-muted" } | {
  kind: "click-toggle";
  off: { beforeContextTime: number; afterContextTime: number };
  on: { beforeContextTime: number; afterContextTime: number };
};

export function analyzeRateClickAudit(capture: ClickAuditCapture, expectation: ClickAuditExpectation = { kind: "music-and-click" }, requestedStartSeconds?: number) {
  if (!["music-and-click", "all-music-muted", "click-toggle"].includes(expectation.kind)) throw new Error("Unsupported expected audio gating scope.");
  const rate = capture.clocks[0]?.rate;
  if (rate === null || rate === undefined || ![.25, .5, .75, 1].includes(rate) || capture.clocks.some((clock) => clock.rate !== rate)) {
    throw new Error("Rate analysis requires a captured constant supported playback rate.");
  }
  if (capture.protocol !== "mimicopy-click-pcm-v1" || capture.encoding !== "float32-le-base64" ||
    !Number.isSafeInteger(capture.frames) || capture.frames <= 0 || ![44_100, 48_000].includes(capture.sampleRate)) throw new Error("Unsupported or empty PCM capture.");
  const fs = capture.sampleRate;
  const decode = (value: string | undefined) => {
    if (typeof value !== "string") throw new Error("Missing PCM, including native cue channels.");
    const bytes = Buffer.from(value, "base64");
    if (bytes.length !== capture.frames * 4) throw new Error("PCM frame count is invalid.");
    const samples = new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
    if (samples.some((sample) => !Number.isFinite(sample))) throw new Error("Nonfinite PCM.");
    return samples;
  };
  const native = decode(capture.pcm.nativeLeft), music = decode(capture.pcm.musicLeft), clicks = decode(capture.pcm.clickLeft);
  const nativeRight = decode(capture.pcm.nativeRight);
  const musicRight = decode(capture.pcm.musicRight), clicksRight = decode(capture.pcm.clickRight);
  const cueStreams = [decode(capture.pcm.normalCue), decode(capture.pcm.downbeatCue)];
  const contextFrame = (time: number) => (time - capture.startContextTime) * fs;
  if (expectation.kind === "click-toggle" && (![
    expectation.off.beforeContextTime, expectation.off.afterContextTime,
    expectation.on.beforeContextTime, expectation.on.afterContextTime
  ].every(Number.isFinite) || expectation.off.beforeContextTime > expectation.off.afterContextTime ||
    expectation.off.afterContextTime >= expectation.on.beforeContextTime || expectation.on.beforeContextTime > expectation.on.afterContextTime ||
    contextFrame(expectation.off.beforeContextTime) < 0 || contextFrame(expectation.on.afterContextTime) >= capture.frames)) {
    throw new Error("Toggle action timestamps must be ordered and inside the actual PCM capture.");
  }
  // The 20 ms guard only classifies the trusted UI action boundary. It does
  // not widen the independent music/click synchronization limit below.
  const clickExpectationAt = (frame: number): "on" | "off" | "transition" => {
    if (expectation.kind !== "click-toggle") return "on";
    if (frame < contextFrame(expectation.off.beforeContextTime) - .02 * fs ||
      frame > contextFrame(expectation.on.afterContextTime) + .02 * fs) return "on";
    if (frame > contextFrame(expectation.off.afterContextTime) + .02 * fs &&
      frame < contextFrame(expectation.on.beforeContextTime) - .02 * fs) return "off";
    return "transition";
  };
  const rmsEnvelope = (samples: Float32Array) => {
    const sums = new Float64Array(samples.length + 1);
    for (let frame = 0; frame < samples.length; frame++) sums[frame + 1] = sums[frame] + samples[frame] ** 2;
    // Use the same centered window for source and output. At least two periods
    // of the lowest native carrier suppress phase-dependent envelope ripple.
    const half = Math.ceil(fs / (600 * rate));
    return Float32Array.from(samples, (_, frame) => {
      const start = Math.max(0, frame - half), end = Math.min(samples.length, frame + half + 1);
      return Math.sqrt(Math.max(0, sums[end] - sums[start]) / (end - start));
    });
  };
  const identify = (samples: Float32Array, frequencyRate: number) => {
    const envelope = rmsEnvelope(samples);
    return detectClickAuditPulses(samples, fs).map((onset) => {
      const start = Math.max(0, onset - Math.ceil(.04 * fs));
      const end = Math.min(samples.length, onset + Math.ceil((.02 / rate + .2) * fs));
      let energy = 0, weighted = 0, peak = 0;
      for (let frame = start; frame < end; frame++) {
        energy += samples[frame] ** 2; weighted += frame * samples[frame] ** 2; peak = Math.max(peak, envelope[frame]);
      }
      let leading = start;
      while (leading < end && envelope[leading] < peak * .1) leading++;
      // Narrow identity matching uses only active PCM, avoiding zero padding
      // changing coherence. The candidate is the known restored carrier grid.
      let activeStart = start, activeEnd = end;
      while (activeStart < end && envelope[activeStart] < peak * .01) activeStart++;
      while (activeEnd > activeStart && envelope[activeEnd - 1] < peak * .01) activeEnd--;
      const spectra = clickAuditBeatTimes.map((_, beatIndex) => {
        const frequency = clickAuditPulseFrequency(beatIndex) * frequencyRate;
        const coefficient = 2 * Math.cos(2 * Math.PI * frequency / fs);
        let previous = 0, beforePrevious = 0;
        for (let frame = activeStart; frame < activeEnd; frame++) {
          const next = samples[frame] + coefficient * previous - beforePrevious;
          beforePrevious = previous; previous = next;
        }
        const power = Math.max(0, previous ** 2 + beforePrevious ** 2 - coefficient * previous * beforePrevious);
        return { beatIndex, power, coherence: 2 * power / Math.max(1e-20, (activeEnd - activeStart) * energy) };
      }).sort((left, right) => right.power - left.power);
      const confidenceRatio = spectra[0].power / Math.max(1e-20, spectra[1].power);
      const confident = confidenceRatio >= 1.5 && spectra[0].coherence >= .1 && energy > 1e-8;
      return { onsetFrame: onset, centroidFrame: weighted / Math.max(energy, 1e-20), leadingFrame: leading,
        startFrame: start, endFrame: end, beatIndex: confident ? spectra[0].beatIndex : null,
        candidateBeatIndex: spectra[0].beatIndex, confidenceRatio, coherence: spectra[0].coherence,
        runnerUpBeatIndex: spectra[1].beatIndex, energy, startBoundary: start === 0, endBoundary: end === samples.length };
    });
  };
  const nativePulses = identify(native, rate), musicPulses = identify(music, 1);
  const cuePulses = cueStreams.flatMap((samples, channel) => {
    const onsets: Array<{ frame: number; channel: number }> = [];
    let armed = true;
    for (let frame = 0; frame < samples.length; frame++) {
      if (samples[frame] <= .1) armed = true;
      if (samples[frame] >= .5 && armed) { onsets.push({ frame, channel }); armed = false; }
    }
    return onsets;
  }).sort((left, right) => left.frame - right.frame);
  const clickPulses = detectClickAuditPulses(clicks, fs);
  const start = inspectClickAuditStart(capture, requestedStartSeconds);
  const failures: string[] = [...start.failures], inconclusive: string[] = [...start.inconclusive];
  const stereo = ([['native', native, nativeRight], ['music', music, musicRight], ['click', clicks, clicksRight]] as const).map(([channel, left, right]) =>
    assessClickAuditStereo(channel, left, right, fs, channel === "music" ? musicPulses.filter((pulse) => !pulse.endBoundary && pulse.beatIndex !== null) : []));
  failures.push(...stereo.flatMap((channel) => channel.failures));
  const matchedClicks = new Set<number>(), matchedMusic = new Set<number>();
  const trailingPairs: Array<{ beatIndex: number; cueFrame: number | null; reason: string }> = [];
  const cueClickPairs: Array<{ beatIndex: number; cueFrame: number; clickFrame: number; cueToClickMs: number;
    cueMinusNativeOriginMs: number; clickMinusNativeOriginMs: number }> = [];
  const gatedBeats: Array<{ beatIndex: number; cueFrame: number; expected: "off" | "transition" }> = [];
  const pairs = nativePulses.flatMap((source) => {
    if (source.beatIndex === null) return [];
    const outputCandidates = musicPulses.flatMap((pulse, index) => pulse.beatIndex === source.beatIndex ? [index] : []);
    const nearbyCues = cuePulses.filter((cue) => Math.abs(cue.frame - (source.centroidFrame - fs * clickAuditHannCenterSeconds / rate)) < .025 * fs);
    const expectedMusicCount = expectation.kind === "all-music-muted" ? 0 : 1;
    if (outputCandidates.length !== expectedMusicCount || nearbyCues.length !== 1) {
      if (!source.endBoundary) failures.push(`Native beat ${source.beatIndex / 2}s has ${outputCandidates.length} music and ${nearbyCues.length} cue matches.`);
      else trailingPairs.push({ beatIndex: source.beatIndex, cueFrame: nearbyCues[0]?.frame ?? null, reason: "Native analysis window reaches capture end; a delayed partner cannot be fully analyzed." });
      return [];
    }
    const output = expectedMusicCount ? musicPulses[outputCandidates[0]] : null, cue = nearbyCues[0];
    if (output?.endBoundary || cue.frame + fs * .122 >= capture.frames) {
      trailingPairs.push({ beatIndex: source.beatIndex, cueFrame: cue.frame, reason: output?.endBoundary
        ? "Processed-music analysis window reaches capture end." : "Expected click onset at cue+120ms falls outside the fully observed capture." });
      return [];
    }
    if (output) matchedMusic.add(outputCandidates[0]);
    const expectedClick = clickExpectationAt(cue.frame + fs * .12);
    if (expectedClick !== "on") {
      gatedBeats.push({ beatIndex: source.beatIndex, cueFrame: cue.frame, expected: expectedClick });
      return [];
    }
    const nearbyClicks = clickPulses.flatMap((frame, index) => Math.abs(frame - cue.frame - fs * .12) < .15 * fs ? [index] : []);
    if (nearbyClicks.length !== 1) { failures.push(`Beat ${source.beatIndex / 2}s has ${nearbyClicks.length} click matches.`); return []; }
    const click = clickPulses[nearbyClicks[0]]; matchedClicks.add(nearbyClicks[0]);
    const cueToClickMs = (click - cue.frame) / fs * 1000;
    const nativeOriginFrame = source.centroidFrame - fs * clickAuditHannCenterSeconds / rate;
    const cueMinusNativeOriginMs = (cue.frame - nativeOriginFrame) / fs * 1000;
    const clickMinusNativeOriginMs = (click - nativeOriginFrame) / fs * 1000;
    cueClickPairs.push({ beatIndex: source.beatIndex, cueFrame: cue.frame, clickFrame: click, cueToClickMs,
      cueMinusNativeOriginMs, clickMinusNativeOriginMs });
    if (!output) {
      if (Math.abs(cueToClickMs - 120) > 2 || Math.abs(clickMinusNativeOriginMs - 120) > 2) {
        failures.push(`Muted-music beat ${source.beatIndex / 2}s has an unexpected cue/native-to-click delay.`);
      }
      return [];
    }
    const musicCentroidDelayMs = (output.centroidFrame - source.centroidFrame) / fs * 1000;
    const musicLeadingDelayMs = (output.leadingFrame - source.leadingFrame) / fs * 1000;
    // Preserve cue/native-origin displacement. Subtracting only two delays
    // would falsely cancel a common offset of the cue and synthesized click.
    const clickMinusMusicCentroidMs = clickMinusNativeOriginMs - musicCentroidDelayMs;
    const clickMinusMusicLeadingMs = clickMinusNativeOriginMs - musicLeadingDelayMs;
    const rightCentroidLag = stereo[1].pulses.find((pulse) => pulse.beatIndex === source.beatIndex)?.centroidRightMinusLeftMs;
    const clickMinusRightMusicCentroidMs = rightCentroidLag === null || rightCentroidLag === undefined ? null : clickMinusMusicCentroidMs - rightCentroidLag;
    if (Math.abs(clickMinusMusicCentroidMs) > 20 || Math.abs(clickMinusMusicLeadingMs) > 20) failures.push(`Beat ${source.beatIndex / 2}s exceeds ±20ms using measured music centroid or leading edge.`);
    if (clickMinusRightMusicCentroidMs === null && !stereo[1].failures.length) inconclusive.push(`Beat ${source.beatIndex / 2}s has no measured right-music centroid.`);
    else if (clickMinusRightMusicCentroidMs !== null && Math.abs(clickMinusRightMusicCentroidMs) > 20) failures.push(`Beat ${source.beatIndex / 2}s exceeds ±20ms using measured right music centroid.`);
    if (Math.abs(musicCentroidDelayMs - musicLeadingDelayMs) > 10) inconclusive.push(`Beat ${source.beatIndex / 2}s has >10ms centroid/leading-edge disagreement.`);
    return [{ beatIndex: source.beatIndex, beatTime: source.beatIndex / 2, cueFrame: cue.frame, clickFrame: click,
      nativeCentroidFrame: source.centroidFrame, musicCentroidFrame: output.centroidFrame,
      cueToClickMs, cueMinusNativeOriginMs, clickMinusNativeOriginMs,
      musicCentroidDelayMs, musicLeadingDelayMs, clickMinusMusicCentroidMs, clickMinusMusicLeadingMs, clickMinusRightMusicCentroidMs }];
  });
  const initialBeat = start.firstExpectedBeatIndex;
  if (start.initialCoverageVerified && initialBeat !== null && nativePulses.length >= 6 && !nativePulses.some((pulse) => pulse.beatIndex === initialBeat)) {
    failures.push(`Fixture beat${initialBeat / 2} missing from actual native PCM after the requested/recorded start.`);
  }
  if (start.initialCoverageVerified && initialBeat !== null && nativePulses[0]?.beatIndex !== null && nativePulses[0]?.beatIndex !== undefined && nativePulses[0].beatIndex < initialBeat) {
    failures.push(`Native PCM begins with stale beat${nativePulses[0].beatIndex / 2}, before the first expected beat${initialBeat / 2}.`);
  }
  for (let index = 1; index < nativePulses.length; index++) {
    const left = nativePulses[index - 1].beatIndex, right = nativePulses[index].beatIndex;
    if (left !== null && right !== null && right !== left + 1) failures.push(`Native fixture identities skip/repeat: ${left}→${right}.`);
  }
  const unmatchedMusic = musicPulses.filter((pulse, index) => !pulse.endBoundary && !matchedMusic.has(index));
  const orphanClicks = clickPulses.filter((frame, index) => !matchedClicks.has(index) && clickExpectationAt(frame) !== "transition" &&
    !trailingPairs.some((pair) => pair.cueFrame !== null && Math.abs(frame - pair.cueFrame - .12 * fs) < .002 * fs));
  if (unmatchedMusic.length) failures.push(`${unmatchedMusic.length} interior music pulses were not paired.`);
  if (orphanClicks.length) failures.push(`${orphanClicks.length} interior clicks were not paired.`);
  if ([...nativePulses, ...musicPulses].some((pulse) => !pulse.endBoundary && pulse.beatIndex === null)) inconclusive.push("At least one fully captured carrier identity is ambiguous.");
  if ((expectation.kind === "all-music-muted" ? cueClickPairs : pairs).length < 6) inconclusive.push("Fewer than six complete expected audible pairs.");
  const maximum = (streams: Float32Array[], start: number, end: number) => {
    let peak = 0;
    for (const samples of streams) for (let frame = Math.max(0, Math.ceil(start)); frame < Math.min(samples.length, end); frame++) peak = Math.max(peak, Math.abs(samples[frame]));
    return peak;
  };
  const gating: { scope: string; maximumMusic?: number; maximumDisabledClick?: number; musicBeatsWhileClickOff?: number; clicksBefore?: number; clicksAfter?: number } = {
    scope: expectation.kind
  };
  if (expectation.kind === "all-music-muted") {
    gating.maximumMusic = maximum([music, musicRight], 0, capture.frames);
    if (gating.maximumMusic > 1e-6) failures.push("All music was expected muted but actual final music PCM is nonzero.");
  }
  if (expectation.kind === "click-toggle") {
    const offStart = contextFrame(expectation.off.afterContextTime) + .02 * fs, offEnd = contextFrame(expectation.on.beforeContextTime) - .02 * fs;
    gating.maximumDisabledClick = maximum([clicks, clicksRight], offStart, offEnd);
    gating.musicBeatsWhileClickOff = musicPulses.filter((pulse) => pulse.centroidFrame > offStart && pulse.centroidFrame < offEnd).length;
    gating.clicksBefore = cueClickPairs.filter((pair) => pair.clickFrame < contextFrame(expectation.off.beforeContextTime) - .02 * fs).length;
    gating.clicksAfter = cueClickPairs.filter((pair) => pair.clickFrame > contextFrame(expectation.on.afterContextTime) + .02 * fs).length;
    if (gating.maximumDisabledClick > 1e-6) failures.push("Click was expected disabled but actual final click PCM is nonzero.");
    if (gating.musicBeatsWhileClickOff < 2) inconclusive.push("Fewer than two actual music beats while click was expected disabled.");
    if (gating.clicksBefore < 2 || gating.clicksAfter < 2) inconclusive.push("Fewer than two complete click/music pairs before or after toggling.");
  }
  if (capture.routing.musicDestinationNodes !== 1 || capture.routing.clickDestinationNodes !== 1 || capture.routing.sourceElements !== 1) inconclusive.push("Unexpected active source/output routing.");
  return { status: inconclusive.length ? "inconclusive" : failures.length ? "failed" : "passed", rate,
    method: "Spectral identity matches known600+64*index carriers (native frequencies scaled by playbackRate, music restored pitch), requiring winner ratio≥1.5/coherence≥0.1. Actual source and processed music energy-centroid and centered-RMS10% leading-edge lags are measured independently. Actual click time relative to the native Hann origin (measured energy centroid minus959/(2*48000*playbackRate) seconds) is compared to BOTH measured music lags with unchanged±20ms limits. Minor carrier-phase energy-centroid bias is retained in calibration; this is the fixture's exact Hann center, not an arbitrary10ms correction. Measured cue/native-origin displacement is retained, not canceled. >10ms envelope-estimator disagreement is inconclusive. No assumption that declared DSP120ms equals actual music delay. Native/source completeness and orphan pulses remain failures.",
    expectation, gating, start, stereo, musicSynchronizationMeasured: expectation.kind !== "all-music-muted",
    failures, inconclusive, nativePulses, musicPulses, cuePulses, clickPulses, pairs, cueClickPairs, gatedBeats, trailingPairs, orphanClicks, unmatchedMusic };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) for (const filename of process.argv.slice(2)) try {
  const saved = JSON.parse(await readFile(filename, "utf8")) as ClickAuditCapture & { expectation?: ClickAuditExpectation; requestedStartSeconds?: number };
  const report = analyzeRateClickAudit(saved, saved.expectation, saved.requestedStartSeconds);
  await writeFile(filename.replace(/\.json$/, "-rate-analysis.json"), JSON.stringify(report, null, 2), { flag: "wx" });
  console.log(JSON.stringify({ filename, status: report.status, rate: report.rate, failures: report.failures, inconclusive: report.inconclusive,
    pairs: report.pairs.map((pair) => ({ beat: pair.beatTime, clickMinusMusicCentroidMs: pair.clickMinusMusicCentroidMs, clickMinusMusicLeadingMs: pair.clickMinusMusicLeadingMs, cueToClickMs: pair.cueToClickMs })) }));
  if (report.status === "inconclusive") process.exitCode = 2;
  else if (report.status === "failed" && process.exitCode !== 2) process.exitCode = 1;
} catch (error) {
  const report = { status: "inconclusive", error: String(error) };
  await writeFile(filename.replace(/\.json$/, "-rate-error.json"), JSON.stringify(report, null, 2), { flag: "wx" });
  console.log(JSON.stringify({ filename, ...report })); process.exitCode = 2;
}
