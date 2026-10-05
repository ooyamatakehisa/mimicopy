import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

type Capture = { codec: string; sampleRate: number; frames: number; startFrame: number;
  streams: string[]; inputChannelCounts: number[]; error?: string | null; pageErrors?: string[];
  padded?: boolean; target?: number; scenario?: string; order?: string;
  actions?: Array<{ event: string; performanceTime?: number; contextTime: number; mediaTime: number; seeking?: boolean; trusted?: boolean }> };
type Metadata = { cueTimes: number[]; cueChannels: number[]; experiment?: string; cases?: Array<{ label?: string }> };
const startOrderRequested = process.argv.includes("--start-order");
const output = path.resolve(process.env.MIMICOPY_NATIVE_TRANSPORT_OUTPUT ?? (startOrderRequested
  ? "audio-audit.local/click-native-start-order-20261005" : "audio-audit.local/click-native-eight-20261005"));
const metadata = JSON.parse(await readFile(path.join(output, "metadata.json"), "utf8")) as Metadata;
const requestedNames = process.argv.slice(2).filter((argument) => argument !== "--start-order");
const names = requestedNames.length ? requestedNames : metadata.experiment === "start-order"
  ? ["chromium", "webkit"].flatMap((engine) => (metadata.cases ?? []).flatMap(({ label }) => label ? [`${engine}-${label}`] : []))
  : ["chromium-wav-eight", "chromium-flac-eight", "webkit-wav-eight", "webkit-flac-eight"];
