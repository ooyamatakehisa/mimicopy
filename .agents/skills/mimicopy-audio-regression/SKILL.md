---
name: mimicopy-audio-regression
description: Re-run Mimicopy's real-audio regression audit for three-source synchronization, solo/mute, volume, transport, or playback keyboard changes. Use for reproducing playback bugs and comparing fixes in this repository, including native iOS Simulator Safari. Desktop WebKit alone does not validate iOS.
---

# Mimicopy audio regression

Use the repository's production playback components with generated, distinguishable audio signals. Measure the audio output as well as the controls. Preserve the distinction between a completed run, a failed check, and an inconclusive measurement.

## Run the appropriate scope

Find the Mimicopy repository containing `e2e/audioAuditRun.ts` and run commands from its root. This skill is versioned in `.agents/skills/mimicopy-audio-regression`; personal installations can link to it. Use the Node and pnpm versions specified by the repository.

- Harness or short smoke check: `pnpm audio:audit --quick`.
- Comprehensive desktop regression: `pnpm audio:audit` (Chromium and WebKit, WAV matrix, MP3 long captures, transposition, keyboard and diagnostic edge scenarios).
- Compare with existing evidence: append `--baseline=/absolute/path/to/previous-output`. Comparison is informational; existing failures are not waived.
- Check already-recorded evidence: `pnpm audio:audit:check /absolute/path/to/output`.
- An iOS or mobile fix also requires native Simulator Safari using [protocol.md](references/protocol.md). The desktop command does not launch iOS.

The runner calibrates the probe, starts isolated servers, waits for readiness, runs browsers sequentially, closes its servers, and retains reports/logs under a unique `audio-audit.local/<timestamp>/` directory. Use `--output=...` only with an empty directory. Do not run competing audio audits or heavy builds during signal capture.

Read [protocol.md](references/protocol.md) for coverage, iOS operation, output interpretation, exit codes and limitations. Read [known-findings.md](references/known-findings.md) when diagnosing the original failures or choosing a repair experiment.
The dated [verification snapshot](references/verification-2026-10-02.md) records completed evidence and outstanding native checks; it is not a substitute for a fresh run after relevant changes.

## Interpret and verify

1. Check `run-summary.json`, `gate-summary.json`, `index.html`, and the relevant raw capture JSON. Link the actual evidence when quoting measured counts or delays.
2. Exit **0** means the captured scope passed; **1** means confirmed failures; **2** means incomplete or inconclusive checks, possibly with confirmed failures too. A quick pass covers only the smoke scope. Review diagnostic edge cases separately before claiming a full regression pass.
3. Missing coverage, invalid captures, absent output, or low-confidence/null waveform lags must not become synchronization passes. Compare output delay, not just `currentTime` differences. Muted-source clock drift alone is not an audible defect.
4. Corroborate a frequency-band output anomaly with that channel's signal tap. FFT leakage alone can falsely suggest a muted channel is sounding. Preserve raw candidates alongside corroborated findings.
5. If the audio graph changes, inspect `audioAuditSignal.ts` tap placement **before trusting the gate**. The current graph has one six-channel HTML media source, a splitter and three stereo mergers/gains. The probe discovers those connections and taps after each channel gain and before the common effect. Re-run the 224-case calibration: 22 signal, two transposed-carrier, three stereo, 93 transient/crossfeed and 104 slowed-source envelope checks. Do not weaken thresholds to obtain green results. Stereo candidates retain eight PCM streams; inspect them before calling a broad-band artifact harmless or a narrow-band candidate physical cross-talk.
6. The old application already shared an AudioContext; the fix shares a single multichannel media transport. Channel gains alone do not synchronize independent transports. A cause is established only to the extent supported by the source and experiment; a proposed fix is not validated until the affected production-app scenarios pass after integration.

Keep the original evidence. Run the project's required lint, typecheck, unit tests, build and browser workflow after implementation, separately from real-audio capture. Report the tested scope, confirmed failures, inconclusive/skipped checks, and remaining validation. This skill authorizes no production deployment, library mutation, or external communication.
