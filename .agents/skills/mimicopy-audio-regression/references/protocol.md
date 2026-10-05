# Execution and measurement protocol

## Commands

Prerequisites are the project's `package.json` Node/pnpm versions and installed Playwright Chromium/WebKit. If the binaries are missing, install them with `pnpm exec playwright install chromium webkit`. No extra audio-routing driver is needed.

```sh
pnpm audio:audit:selftest
pnpm audio:audit --quick
pnpm audio:audit --quick --engine=webkit
pnpm audio:audit
pnpm audio:audit --engine=chromium --baseline=/absolute/path/to/baseline
pnpm audio:audit:check /absolute/path/to/saved-run
```

`--port=8197` chooses the isolated server port. An occupied port is an error; do not kill unrelated processes. `--output=/absolute/path` must be empty. Default output is a new timestamp directory below `audio-audit.local`, already covered by the repository's `*.local` ignore rule. It survives `pnpm e2e` cleanup, unlike `test-results`.

The runner executes calibration and every browser/suite sequentially. Quick runs take roughly a minute; both desktop engines with full coverage take roughly 20–30 minutes depending on the machine. Do not present either duration as a deadline. The runner handles its own children and leaves logs and partial evidence on failure/interruption. It does not create an iOS run or automatically serve the final HTML.

## Coverage per environment

| Suite | Cases | Coverage |
|---|---:|---|
| WAV full | 2 | All-audible and all-muted baseline |
| WAV full | 256 | All 64 M/S states × 1x, 0.75x, 0.5x, 0.25x |
| WAV full | 384 | All directed one-button transitions, at 1x |
| WAV full | 192 | Each state paused, resumed and seeked, at 1x |
| WAV full | 12 | Long baseline, rapid 48 state assignments, forward/back seek × four speeds |
| WAV full | 4 | Production seeks between markers 100 ms apart at each speed, with measured output synchronization |
| WAV full | 2 | Natural end and replay |
| MP3 additional | 56 | All 14 states with ≥2 intended audible sources × four speeds, long recordings |
| MP3 additional | 15 | Each source solo at 0/25/50/75/100% volume |
| MP3 additional | 2 | 20 play/pause cycles with 30ms or 100ms gaps |
| MP3 additional | 32 | ±6 semitones × four speeds × all sources / each solo |
| Desktop keyboard | 12 per run | Each of 6 focused buttons using Enter and Space; playback toggles and mixer state is unchanged |
| Desktop edges | 5 | Cold graph initialization delays, delayed shared media plus rapid transport, 404 shared media, real tab visibility if supported |

WAV full = 852 captures; MP3 additional = 105. Both desktop engines = 1,914 automatic captures. Adding both native iOS suites gives 2,871. These totals exclude keyboard checks, edge observations, calibration, and manual touch. Do not call all possible operation sequences or all devices tested. The v2 audit uses synthetic WAV/MP3 inputs converted by the production six-channel mixer generator. Its supplementary suite includes nonzero transposition; arbitrary user music is not covered.

Mask bits from low to high: original mute/solo, guitar mute/solo, remainder mute/solo. Mute wins over solo; any active solo excludes non-solo sources; multiple solos are allowed. All-muted is mask 21. The 64-state matrix includes otherwise redundant silent states deliberately.

## Native iOS Simulator Safari

Use available simulator/browser tools and actual UI interaction. If no simulator can be controlled, report native iOS as untested; desktop WebKit is not a substitute.

Create an output directory and run the probe calibration, then start the isolated WAV server:

```sh
MIMICOPY_AUDIO_AUDIT_OUTPUT=/absolute/path/to/ios-run pnpm exec tsx e2e/audioAuditCalibration.ts
MIMICOPY_AUDIO_AUDIT_OUTPUT=/absolute/path/to/ios-run pnpm audio:audit:serve
```

Wait for its ready URL. Open `http://127.0.0.1:8197/tracks/audio-audit?run=ios-full-UNIQUE_ID` in Simulator Safari. The audit Start button must wait for enabled production Play and separated controls, not merely a connected probe; otherwise a click on the still-disabled Play does nothing. Tap **Start audio audit** as a trusted gesture; wait for 852 captures, `complete:true`, `suiteFinished:true`, and no run errors. Keep Safari foreground. Do not edit harness modules during a run. HMR and file watching are intentionally disabled because reloads interrupted early audits.

Stop that server, then start MP3 additional on the same port/output:

```sh
MIMICOPY_AUDIO_AUDIT_OUTPUT=/absolute/path/to/ios-run \
MIMICOPY_AUDIO_AUDIT_FORMAT=mp3 MIMICOPY_AUDIO_AUDIT_SUITE=additional \
pnpm audio:audit:serve
```

