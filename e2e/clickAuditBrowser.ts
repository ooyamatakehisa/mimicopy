import type { ClickAuditCapture } from "./clickAuditSignal";
import { clickAuditDuration } from "./clickAuditFixtures";
import type { ClickAuditExpectation } from "./clickAuditRateAnalysis";

// Native Safari has no Playwright driver. This fixture-only panel arms the
// recorder; the tester still presses the real production Click and Play buttons.
const panel = document.createElement("aside");
panel.id = "click-audit-panel";
panel.setAttribute("aria-label", "Click audit recorder");
const style = document.createElement("style");
style.textContent = `#click-audit-panel{position:fixed;z-index:99999;right:8px;top:8px;width:230px;
padding:8px;background:#fff;color:#111;border:2px solid #235;border-radius:8px;font:12px/1.4 sans-serif}
#click-audit-panel button{display:block;width:100%;padding:10px;font-size:14px;color:#111;background:#e3eaff;border:1px solid #235;border-radius:4px}
#click-audit-panel button:disabled{opacity:.5}#click-audit-panel p{margin:4px 0}`;
document.head.append(style);
const instruction = document.createElement("p");
instruction.textContent = "Set speed, enable Click below, arm the recorder, wait for Recording, then press the app's Play. Slower speeds record longer.";
const parameters = new URL(location.href).searchParams;
type NativeScenario = "music-and-click" | "click-toggle" | "all-music-muted";
type ActionBounds = { beforeContextTime: number; afterContextTime: number };
const scenarioParameter = parameters.get("scenario") ?? "music-and-click";
const scenario: NativeScenario | null = scenarioParameter === "music-and-click" || scenarioParameter === "click-toggle" || scenarioParameter === "all-music-muted"
  ? scenarioParameter : null;
const startParameter = parameters.get("start");
const requestedStartSeconds = startParameter === null ? 0 : Number(startParameter);
const validStart = (startParameter === null || startParameter.trim() !== "") &&
  Number.isFinite(requestedStartSeconds) && requestedStartSeconds >= 0 && requestedStartSeconds < clickAuditDuration;
const invalidStartMessage = `Invalid start: use ?start=seconds within 0 ≤ start < ${clickAuditDuration}.`;
const target = document.createElement("p");
target.textContent = validStart
  ? `Requested start: ${requestedStartSeconds}s (${startParameter === null ? "URL default" : "URL start"}). Pause and seek here before arming; tolerance 2ms.`
  : invalidStartMessage;
const scenarioInstruction = document.createElement("p");
scenarioInstruction.textContent = scenario === "click-toggle"
  ? "Scenario: click-toggle. After Play, allow at least 3 beats, press the real Click button OFF, wait at least 3 beats, then ON once. Leave playing until saved."
  : scenario === "all-music-muted"
    ? "Scenario: all-music-muted. Press all three music Mute buttons before arming; leave Click ON and music muted throughout."
    : scenario === "music-and-click" ? "Scenario: music-and-click. Leave Click ON throughout."
      : "Invalid scenario: use music-and-click, click-toggle, or all-music-muted.";
