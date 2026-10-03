import type { AudioMeasurement } from "./audioAuditSignal";

export type AuditCase = {
  category: string; name: string; mask: number; rate: number; uiMask: number;
  expectedAudible: boolean[]; signal: AudioMeasurement; issues: string[];
};
export type AuditRun = {
  protocol?: string;
  runId: string; complete: boolean; suiteFinished: boolean;
  errors: string[]; cases: AuditCase[];
};
export type AuditFinding = { key: string; reason: string };
export type AuditGate = {
  run: string; engine: string; suite: string; captures: number;
  failures: AuditFinding[]; inconclusive: AuditFinding[];
};
const channels = ["original", "stem", "remainder"] as const;
const rates = [1, 0.75, 0.5, 0.25];
const longCategories = new Set(["calibration", "signal-sync", "long-state-sync", "rapid-play-pause", "end", "manual-touch", "shared-seek", "transpose"]);

export function auditSuite(run: AuditRun) {
  if (run.cases.some((entry) => entry.category === "state-matrix")) return "full";
  if (run.cases.some((entry) => entry.category === "long-state-sync")) return "additional";
  return "quick";
}

export function evaluateAudioAudit(run: AuditRun): AuditGate {
  const suite = auditSuite(run);
  const engine = /^(chromium|webkit|ios)/.exec(run.runId)?.[1] ?? run.runId;
  const result: AuditGate = { run: run.runId, engine, suite, captures: run.cases.length, failures: [], inconclusive: [] };
  const record = (kind: "failures" | "inconclusive", name: string, reason: string) => {
    result[kind].push({ key: `${engine}/${suite}/${name}/${reason}`, reason });
  };
  if (!run.complete || !run.suiteFinished || run.errors.length) record("inconclusive", "run", "run-not-completed-without-errors");
  const checkSet = (category: string, expected: string[], key: (entry: AuditCase) => string) => {
    const actual = run.cases.filter((entry) => entry.category === category).map(key);
    const keys = new Set(actual);
    if (actual.length !== expected.length || keys.size !== expected.length || expected.some((value) => !keys.has(value))) {
      record("inconclusive", category, "coverage-incomplete-or-duplicated");
    }
  };
  if (suite === "full") {
    checkSet("state-matrix", rates.flatMap((rate) => Array.from({ length: 64 }, (_, mask) => `${rate}:${mask}`)), (entry) => `${entry.rate}:${entry.mask}`);
    checkSet("button-transition", Array.from({ length: 64 }, (_, from) => Array.from({ length: 6 }, (_, bit) => `${from} -> ${from ^ (1 << bit)}, bit ${bit}`)).flat(), (entry) => entry.name);
    for (const category of ["paused-state", "resume-state", "seek-state"]) checkSet(category, Array.from({ length: 64 }, (_, mask) => String(mask)), (entry) => String(entry.mask));
    checkSet("signal-sync", rates.flatMap((rate) => [`baseline ${rate}x`, `after rapid 48 state assignments ${rate}x`, `after forward/back seek ${rate}x`]), (entry) => entry.name.replace("after rapid 48 toggles", "after rapid 48 state assignments"));
    if (run.protocol === "mimicopy-audio-audit-v2" || run.cases.some((entry) => entry.category === "shared-seek")) {
      checkSet("shared-seek", rates.map((rate) => `shared +100ms, after 2s at ${rate}x`), (entry) => entry.name);
    } else {
      checkSet("injected-drift", rates.map((rate) => `stem +100ms, after 2s recovery at ${rate}x`), (entry) => entry.name);
    }
    checkSet("end", ["natural end pauses all sources", "replay after natural end"], (entry) => entry.name);
    if (run.cases.length !== 852) record("inconclusive", "run", "expected-852-captures");
    for (const [category, count] of [["calibration", 2]] as const) {
      if (run.cases.filter((entry) => entry.category === category).length !== count) record("inconclusive", category, "coverage-incomplete");
    }
  } else if (suite === "additional") {
    const masks = Array.from({ length: 64 }, (_, mask) => mask).filter((mask) => {
      const solos = mask & 42;
      return channels.filter((_, index) => !(mask & (1 << (index * 2))) && (!solos || (mask & (1 << (index * 2 + 1))))).length >= 2;
    });
    checkSet("long-state-sync", rates.flatMap((rate) => masks.map((mask) => `${rate}:${mask}`)), (entry) => `${entry.rate}:${entry.mask}`);
    checkSet("volume-slider", channels.flatMap((channel) => [0, 25, 50, 75, 100].map((volume) => `${channel} solo volume ${volume}%`)), (entry) => entry.name);
    checkSet("rapid-play-pause", [30, 100].map((gap) => `20 play/pause cycles with ${gap}ms gaps`), (entry) => entry.name);
    const transposeCases = run.protocol === "mimicopy-audio-audit-v2" ? 32 : 0;
    if (transposeCases) checkSet("transpose", [-6, 6].flatMap((semitones) => rates.flatMap((rate) =>
      [0, 2, 8, 32].map((mask) => `${semitones} semitones state ${mask} at ${rate}x`))), (entry) => entry.name);
    if (run.cases.filter((entry) => entry.category !== "manual-touch").length !== 73 + transposeCases) {
      record("inconclusive", "run", `expected-${73 + transposeCases}-automatic-captures`);
    }
  } else {
    checkSet("calibration", ["all audible", "all muted"], (entry) => entry.name);
    if (run.cases.length !== 2) record("inconclusive", "run", "expected-2-smoke-captures");
  }

  for (const entry of run.cases) {
    const name = `${entry.category}/${entry.name.replace("after rapid 48 toggles", "after rapid 48 state assignments")}`;
    if (!entry.signal.valid) { record("inconclusive", name, "invalid-audio-measurement"); continue; }
    if (entry.uiMask !== entry.mask) record("failures", name, "button-state-mismatch");
    // Fault injection is diagnostic: the suite has no agreed recovery-time SLO.
    if (entry.category === "injected-drift") continue;
    channels.forEach((channel, index) => {
      const source = entry.signal.rms[channel];
      const mixed = entry.signal.mixedToneRms[channel];
      if (!Number.isFinite(source) || !Number.isFinite(mixed) || source < 0 || mixed < 0) {
        record("inconclusive", name, `${channel}-invalid-rms`); return;
      }
      if (entry.expectedAudible[index] && source < 0.0005 && mixed < 0.0005) record("failures", name, `${channel}-missing-output`);
      else if (!entry.expectedAudible[index] && source > 0.00015 && mixed > 0.00015) record("failures", name, `${channel}-unexpected-output`);
      // Spectral leakage alone is not proof that a muted source actually sounded.
      else if (entry.expectedAudible[index] && mixed < 0.0005) record("inconclusive", name, `${channel}-source-and-mix-disagree`);
      else if (!entry.expectedAudible[index] && source > 0.00015) record("inconclusive", name, `${channel}-source-and-mix-disagree`);
    });
    if (run.protocol === "mimicopy-audio-audit-v2") {
      const stereo = entry.signal.stereo;
      if (!stereo) record("inconclusive", name, "missing-stereo-output-measurement");
      else channels.forEach((channel, index) => {
        for (const side of ["left", "right"] as const) {
          const level = stereo[side][channel];
          if (!Number.isFinite(level) || level < 0) record("inconclusive", name, `${channel}-${side}-invalid-rms`);
          else if (entry.expectedAudible[index] && level < 0.0005) record("failures", name, `${channel}-${side}-missing-output`);
          else if (!entry.expectedAudible[index] && level > 0.00015 && entry.signal.rms[channel] > 0.00015) record("failures", name, `${channel}-${side}-unexpected-output`);
        }
        const cross = [stereo.rightCarriersInLeft[channel], stereo.leftCarriersInRight[channel]];
        if (cross.some((level) => !Number.isFinite(level) || level < 0)) {
          record("inconclusive", name, `${channel}-invalid-stereo-crosstalk-rms`);
        } else {
          const evidence = entry.signal.stereoEvidence;
          const candidates = evidence && [evidence.rightCarriersInLeft[channel], evidence.leftCarriersInRight[channel]];
          if (candidates?.some((item) => item.classification === "carrier-like")) {
            record("failures", name, `${channel}-stereo-crosstalk`);
          } else if (cross.some((level) => level > 0.00015) || candidates?.some((item) => item.rawCandidate || item.windowCandidate)) {
            // A short discontinuity can energize every FFT band without routing
            // a tone into the other side. Preserve it for PCM investigation;
            // neither an old raw-band candidate nor broadband noise is a pass.
            record("inconclusive", name, `${channel}-stereo-spectral-candidate`);
          }
        }
      });
    }
    for (const issue of entry.issues) {
      if (/wrong-playback-rate|unexpectedly-(paused|playing)-source|slider-value-mismatch|rapid-(pause|play)-did-not/.test(issue)) record("failures", name, issue);
    }
    if (!longCategories.has(entry.category)) continue;
    for (let first = 0; first < 3; first++) for (let second = first + 1; second < 3; second++) {
      if (!entry.expectedAudible[first] || !entry.expectedAudible[second]) continue;
      const pair = entry.signal.pairs.find((candidate) => candidate.first === channels[first] && candidate.second === channels[second]);
      const label = `${channels[first]}-${channels[second]}`;
      if (!pair || pair.confidence !== "high" || pair.lagMs === null || !Number.isFinite(pair.lagMs)) record("inconclusive", name, `${label}-signal-lag-unmeasurable`);
      else if (Math.abs(pair.lagMs) > 20) record("failures", name, `${label}-signal-lag-over-20ms`);
    }
  }
  return result;
}

