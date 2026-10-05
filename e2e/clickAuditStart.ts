import type { ClickAuditCapture } from "./clickAuditSignal";

/** Validate the arm-before-Play contract without treating a skipped first beat as a new ordinal. */
export function inspectClickAuditStart(capture: ClickAuditCapture, requestedStartSeconds?: number) {
  if (requestedStartSeconds !== undefined && (!Number.isFinite(requestedStartSeconds) || requestedStartSeconds < 0 || requestedStartSeconds >= 30)) {
    throw new Error("Requested fixture start must be finite and inside the 30 second fixture.");
  }
  const firstClock = capture.clocks[0];
  const observedStartSeconds = firstClock?.mediaTime;
  const failures: string[] = [], inconclusive: string[] = [];
  const cursorToleranceSeconds = .002;
  const knownPausedStart = firstClock?.paused === true && observedStartSeconds !== null && observedStartSeconds !== undefined && Number.isFinite(observedStartSeconds);
  if (!knownPausedStart) inconclusive.push("The recording does not establish a paused cursor before trusted Play; startup completeness cannot be verified.");
  const firstPlay = capture.events.find((event) => event.event === "play");
  const playAfterCaptureStart = firstPlay !== undefined && Number.isFinite(firstPlay.contextTime) && firstPlay.contextTime >= capture.startContextTime;
  if (!playAfterCaptureStart) inconclusive.push("No native play event is recorded at or after the recorder's first PCM frame; initial source coverage is inconclusive.");
  if (knownPausedStart && requestedStartSeconds !== undefined && Math.abs(observedStartSeconds - requestedStartSeconds) > cursorToleranceSeconds) {
    failures.push(`Recorded paused cursor ${observedStartSeconds}s does not match requested start ${requestedStartSeconds}s within 2ms.`);
  }
  // Explicit intent wins over clock rounding. Historical captures without
  // intent retain their observed cursor, snapping only a <=2ms grid rounding.
  const observedGridTime = knownPausedStart ? Math.round(observedStartSeconds * 2) / 2 : null;
  const expectedStartSeconds = requestedStartSeconds ?? (knownPausedStart
    ? Math.abs(observedStartSeconds - observedGridTime!) <= cursorToleranceSeconds ? observedGridTime! : observedStartSeconds
    : null);
  const firstExpectedBeatIndex = expectedStartSeconds === null ? null : Math.ceil(expectedStartSeconds * 2 - 1e-9);
  return { requestedStartSeconds: requestedStartSeconds ?? null, observedStartSeconds: observedStartSeconds ?? null,
    expectedStartSeconds, firstExpectedBeatIndex, cursorToleranceSeconds, knownPausedStart,
    initialPlayContextTime: firstPlay?.contextTime ?? null, captureStartContextTime: capture.startContextTime,
    playAfterCaptureStart, initialCoverageVerified: knownPausedStart && playAfterCaptureStart,
    origin: requestedStartSeconds === undefined ? "observed-paused-media-cursor" : "explicit-requested-start", failures, inconclusive };
}