const getClickButton = () => document.querySelector<HTMLButtonElement>('button[title="クリック音をオン/オフ"]');
const readMuteControls = () => ["原音", "ギター", "ギター以外"].map((label) => {
  const control = document.querySelector<HTMLButtonElement>(`button[title="${label}をミュート"]`);
  return { label, present: Boolean(control), disabled: control?.disabled ?? true, pressed: control?.getAttribute("aria-pressed") === "true" };
});
const inspectScenario = () => {
  if (!scenario) return "Invalid native capture scenario.";
  const click = getClickButton();
  if (!click || click.disabled || click.getAttribute("aria-pressed") !== "true") return "Enable the app's Click button before arming.";
  if (scenario === "all-music-muted" && readMuteControls().some((control) => !control.present || control.disabled || !control.pressed)) {
    return "Press all three enabled music Mute buttons before arming.";
  }
  return null;
};
const inspectStart = () => {
  if (!validStart) return { error: invalidStartMessage, observed: null };
  const elements = document.querySelectorAll<HTMLAudioElement>('audio[aria-label="Original audio"]');
  const audio = elements[0];
  if (elements.length !== 1 || !audio) return { error: "Waiting for one production audio element.", observed: null };
  const observed = { mediaTime: audio.currentTime, paused: audio.paused, seeking: audio.seeking,
    readyState: audio.readyState, performanceTime: performance.now() };
  // Native Safari may hold HAVE_METADATA until its first trusted Play.
  // Requiring decoded data here would force a warm-up and erase fresh scope.
  if (!audio.paused || audio.seeking || audio.readyState < audio.HAVE_METADATA) {
    return { error: `Pause and finish the requested seek (readyState=${observed.readyState}, paused=${observed.paused}, seeking=${observed.seeking}).`, observed };
  }
  if (!Number.isFinite(audio.currentTime) || Math.abs(audio.currentTime - requestedStartSeconds) > .002) {
    return { error: `Seek to requested start ${requestedStartSeconds}s before arming (now ${audio.currentTime.toFixed(3)}s).`, observed };
  }
  return { error: null, observed };
};
const button = document.createElement("button");
button.type = "button";
button.textContent = "Arm click capture";
button.disabled = true;
const status = document.createElement("p");
status.setAttribute("role", "status");
status.textContent = "Waiting for the audio context.";
panel.append(instruction, target, scenarioInstruction, button, status);
document.body.append(panel);
let capturing = false;
let completed = false;
let sequence = 0;
// Match the report endpoint before constructing raw IDs or displaying them.
const requestedRunName = parameters.get("run") ?? "native-click";
const runName = requestedRunName.replace(/[^a-zA-Z0-9_-]/g, "_") || "native-click";
const readiness = window.setInterval(() => {
  if (capturing) return;
  const probe = window.__clickAudit?.status();
  const start = inspectStart();
  const scenarioError = inspectScenario();
  button.disabled = !probe?.ready || probe.clock?.state !== "running" || start.error !== null || scenarioError !== null;
  if (!completed) status.textContent = probe?.error ?? start.error ?? scenarioError ?? (button.disabled ? "Enable the app's Click button first." : "Ready to arm.");
}, 250);