Open a new unique URL such as `...?run=ios-additional-UNIQUE_ID`, tap Start, and wait for 105 automatic captures. Then optionally validate native hit targets:

- Tap each M/S button on then off. After each tap, use **Measure current mix** and wait for the new saved sample. The expected masks are `[1,0,2,0,4,0,8,0,16,0,32,0]`.
- Confirm both the visible state and the recorded signal. Automatic `.click()` exercises React handlers but does not test native touch hit targets.
- For background testing, record the current all-audible mix, use the actual Home action, return to Safari, and measure again. Require real `visibility:hidden` and `visibility:visible` events. The Measure button can resume paused playback; this procedure does not prove unattended automatic recovery.
- Also check a fresh page where the first Play occurs after a seek, including while restoration is still pending if reproducible. No previous successful play should have unlocked the media element; record actual output and any autoplay rejection. This is a separate native policy edge case, outside the automatic suite count.
- Stop test audio with **Pause audio** after measurements. Keep manual samples separate from the 105 automatic-case count.

For the fresh-page seek/first-Play policy edge, use a separate output directory
and restart the server with `MIMICOPY_AUDIO_AUDIT_SUITE=native-policy`. Open a
new unique `?run=ios-policy-pending-...` URL and tap **Seek then immediately
Play** once. In another fresh unique URL, tap **Seek and wait**, wait for the
ready message, then tap **Play and measure**. These controls forward only to
production marker/Play buttons. They do not unlock the media element first or
write its time directly. The first case must record pending restoration before
Play; otherwise it does not establish that coverage. Each run records events,
media/context state, a five-second readiness deadline and two seconds of actual
PCM, then pauses. Inspect `findings`, `errors`, `beforePlay`, `afterPlay`, and
`cases` in both JSONs. This separate diagnostic protocol is not consumed by the
matrix gate; keep its directory separate. No earlier `play` event, successful
first Play near the requested ten-second marker, and measured output are all
required. A previous successful Play followed by a seek is not this test.

The automated report/check supports these raw iOS JSONs. Generate and inspect it:

```sh
MIMICOPY_AUDIO_AUDIT_OUTPUT=/absolute/path/to/ios-run pnpm exec tsx e2e/audioAuditReport.ts
pnpm audio:audit:check /absolute/path/to/ios-run
```

The simulator's runtime shown in Simulator is authoritative; Safari's user-agent OS version can be frozen. Record the runtime and model, as well as the raw UA. AX may expose only Safari chrome: use screenshots for page coordinates. On the original machine, AX `setValue` on the address field worked more reliably than simulated URL typing. Reacquire indices from the current UI.

## Interpretation and comparison

`audioAuditRun.ts` writes runtime, host load/memory at start/end, Git revision/dirty status, planned suites and probe hashes to `run-summary.json`. Browser version is in each raw run's UA. Compare matching engines, suites, protocol, fixtures and system load. A changed signal harness requires recalibration and a cautious comparison, not a blind acceptance of fewer failures.

`gate-summary.json` contains failures and inconclusive checks with stable case keys. With `--baseline`, it lists introduced/resolved/retained keys for suites present in both directories. Unmatched suites are not evidence of improvement. Keyboard failures are listed but not included in per-suite deltas. Keyboard reports must declare `playback-priority` and retain before/after transport evidence. Older reports are inconclusive for the current shortcut contract; mixer activation or a missing playback toggle fails. Old baselines without manifests are usable as diagnostic context; their exact runtime/load equivalence is not established. Case-key changes or a different probe may invalidate a numerical comparison. Baseline failures are never silently blessed.

The gate requires complete state/transition coverage, valid calibration, completed runs, desktop keyboard evidence, and measurable expected audible pairs in long recordings. It detects corroborated missing/unwanted output, >20 ms high-confidence source-envelope lag, wrong button states, transport/rate faults and keyboard interference. Null/low-confidence lag is inconclusive, not zero delay. Exit2 can coexist with many confirmed failures: inspect both arrays.

Transport helpers follow the visible Play/Stop intent and wait up to the application's 15-second preparation timeout for actual media playback. Steady-state marker/forward-back seek captures also wait for no preparation indicator, readyState >= 2, seek completion and the expected paused/playing state, then keep the settling interval. Pause, Play and speed changes use the same bounded readiness checks; speed changes also require the requested native/default rate. Each wait records elapsed time, completion and the media snapshot in the historical `seekPreparation` array; it never waits for a desired PCM value or retries away failed measurements. For a playing steady-state capture, readiness additionally requires at least 150 ms of native media progression (`0.15 * playbackRate` seconds of source time), bounded at 15 seconds. The `clock` metadata records actual advancement and elapsed time, followed by the existing settling delays. This exceeds the current 120 ms processing delay without assuming that a native `playing` event means the clock has already advanced. A paused capture does not require clock advancement. Boundary diagnostics separately retain the full seek silence and latency. The 30/100 ms rapid-toggle cases still require Stop to pause immediately. A Play within a decoder reload may remain visibly pending and stoppable; its count is preserved separately from failures. Final playback and measured audio are required. This tests cancellation races without inventing a 30 ms media-decoding service-level requirement. Marker and end setup use production controls; direct native `currentTime` writes bypass the application's restore lifecycle and do not validate user-facing seeking.