for (const name of names) try {
  const capture = JSON.parse(await readFile(path.join(output, `${name}.json`), "utf8")) as Capture;
  const fixture = await readFile(path.join(output, `fixture${capture.padded ? "-padded" : ""}.wav`));
  const prefixSeconds = capture.padded ? .25 : 0;
  const target = capture.target ?? 0;
  const targetFrame = Math.round(target * 48_000);
  const startOrder = capture.order === "immediate" || capture.order === "wait-seeked";
  const expected = (frame: number, channel: number) => frame < 0 || 68 + (frame * 8 + channel) * 2 + 2 > fixture.length ? 0
    : fixture.readInt16LE(68 + (frame * 8 + channel) * 2) / 32768;
  if (capture.error || capture.pageErrors?.length || capture.sampleRate !== 48_000 || capture.streams.length !== 8) throw new Error("Capture is invalid or does not have eight 48kHz streams.");
  const streams = capture.streams.map((value) => {
    const bytes = Buffer.from(value, "base64");
    if (bytes.length !== capture.frames * 4) throw new Error("PCM length differs from frame count.");
    const samples = new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
    if (samples.some((value) => !Number.isFinite(value))) throw new Error("PCM contains nonfinite values.");
    return samples;
  });
  const first = streams[0].findIndex((value) => Math.abs(value) > .0001);
  if (first < 0) throw new Error("Native channel0 has no measured output.");
  const windowStart = first + 4096, windowLength = 2048;
  if (windowStart + windowLength >= capture.frames) throw new Error("Insufficient steady PCM after native onset.");
  const matches: Array<{ fixtureFrame: number; maximumError: number }> = [];
  for (let frame = 0; frame < 4 * 48_000; frame++) {
    if ([0, 7, 31, 127, 511, 1023, 2047].some((index) => Math.abs(streams[0][windowStart + index] - expected(frame + index, 0)) > 1e-5)) continue;
    let maximumError = 0;
    for (let index = 0; index < windowLength; index++) maximumError = Math.max(maximumError, Math.abs(streams[0][windowStart + index] - expected(frame + index, 0)));
    if (maximumError <= 1e-5) matches.push({ fixtureFrame: frame, maximumError });
  }
  if (matches.length !== 1) throw new Error(`Native source timeline has ${matches.length} unique exact fixture fits.`);
  const fixtureOffset = matches[0].fixtureFrame - windowStart;
  // Infer the first actual source block independently of the later steady fit.
  // Immediate play can race a queued native seek: a good later alignment must
  // not disguise earlier PCM from zero or from the previously paused position.
  const firstAny = streams[0].findIndex((_, frame) => streams.some((samples) => Math.abs(samples[frame]) > 1e-5));
  const earlyWindowFrames = 64;
  const earlyMatches: number[] = [];
  if (firstAny >= 0 && firstAny + earlyWindowFrames <= capture.frames) {
    for (let frame = 0; frame < 4 * 48_000; frame++) {
      if ([0, 7, 31, 63].some((index) => Math.abs(streams[0][firstAny + index] - expected(frame + index, 0)) > 1e-5)) continue;
      let equal = true;
      for (let index = 0; index < earlyWindowFrames && equal; index++) {
        for (let channel = 0; channel < 8; channel++) {
          if (Math.abs(streams[channel][firstAny + index] - expected(frame + index, channel)) > 1e-5) { equal = false; break; }
        }
      }
      if (equal) earlyMatches.push(frame);
    }
  }
  const firstActualFixtureFrame = earlyMatches.length === 1 ? earlyMatches[0] : null;
  const earlyPcm = { firstMeasuredFrame: firstAny, exactWindowFrames: earlyWindowFrames,
    status: earlyMatches.length === 1 ? "unique-exact-fit" : earlyMatches.length ? "ambiguous" : "no-exact-fit",
    fixtureMatches: earlyMatches, firstActualFixtureFrame,
    firstActualFixtureMs: firstActualFixtureFrame === null ? null : firstActualFixtureFrame / 48 - prefixSeconds * 1000,
    requestedTargetFrame: targetFrame,
    targetPreserved: firstActualFixtureFrame === targetFrame,
    startedBeforeTarget: firstActualFixtureFrame === null ? null : firstActualFixtureFrame < targetFrame,
    sameOffsetAsSteady: firstActualFixtureFrame === null ? null : firstActualFixtureFrame - firstAny === fixtureOffset };
  const channels = streams.slice(0, 6).map((samples, channel) => {
    const errors = Array.from({ length: 6 }, (_, expectedChannel) => {
      let maximumError = 0;
      for (let index = 0; index < windowLength; index++) maximumError = Math.max(maximumError, Math.abs(samples[windowStart + index] - expected(matches[0].fixtureFrame + index, expectedChannel)));
      return maximumError;
    });
    return { channel, matchedChannel: errors.indexOf(Math.min(...errors)), maximumError: errors[channel], allChannelErrors: errors };
  });
  const cues = streams.slice(6).flatMap((samples, index) => {
    const channel = index + 6;
    const events: Array<{ channel: number; frame: number; widthFrames: number; expectedWidthFrames: number; peak: number; cueIndex: number | null; expectedTime: number | null; errorFrames: number | null }> = [];
    for (let frame = 0; frame < samples.length; frame++) {
      if (Math.abs(samples[frame]) < .001) continue;
      const start = frame; let peak = 0;
      while (frame < samples.length && Math.abs(samples[frame]) >= .001) { peak = Math.max(peak, samples[frame]); frame++; }
      const cueIndex = metadata.cueTimes.findIndex((_, cue) => Math.abs(peak - (2048 + cue * 128) / 32768) < 1e-5);
      const sourceCueFrame = cueIndex < 0 ? 0 : Math.round((metadata.cueTimes[cueIndex] + prefixSeconds) * 48_000);
      // An epsilon seek intentionally omits one sample from the first 48-sample
      // pulse. Validate that exact remainder; every later pulse stays 48 samples.
      const clippedFrames = startOrder && targetFrame > sourceCueFrame && targetFrame < sourceCueFrame + 48 ? targetFrame - sourceCueFrame : 0;
      const expectedWidthFrames = startOrder ? Math.max(0, Math.min(48 - clippedFrames,
        capture.frames - (sourceCueFrame + clippedFrames - fixtureOffset))) : 48;
      events.push({ channel, frame: start, widthFrames: frame - start, peak, cueIndex: cueIndex < 0 ? null : cueIndex,
        expectedWidthFrames,
        expectedTime: cueIndex < 0 ? null : metadata.cueTimes[cueIndex],
        errorFrames: cueIndex < 0 ? null : start + fixtureOffset - sourceCueFrame - clippedFrames });
    }
    return events;
  }).sort((left, right) => left.frame - right.frame);
  const expectedCues = metadata.cueTimes.flatMap((time, index) => {
    const sourceCueFrame = Math.round((time + prefixSeconds) * 48_000);
    if (startOrder && sourceCueFrame + 48 <= targetFrame) return [];
    const clippedFrames = startOrder ? Math.max(0, targetFrame - sourceCueFrame) : 0;
    const predictedFrame = sourceCueFrame + clippedFrames - fixtureOffset;
    return predictedFrame >= 0 && predictedFrame + 48 - clippedFrames < capture.frames ? [index] : [];
  });
  const missingCues = expectedCues.filter((index) => !cues.some((cue) => cue.cueIndex === index));
  const failedChannels = channels.filter((channel) => channel.matchedChannel !== channel.channel || channel.maximumError > 1e-5);
  const failedCues = cues.filter((cue) => cue.cueIndex === null || cue.channel !== metadata.cueChannels[cue.cueIndex] || cue.widthFrames !== cue.expectedWidthFrames || cue.errorFrames !== 0);
  const firstSourceFixtureMs = (first + fixtureOffset) / 48 - prefixSeconds * 1000;
  let steadyMismatchedFrames = 0, steadyMaximumError = 0;
  for (let frame = first; frame < capture.frames; frame++) {
    let maximumError = 0;
    for (let channel = 0; channel < 6; channel++) maximumError = Math.max(maximumError, Math.abs(streams[channel][frame] - expected(frame + fixtureOffset, channel)));
    steadyMaximumError = Math.max(steadyMaximumError, maximumError);
    if (maximumError > 1e-5) steadyMismatchedFrames++;
  }
  const boundaryCue = metadata.cueTimes.indexOf(target);
  const startupPreserved = startOrder ? earlyPcm.targetPreserved && earlyPcm.sameOffsetAsSteady === true
    : boundaryCue >= 0 && cues.some((cue) => cue.cueIndex === boundaryCue) && Math.abs(firstSourceFixtureMs - target * 1000) < 1;
  const seekAssigned = capture.actions?.find((action) => action.event === "seek-assigned");
  const playCalled = capture.actions?.find((action) => action.event === "capture-play-call");
  const seekedObserved = capture.actions?.find((action) => action.event === "seeked-observed");
  const trustedStart = capture.actions?.find((action) => action.event === "trusted-replay");
  const controlOrder = { order: capture.order ?? "legacy", seekAssigned, playCalled, seekedObserved, trustedStart,
    assignToPlayMs: seekAssigned?.performanceTime === undefined || playCalled?.performanceTime === undefined ? null : playCalled.performanceTime - seekAssigned.performanceTime,
    seekedBeforeTrustedStart: seekedObserved?.performanceTime === undefined || trustedStart?.performanceTime === undefined ? null : seekedObserved.performanceTime < trustedStart.performanceTime };
  const verifiedControlOrder = !startOrder || (trustedStart?.trusted === true
    && seekAssigned?.performanceTime !== undefined && playCalled?.performanceTime !== undefined && trustedStart.performanceTime !== undefined
    && playCalled.performanceTime >= seekAssigned.performanceTime && playCalled.performanceTime >= trustedStart.performanceTime
    && (capture.order === "immediate" ? seekAssigned.performanceTime >= trustedStart.performanceTime && !seekedObserved
      : controlOrder.seekedBeforeTrustedStart === true));
  const result = { name, scope: "Native media codec mechanism only; no production editor or DSP.",
    channelIdentityPreserved: !failedChannels.length,
    retainedCuePhasePreserved: !failedCues.length && cues.length >= 6,
    codecPreservesEightChannels: !failedChannels.length && !failedCues.length && !missingCues.length && cues.length >= 6,
    startupPreserved, scenario: capture.scenario ?? "fresh", target, prefixSeconds, earlyPcm, controlOrder, verifiedControlOrder,
    steadyMismatchedFrames, steadyMaximumError,
    inputChannelCounts: capture.inputChannelCounts, firstMeasuredFrame: first,
    firstSourceFixtureMs, fixtureOffset, fit: matches[0], channels, cues, missingCues, failedChannels, failedCues };
  await writeFile(path.join(output, `${name}-analysis.json`), JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ name, codecPreservesEightChannels: result.codecPreservesEightChannels,
    channelIdentityPreserved: result.channelIdentityPreserved, retainedCuePhasePreserved: result.retainedCuePhasePreserved,
    startupPreserved: result.startupPreserved, firstSourceFixtureMs, earlyPcm, controlOrder, verifiedControlOrder, firstCues: cues.slice(0, 6),
    steadyMismatchedFrames, steadyMaximumError,
    missingCues, failedChannels, failedCues }));
  if ((!result.codecPreservesEightChannels || !result.startupPreserved || !verifiedControlOrder || steadyMismatchedFrames) && process.exitCode !== 2) process.exitCode = 1;
} catch (error) {
  const result = { name, status: "inconclusive", error: String(error) };
  await writeFile(path.join(output, `${name}-analysis-error.json`), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result)); process.exitCode = 2;
}