button.addEventListener("click", () => {
  if (capturing) return;
  capturing = true;
  completed = false;
  button.disabled = true;
  const runId = `${runName}-${++sequence}`;
  const rate = window.__clickAudit.status().clock?.rate ?? 1;
  // Native UI observation/action round trips can consume 8–10 seconds before
  // Play. Keep recording from before the gesture rather than warming playback.
  const durationMs = Math.round(Math.max(5000 / rate + 30_000, scenario === "click-toggle" ? 45_000 : 0));
  const actions: Array<{ event: string; performanceTime: number; contextTime?: number; trusted?: boolean; pressed?: boolean;
    requestedStartSeconds?: number; observedStart?: ReturnType<typeof inspectStart>["observed"] }> = [
    { event: "native-arm-gesture", performanceTime: performance.now() }
  ];
  const errors: string[] = [];
  const toggleActions: { off: ActionBounds | null; on: ActionBounds | null } = { off: null, on: null };
  type VerifiedPlay = { contextTime: number; performanceTime: number; trusted: true;
    observed: NonNullable<ReturnType<typeof inspectStart>["observed"]> };
  const playAction: { attempts: number; verified: VerifiedPlay | null } = { attempts: 0, verified: null };
  let observing = false;
  let commitFrame: number | null = null;
  const observePrePlaySeek = (event: Event) => {
    if (!observing || playAction.verified || !(event.target instanceof HTMLAudioElement) ||
      event.target.getAttribute("aria-label") !== "Original audio") return;
    const clock = window.__clickAudit.status().clock;
    actions.push({ event: "seek-after-arm-before-trusted-play", performanceTime: performance.now(),
      contextTime: clock?.contextTime, requestedStartSeconds, observedStart: inspectStart().observed });
    errors.push("The native transport began seeking after arm and before the verified Play gesture.");
  };
  const observeClick = (event: MouseEvent) => {
    if (!observing || !(event.target instanceof Element)) return;
    const control = event.target.closest("button");
    if (control?.getAttribute("title") === "再生") {
      playAction.attempts++;
      const start = inspectStart();
      const clock = window.__clickAudit.status().clock;
      actions.push({ event: "production-play-gesture-before-handler", performanceTime: performance.now(),
        contextTime: clock?.contextTime, trusted: event.isTrusted, requestedStartSeconds, observedStart: start.observed });
      if (!event.isTrusted || !(control instanceof HTMLButtonElement) || control.disabled ||
        start.error !== null || !start.observed || !clock || clock.state !== "running" ||
        !Number.isFinite(clock.contextTime) || playAction.attempts !== 1) {
        errors.push(`Expected exactly one trusted Play gesture at the requested paused start: ${start.error ?? "invalid or repeated Play gesture"}.`);
      } else {
        playAction.verified = { contextTime: clock.contextTime, performanceTime: performance.now(), trusted: true,
          observed: start.observed };
      }
      return;
    }
    if (control !== getClickButton()) return;
    if (scenario !== "click-toggle") { errors.push("Click was toggled during a scenario that requires it to remain enabled."); return; }
    if (!event.isTrusted) { errors.push("Click toggle was not a trusted UI action."); return; }
    if (commitFrame !== null || toggleActions.on) { errors.push("Expected exactly one settled OFF then ON action."); return; }
    const clock = window.__clickAudit.status().clock;
    const expectedBefore = toggleActions.off === null;
    if (!(control instanceof HTMLButtonElement) || control.disabled ||
      control.getAttribute("aria-pressed") !== String(expectedBefore) || !clock ||
      clock.paused !== false || clock.state !== "running" || !Number.isFinite(clock.contextTime)) {
      errors.push("Click toggle did not start from the required state during actual playback."); return;
    }
    const eventName = expectedBefore ? "click-off" : "click-on";
    const beforeContextTime = clock.contextTime;
    actions.push({ event: `trusted-${eventName}-before`, performanceTime: performance.now(),
      contextTime: beforeContextTime, trusted: true, pressed: expectedBefore });
    commitFrame = requestAnimationFrame(() => {
      commitFrame = null;
      if (!observing) return;
      const after = window.__clickAudit.status().clock;
      const pressed = control.getAttribute("aria-pressed") === "true";
      if (getClickButton() !== control || control.getAttribute("aria-pressed") !== String(!expectedBefore) || !after ||
        after.paused !== false || after.state !== "running" || !Number.isFinite(after.contextTime) || after.contextTime < beforeContextTime) {
        errors.push("Click toggle did not commit the expected DOM state on the next animation frame."); return;
      }
      const bounds = { beforeContextTime, afterContextTime: after.contextTime };
      if (expectedBefore) toggleActions.off = bounds;
      else toggleActions.on = bounds;
      actions.push({ event: `trusted-${eventName}-after-dom-commit`, performanceTime: performance.now(),
        contextTime: after.contextTime, trusted: true, pressed });
      status.textContent = expectedBefore ? "Recording: Click OFF observed. Wait at least 3 beats, then press Click ON once."
        : "Recording: OFF/ON observed. Leave playing until saved.";
    });
  };
  void (async () => {
    try {
      // Check immediately before sending the worklet's arm command. The URL
      // expresses intent independently of the observed HTML media clock.
      const start = inspectStart();
      if (start.error !== null || !start.observed) throw new Error(start.error ?? "Requested start could not be verified.");
      const scenarioError = inspectScenario();
      if (scenarioError !== null || !scenario) throw new Error(scenarioError ?? "Invalid native scenario.");
      const mutesBeforeArm = readMuteControls();
      await window.__clickAudit.arm(durationMs);
      observing = true;
      document.addEventListener("click", observeClick, true);
      document.addEventListener("seeking", observePrePlaySeek, true);
      actions.push({ event: "armed", performanceTime: performance.now() });
      status.textContent = `Recording ${Math.ceil(durationMs / 1000)} seconds: press the app's Play now.`;
      const capture: ClickAuditCapture = await window.__clickAudit.result();
      observing = false;
      document.removeEventListener("click", observeClick, true);
      document.removeEventListener("seeking", observePrePlaySeek, true);
      if (commitFrame !== null) {
        cancelAnimationFrame(commitFrame); commitFrame = null;
        errors.push("Capture ended before a click toggle DOM commit was observed.");
      }
      const captureEnd = capture.startContextTime + capture.frames / capture.sampleRate;
      if (playAction.attempts !== 1 || !playAction.verified) errors.push("Missing exactly one verified trusted production Play gesture during the capture.");
      if (playAction.verified && (playAction.verified.contextTime < capture.startContextTime ||
        playAction.verified.contextTime >= captureEnd)) errors.push("Verified Play gesture is outside the actual PCM capture.");
      const offBounds = toggleActions.off;
      const onBounds = toggleActions.on;
      if (scenario === "click-toggle" && (!offBounds || !onBounds)) errors.push("Missing required trusted OFF then ON actions inside the capture.");
      if (offBounds && onBounds && (offBounds.beforeContextTime < capture.startContextTime ||
        offBounds.afterContextTime >= onBounds.beforeContextTime || onBounds.afterContextTime >= captureEnd)) {
        errors.push("Toggle action brackets are not ordered inside the actual PCM capture.");
      }
      const mutesAfterCapture = readMuteControls();
      if (scenario === "all-music-muted" && mutesAfterCapture.some((control) => !control.present || control.disabled || !control.pressed)) {
        errors.push("All three music mute controls must remain pressed through the capture.");
      }
      let expectation: ClickAuditExpectation | { kind: "invalid-native-operation"; requestedKind: NativeScenario };
      if (errors.length || scenario === "click-toggle" && (!offBounds || !onBounds)) {
        // Unsupported expectation deliberately rejects direct analysis too;
        // never fall back to normal timing when an operation was not verified.
        expectation = { kind: "invalid-native-operation", requestedKind: scenario };
      } else if (scenario === "click-toggle" && offBounds && onBounds) {
        expectation = { kind: "click-toggle", off: offBounds, on: onBounds };
      } else expectation = { kind: scenario === "all-music-muted" ? "all-music-muted" : "music-and-click" };
      const response = await fetch("/__click-audit/report", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ runId, requestedRunName, userAgent: navigator.userAgent, ...capture, requestedStartSeconds,
          captureTiming: { requestedDurationMs: durationMs, prePlayAllowanceMs: 30_000,
            minimumMusicalSpanMs: 5000 / rate, clickToggleMinimumDurationMs: scenario === "click-toggle" ? 45_000 : null,
            reason: "Allow native UI round trips before trusted Play and off/on actions without warming playback; PCM acceptance thresholds are unchanged." },
          startIntent: { source: "url-start-parameter", supplied: startParameter !== null,
            fixtureDurationSeconds: clickAuditDuration, toleranceSeconds: .002, verifiedBeforeArm: start.observed,
            playGestureAttempts: playAction.attempts, verifiedAtTrustedPlay: playAction.verified },
          scenario, expectation, operationValidation: { status: errors.length ? "inconclusive" : "complete",
            mutesBeforeArm, mutesAfterCapture, off: offBounds, on: onBounds }, actions, errors })
      });
      if (!response.ok) {
        const detail = (await response.text()).slice(0, 1000);
        throw new Error(`Saving capture failed (${response.status}): ${detail || "No error response body."}`);
      }
      const saved: unknown = await response.json();
      if (!saved || typeof saved !== "object" || !("runId" in saved) || saved.runId !== runId) {
        throw new Error("Report endpoint did not confirm the expected saved capture ID.");
      }
      status.textContent = `Saved ${saved.runId}${errors.length ? " (inconclusive operation)" : ""}. Pause the app's audio.`;
      completed = true;
      button.textContent = "Arm another capture";
      button.disabled = false;
    } catch (error) {
      status.textContent = error instanceof Error ? error.message : String(error);
      completed = true;
      button.disabled = false;
    } finally {
      observing = false;
      document.removeEventListener("click", observeClick, true);
      document.removeEventListener("seeking", observePrePlaySeek, true);
      if (commitFrame !== null) cancelAnimationFrame(commitFrame);
      capturing = false;
    }
  })();
});
window.addEventListener("pagehide", () => window.clearInterval(readiness), { once: true });