Source levels use RMS; a required tone <0.0005 is suspect, and a silent tone >0.00015 is suspect. A confirmed output defect needs the source tap and final frequency-band evidence to agree. FFT band-only leakage is not a confirmed unwanted source. Short 100–200ms captures test presence and clocks, not waveform synchronization. Envelope correlation has about 2.67 ms resolution at 48 kHz, a ±250ms search range and confidence requirements. Near-boundary results deserve caution.

Edges stay diagnostic in `index.html` and `edge-*.json`; `observed` is not `passed`. Inspect their expectations and observations. A visibility test is skipped if a real tab switch does not yield hidden state. Legacy v1 per-stem fault injection has no agreed recovery-time SLO and is excluded from its gate. V2 has no independent stem clock; its four shared seek captures are gated. The gate also excludes muted clock spread and media-volume-property warnings as independent audio failures; those remain useful diagnostics. Sliders currently verify state and presence, not linear loudness ratios. Background suspension, acoustic output, Bluetooth, long-file memory, broader physical-device coverage need separate tests if the change touches them.

The source probe uses actual media playback and a common AudioWorklet capture clock, after each stereo channel gain and before shared pitch processing. One native media element is reported as one transport, without synthesizing three independent clock snapshots. Final carrier levels come from the actual Web Audio mix. Neither mocks of `.play()`/`.currentTime` nor a green ordinary browser test replace this evidence. The 22-case calibration uses synthetic PCM through the same estimator and is measurement validation, not app validation. Two further known transposed-carrier cases verify ±6 semitones; three stereo calibrations verify left/right isolation at 0 and ±6 semitones. The v2 source fixtures have six distinct carriers (left 375/750/1500 Hz; right 1875/2250/2625 Hz), so every capture also checks missing sides and cross-talk.

V2 replaces separate transports with a cached PCM16/48k six-channel WAV. Native playback uses `preservesPitch=false`; a common Signalsmith Stretch worklet restores musical pitch and transposes after the three channel gains. Its queried processing delay (currently 120 ms) is reflected in the audible cursor and click-track scheduling. Rate changes, pause/resume and seeks close the final output gate while decoder and DSP preparation complete. Fixed channel order is original L/R, guitar L/R, remainder L/R. The WAV and MP3 source fixtures both pass through the production generator; the browser streams the resulting WAV. Raw source/mix taps are therefore different from v1. Recalibration and explicit protocol/hash differences are required when interpreting historical deltas.

### Investigating short stereo candidates

The stereo discriminator retains the 0.00015 RMS candidate threshold. It also examines individual FFT windows, including the trailing samples, so a brief event cannot disappear in a long average. A foreign carrier needs at least 6 dB prominence over adjacent carrier-free bands and 0.8 coherence with the carrier on the expected side. An uncorroborated candidate is inconclusive, not a confirmed routing failure or a pass. This distinction was added after short WebKit recordings energized several bands together.

Calibration now includes 93 clean, sustained/burst crossfeed, impulse, dropout, gain-step and phase-jump cases at 0/±6 semitones, in addition to the original 27. Short real crossfeed can remain unresolved; broad-band classification alone does not prove harmlessness. Suspicious captures retain final left/right and all six post-gain PCM streams as little-endian Float32 base64. Use those streams to locate the artifact and compare source versus output.

With the isolated audit server running, the following diagnostic repeats the observed transition, resume and seek sequences five times while recording continuously across the actions. Keep its output separate from matrix evidence; it is not a coverage-gate substitute:

```sh
MIMICOPY_AUDIO_AUDIT_OUTPUT=/absolute/path/to/diagnostic-output \
pnpm exec tsx e2e/audioAuditStereoReplay.ts webkit
```

This produces 30 recordings: a 1.6-second boundary capture and a short settled capture for each of three sequences, repeated five times. It preserves all eight PCM streams even when the levels stay below the candidate threshold.

Analyze the retained WAV/unity-rate PCM with Python and NumPy:

```sh
python3 e2e/audioAuditPcmAnalysis.py /absolute/path/to/stereo-replay-webkit-UNIQUE.json
```