export function compareAuditFindings(current: AuditFinding[], baseline: AuditFinding[]) {
  const currentKeys = new Set(current.map((entry) => entry.key));
  const baselineKeys = new Set(baseline.map((entry) => entry.key));
  return { introduced: [...currentKeys].filter((key) => !baselineKeys.has(key)),
    resolved: [...baselineKeys].filter((key) => !currentKeys.has(key)),
    retained: [...currentKeys].filter((key) => baselineKeys.has(key)) };
}

export function evaluateAuditKeyboard(entries: unknown, engine: string) {
  const failures: AuditFinding[] = [];
  const inconclusive: AuditFinding[] = [];
  const record = (kind: AuditFinding[], key: string, reason: string) => kind.push({ key: `${engine}/keyboard/${key}/${reason}`, reason });
  if (!Array.isArray(entries)) {
    record(inconclusive, "report", "keyboard-report-malformed");
    return { failures, inconclusive };
  }
  const actual = new Set<string>();
  for (const value of entries as unknown[]) {
    if (typeof value !== "object" || value === null) { record(inconclusive, "report", "keyboard-report-malformed"); continue; }
    const entry = value as Record<string, unknown>;
    const key = `${entry.label}/${entry.action}/${entry.key}`;
    actual.add(key);
    if (typeof entry.toggled !== "boolean") record(inconclusive, key, "keyboard-activation-unmeasured");
    else if (!entry.toggled) record(failures, key, "keyboard-button-not-activated");
    if (typeof entry.unexpectedPlaybackChange !== "boolean" || typeof entry.playingBefore !== "boolean" || typeof entry.playing !== "boolean") record(inconclusive, key, "keyboard-transport-change-unmeasured");
    else if (entry.unexpectedPlaybackChange || entry.playingBefore !== entry.playing) record(failures, key, "keyboard-button-changed-playback");
  }
  const expected = ["原音", "ギター", "ギター以外"].flatMap((label) => ["ミュート", "ソロ"].flatMap((action) => ["Enter", "Space"].map((key) => `${label}/${action}/${key}`)));
  if (entries.length !== 12 || actual.size !== 12 || expected.some((key) => !actual.has(key))) record(inconclusive, "report", "keyboard-coverage-incomplete");
  return { failures, inconclusive };
}