The analysis reads `fixture-mixer-wav.wav` beside the capture (override with `--fixture`), reports the residual between the final mix and the sum of post-gain paths, and locates each active segment using an exact 1,024-frame match. It then checks every sample of that segment against consecutive fixture PCM. The default unmuted unity-gain anchor is remainder (`--anchor-channel` changes it); the default search covers the first 24 seconds (`--search-seconds` changes it). Only exactly matched timelines support per-sample stereo gain reconstruction. The report includes piecewise slopes and changes faster than an 8 ms full-scale ramp (`--gain-ramp-ms`); `--include-gain-samples` additionally saves every reconstructed value. It also reports the source timeline before/after localized edges and verifies other active channels at that position. Silence, nonunity anchors, gain ramps and missing/ambiguous matches are not proved timeline jumps. Empty or unmeasurable recordings remain unresolved and cannot pass vacuously. With the current Signalsmith graph, the final mix is processed and delayed relative to the pre-effect taps; a direct unaligned sum residual is not a defect test. Exact unity-rate source-timeline and channel-gain checks remain valid, while final-output continuity and pitch need delay-aware inspection. Its successful execution means only that analysis completed, not that playback passed. Review action timing and the raw PCM; repeated jumps after a completed seek/resume need investigation even if all three sources remain mutually aligned.

`audioAuditStereoReplay.ts` also accepts explicit mechanism-experiment flags `--disable-preserve-pitch`, `--pause-before-seek`, `--reload-before-seek`, and `--reload-before-play`. These alter the diagnostic operation sequence and are recorded in its JSON. Never present a flagged experiment as an unmodified production regression run.

Add `--gain-reversals` to record five additional production-button sequences with 0/2/4/8/16 ms nominal gaps between unmute and mute. This tests interrupted fades; derive actual gain from the retained source PCM rather than assuming that timer delays are sample-accurate. Restart the isolated server after code edits, because its disabled file watcher does not invalidate already-transformed modules.

### PCM analyzer self-check

Run `python3 e2e/audioAuditPcmAnalysisCheck.py` with NumPy available before relying on changed PCM analysis code. Its 22 deterministic checks cover exact continuity, injected timeline/gain discontinuities, fade reconstruction, ambiguous or missing matches, unsupported playback, silence, and empty CLI input. It creates only temporary synthetic fixtures and requires no browser, audio device, server, or saved local recordings. These checks validate the analyzer; production audio still requires the real-capture protocol above. Run CPU analysis after live audio capture has finished to avoid affecting measurements.


### Slowed-source envelope calibration

The `power-mean-4-v1` estimator averages four full overlapping power blocks before taking the square root. Its stride remains 128 samples (about 2.67 ms at 48 kHz); the 20 ms lag gate is unchanged. At 48 kHz, the 512-sample window spans whole carrier cycles even when a source uses native varispeed at 0.25x, 0.5x or 0.75x. Partial windows at the edges are excluded. The added 104 calibration cases cover 44.1/48 kHz, all four rates, independent carrier phases, known positive/negative offsets, silence and unrelated envelopes. The 44.1 kHz results must be measured, since the whole-cycle argument applies specifically to 48 kHz. New recordings carry the estimator marker and require this additional calibration; the original 120 calibration cases remain required, for 224 total.


### Playing speed changes and cancellation

This separate diagnostic retains 24 recordings: continuous boundaries and
settled/paused output for six adjacent playing rate changes, two rapid rate
bursts and Stop during preparation at each supported rate. Keep its output
separate from the 957-case matrix and do not feed it to the matrix checker.

```sh
MIMICOPY_AUDIO_AUDIT_OUTPUT=/absolute/path/to/rate-run \
MIMICOPY_AUDIO_AUDIT_SUITE=rate pnpm audio:audit:serve
# In another terminal; run engines sequentially:
MIMICOPY_AUDIO_AUDIT_OUTPUT=/absolute/path/to/rate-run \
pnpm exec tsx e2e/audioAuditDesktop.ts chromium --rate
MIMICOPY_AUDIO_AUDIT_OUTPUT=/absolute/path/to/rate-run \
pnpm exec tsx e2e/audioAuditDesktop.ts webkit --rate
```

For native iOS, open a fresh unique `?run=ios-rate-...` URL on that server and
tap Start. Initial Play must be enabled, but pregesture readyState is not a
prerequisite: Safari may defer loading until the trusted gesture. Actual
post-Play readiness still requires readyState >= 2 and a running audio context;
the observations also record the media clock.
Review `complete` (terminated), `suiteFinished` (all 24 captures), `passed`
(accepted), `errors`, `findings` and `inconclusive` separately. Boundaries
retain intentional reset silence rather than asserting seamless switching.
The steady checks require independent left/right carrier output, all six
post-gain side levels and all three source-pair lag measurements; paused checks
measure both final sides independently. The diagnostic saves raw boundary PCM
and failed/unresolved steady PCM. Cursor CSS observations are supplemental;
integer-only accessible cursor text cannot establish subsecond continuity.
