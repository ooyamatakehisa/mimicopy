# Investigation handoff — 2026-10-02

For the later click/metronome offset, see [verification-2026-10-05.md](verification-2026-10-05.md) and [click-protocol.md](click-protocol.md). The historical music matrix below did not contain click beats. The current transport has eight PCM WAV channels, including two cue lanes; the six-channel WAV descriptions below record earlier stages.

These findings describe the pre-fix application at revision `f05f50c4817b22d4bf97ba0a03ea0a880749bcf0`. The production source was unchanged during the initial audit. Do not treat these failures as permanent expectations or an allowlist.

Raw baseline evidence on the original workspace is `audio-audit.local/2026-10-02/`: `index.html`, `summary.json`, `verification-summary.json` and the six completed run JSONs. This directory is ignored and may not exist in another clone. The baseline is reproducible using repository scripts; missing historical evidence is not a reason to invent prior results.

## Established defects and concrete repair candidates

- **iOS volume control:** `src/features/track/PlaybackAudio.tsx` assigns effective M/S levels only to `audio.volume`. The graph in `useAudioPitchShift.ts` connects sources directly to the shared effect. On the tested iOS 27 Simulator, volume 0 read back 1 and audio remained. A separate probe's GainNode 0 produced zero RMS. Candidate: `source → individual GainNode → shared PitchShift`, apply each channel's effective gain, including initialization and restoration. GainNode muting is demonstrated; integration into the application and synchronization improvement are not. Setting `element.muted` was also ineffective in that isolated measured graph.
- **Minimum-speed correction:** `src/lib/mixer.ts` clamps a 0.245 correction back to 0.25. A source already ahead at 0.25x therefore cannot slow, and audible sources never get hard-synchronized. Candidate: a recovery path that works at the minimum supported speed, with carefully controlled silence/rescheduling if necessary. Do not assume unsupported media rates work on iOS.
- **Speed-independent drift threshold:** the 30 ms correction-start threshold measures media time. At0.25x this can allow 120 ms of output delay. A recorded 64 ms envelope lag occurred with only 17.5 ms media-clock spread. Candidate: reason about output-time error (`media drift / speed`) and verify perceptual/output thresholds across all four speeds. Lowering a threshold alone does not solve transport races.
- **Keyboard buttons:** `KeyboardShortcuts.tsx` excludes text fields but intercepts Enter/Space on M/S buttons, cancels native activation and toggles playback. Candidate: allow button Enter/Space activation before the global preventDefault path, preserving neutral-page playback shortcuts. Verify both the intended button toggle and absence of an unintended play/pause change. This app integration was not yet tested.

Primary references: [Apple's archived iOS volume documentation](https://developer.apple.com/library/archive/documentation/AudioVideo/Conceptual/Using_HTML5_Audio_Video/Device-SpecificConsiderations/Device-SpecificConsiderations.html) agrees with the actual simulator observation, but its other historical browser limitations must not be assumed current. [Web Audio GainNode specification](https://www.w3.org/TR/webaudio-1.0/#GainNode) describes signal multiplication.

## Mechanisms identified, causal attribution still incomplete

The following code paths exist; which one triggers every observed dropout requires controlled A/B changes and trace evidence:

- `usePlaybackState.togglePlayback` starts all three media elements; `PlaybackAudio` then seeks/replays auxiliaries again when `isPlaying` changes.
- RAF synchronization can issue a new seek without checking whether the follower is already seeking.
- M/S changes the selected master source. `readyState` alone can select a source whose playback clock has stopped advancing.
- An old rejected `play()` promise can unconditionally pause a newer playback attempt.

Candidate repair sequence: give one owner responsibility for transport; suppress stale async results using an operation generation; coordinate seek readiness; prevent correction during seeks; make clock ownership independent of M/S; then reassess residual drift. Apply changes separately enough to determine which failure they address. Preserve traces and replay the affected matrix/stress/edge scenarios.

A shared AudioContext already exists. Simply adding a common context is not the solution to the independent media-element transports. A larger redesign can schedule decoded buffers at the same context time and source offset, as supported by [AudioBufferSourceNode](https://www.w3.org/TR/webaudio-1.0/#AudioBufferSourceNode). It would also need pitch-preserving time stretch, buffer/node lifecycle handling, and a mobile memory plan: direct buffer playback-rate changes do not replicate `preservesPitch`. Do not undertake that redesign merely to package or run this audit.

## Baseline examples and their limits

- `ios27-full-verified.json`: all 256 matrix states completed; 249 had corroborated output mismatch. All-muted mask 21 retained audio. UI masks matched. This is an iOS Simulator observation, not a claim about every physical iPhone/version.
- `chromium-full-1790910769167.json`:64ms original/remainder waveform lag after rapid changes at 0.25x. This was ordinary playback, not the injected-drift case.
- `chromium-mp3-additional-1790911573051.json`:about 35 ms guitar/remainder lag at 0.5x, mask 40.
- `webkit-full-1790911664979.json`: a four-second stress capture had zero guitar-source samples while all sources were intended audible; about 240 ms initial estimated lag was near the estimator's search boundary and is not a global maximum claim.
- `webkit-mp3-additional-1790912240967.json`:about 189 ms original/guitar lag in high-confidence pairs.
- Desktop keyboard files each contain 12 checks with no successful M/S toggle. Native iOS supplemental evidence includes 12 touch toggles and one background-return measurement beyond the 73 automatic captures.

Raw FFT counts overstate some failures: in WebKit full, 78 output candidates reduced to 51 corroborated cases. Corroborate source taps and final mix. Some waveform pairs were low confidence or silent; they were not synchronization passes. The first exploratory runs overlapped other browser activity, so elapsed-time maxima are observations under that load. The reusable runner now runs engines and suites sequentially.

## Implemented repair

The first integrated experiment added individual gains, stable clock ownership and transport-race guards while retaining three independent media elements. Real WebKit captures still lost source-envelope correlation after repeated seeks (`audio-audit.local/2026-10-02T04-39-12-294Z`). Those changes alone were insufficient.

The resulting implementation uses one six-channel media element, with fixed original L/R, guitar L/R and remainder L/R channels. `server/mixerMedia.ts` prepares a streamed PCM16/48k WAV from the three source files. Web Audio splits it into three stereo pairs and changes their individual gains, then applies the common pitch effect. There are no follower clocks, correction rates or source-specific seeks. The initial integrated version used native `preservesPitch` for speed; the follow-up below replaces that affected path. This removes independent transport drift structurally; actual source-envelope and final-output measurements are still required to validate routing and control behavior.

Playback initialization is gated on a complete audio graph. Play and AudioContext resume start within the trusted gesture; a generation counter prevents an old rejected play promise from pausing newer playback. A late separated-media replacement preserves the editor's cursor, markers, speed, pitch and mixer settings, pauses the old element and waits for a fresh Play gesture. Gain changes do not reinitialize the pitch effect. Focused M/S buttons receive native Enter/Space activation, while neutral-page transport shortcuts remain available.

The cache is atomically generated, deduplicated and invalidated by source file metadata; track deletion removes it. Shorter stems are padded to the original duration, and mono is duplicated at unity. The tradeoff is approximately 34.6 MB per minute of cached media and 4.6 Mbps streaming; synchronized mixing currently has a two-hour limit to remain within RIFF WAV size constraints. A failed or pending mixer preparation leaves original playback available and the separated controls disabled.

Do not equate source time properties with output alignment. The v2 probe measures the three post-gain stereo paths and the final stereo mix, including six distinct carriers and nonzero transposition. Simulator validation cannot establish physical speakers, Bluetooth/AirPlay, phone interruptions or physical-device memory behavior.

## Follow-up: common timeline and gain discontinuities

The first full single-transport run (`audio-audit.local/2026-10-02T05-06-58-887Z`) passed all Chromium captures and both MP3 suites, but WebKit's WAV suite retained six stereo-band candidates in three scenarios. Relative source alignment alone missed the cause: retained post-gain PCM matched a different position in the original fixture. All active sources jumped together after pause/resume or seek. The final mix was close to the sum of those source taps, locating the principal discontinuity before the shared pitch effect.

Controlled runs under `stereo-replay-fixed/` compared unchanged playback, `preservesPitch=false`, pause-before-seek, reload-before-seek, and reload-before-seek-and-play. Disabling pitch preservation and adding a pause did not solve the late timeline jumps. Reloading before seeking fixed those seek cases but left resume jumps. Reloading the same media element before both operations eliminated late timeline jumps in that 30-capture diagnostic. These are mechanism experiments, not full regression passes or proof of a particular upstream WebKit bug.

The integrated transport primes a reload while paused, restores the desired cursor after metadata and seek readiness, and resumes only the latest Play intent. Stop cancels queued Play; source replacement and unmount invalidate old work. Preparation is visible and stoppable, has a 15-second timeout, and preserves the retry cursor on failure. Initial Play remains synchronous with the trusted gesture. Reloads retain the selected speed through `defaultPlaybackRate`. Native iOS must independently validate asynchronous resume after restoration. The tradeoff includes decoder preparation latency; this is not a promise of instantaneous seek or resume.

A second defect affected gain automation. After a completed ramp, `cancelAndHoldAtTime` alone need not insert a new anchor; a replacement ramp interpolated from an old event and started at roughly 98% gain. Explicitly anchoring the calculated gain corrected that behavior. Per-sample analysis then found occasional scheduling one 128-frame render quantum late (2.667 ms at 48 kHz), skipping part of the fade. The implementation schedules 10 ms ahead, preserves the preceding ramp until that future boundary, explicitly anchors its owned gain, and fades for 8 ms. This lookahead is a targeted mitigation for the measured delivery delay, not a guarantee against arbitrary browser stalls. Reversal captures are required as well as settled-state checks.

Use `audioAuditStereoReplay.ts` and `audioAuditPcmAnalysis.py` as described in the protocol to retain and inspect transition PCM. Do not classify a broad-band spectral candidate as harmless without this evidence; it exposed real discontinuities here.

The next WAV matrix run (`audio-audit.local/2026-10-02T06-19-21-231Z`) completed 852 captures in each desktop engine. Chromium had no raw output issues. WebKit `seek 20` captured while the reloaded element still had time 0, readyState 0 and paused=true; at the end it had just reached target 10 seconds. That silent capture is preserved as failed readiness evidence and does not prove subsequent recovery. The fixed 150+180 ms test delay was replaced by a bounded DOM/media readiness wait, with its duration and state recorded. Audio thresholds and production code were unchanged. A separate visibility scenario's initial trusted Play did occur, but Playwright exceeded its 700 ms action deadline after dispatch; initial-click allowance became 5 seconds while rapid-toggle timings remained unchanged. The run was stopped before its MP3 suites so the corrected complete matrix could be recorded in a fresh directory.

## Follow-up: native low-rate pitch preservation

The same desktop WebKit run retained low-rate broad-band candidates. Raw PCM showed exact simultaneous zeros in all six pre-effect source channels: a 56 ms hole plus an 8 ms hole at 0.25x, and a 24 ms plus one-quantum hole after seeking at 0.5x. Relative source correlation remained high. These are common audio interruptions, not demonstrated cross-talk or independent source drift; the common effect cannot explain zeros already present at its inputs.

An isolated six-channel native-media diagnostic removed React and Tone. Its 40 recordings (`audio-audit.local/native-rate-diagnostic/run-2026-10-02T06-50-56.514Z`) compared five repeats of fresh/reloaded playback, 0.5x/0.25x, and `preservesPitch` true/false. All 20 false cases had no interior gaps. With true, all five 0.25x fresh cases, all five 0.25x reload cases, and all five 0.5x reload cases had interior gaps; the five 0.5x fresh cases did not. This establishes an affected native pitch-preserving path in that desktop WebKit runtime. Fresh/reload also differed in source position, so it does not establish reload alone as the cause. Native iOS requires its own evidence.

A second diagnostic disabled native pitch preservation and tried the existing Tone PitchShift at +12/+24 semitones. Its completed recordings had continuous native input, but output was approximately 21 cents sharp at 0.5x and 31 cents sharp at 0.25x. Ten of the planned twenty recordings completed before a worklet-result timeout; that run is incomplete. The observed final-output silence was confined to startup filling. This candidate is **not a validated pitch-correct replacement** and is not integrated into production. Do not fix these values with an unvalidated empirical correction or relax the audio gate.

Host load was elevated during some diagnostics. Preserve load and runtime metadata; do not attribute every discontinuity to load. In particular, the native false controls were clean under the same diagnostic workflow. Upstream WebKit reports about rate changes or stale audio are useful leads, not proof that the locally observed defect is the identical bug.

The subsequent native iPhone 17 Pro / iOS 27.0 Simulator run (`audio-audit.local/ios-final-2026-10-02`) completed all 852 WAV and 105 MP3 captures, plus twelve native M/S touch toggles and one background-return measurement. The automatic gate found no state, missing-source, or measurable relative-lag failures, but retained nineteen spectral candidates in nine recordings; this is **not an overall pass**. PCM analysis confirmed shared six-channel gaps before the effect: 45.3–50.7 ms plus 10.7 ms holes in the full 0.25x cases, 2.7 ms at 0.75x, and shorter holes in supplementary cases. The zero-transpose final mix follows the sum of source taps closely. Thus the native iOS runtime also needs a repair for the common low-rate output interruption. Raw UI `issues: []` does not supersede the stricter spectral gate.

Native touch masks were exactly `[1,0,2,0,4,0,8,0,16,0,32,0]`, with matching output. Background-return evidence includes real hidden/visible events and another all-audible measurement; the Measure action can resume audio, so this is not a general unattended-background guarantee. Evidence and numeric PCM analysis live in that run's `metadata/` directory. Place ancillary JSON there rather than at the report root, where unknown JSON is intentionally treated as incomplete evidence.


## Follow-up: replacing native pitch preservation

The Signalsmith Stretch 1.3.2 candidate uses native `preservesPitch=false` and
compensates by `requestedSemitones - 12 * log2(playbackRate)` after summing the
three gain paths. The official MIT-licensed worklet/WASM asset is bundled
locally and configured for a 120 ms block / 30 ms interval. Native input stays
varispeed; final output is measured at the requested musical pitch.

The isolated WebKit experiment in
`audio-audit.local/native-rate-diagnostic/run-2026-10-02T07-44-09.873Z` completed
20 fresh/reloaded cases at 0.5x/0.25x. It found no interior input or final-output
gaps, a maximum 0.798-cent steady carrier error and 120 ms envelope delay. This
is candidate validation, not a replacement for the integrated app regression.
Changing the native rate while still playing caused input gaps even with
pitch preservation disabled; scheduling pitch compensation alone did not fix
that. The production transport therefore closes output, pauses, changes rate,
reloads/seeks the same element and reconfigures the processor before resuming.
A generation and both readiness checks prevent an obsolete operation from
opening output. Only the latest Play intent can reopen the gate.

The visible cursor and pause/rate-change restoration subtract the processor's
queried latency using the old native rate, clamped to the current start target.
Without this correction, flushing buffered output would skip unheard audio.
Natural end drains the remaining processor tail; explicit Stop cancels it.
Click scheduling uses native time plus the same output latency. This approach
has preparation silence and processing latency; it is not seamless live rate
switching. Gain-only M/S changes do not reload or reconfigure the processor.

Keep integrated captures separate from the isolated candidate evidence. The
fixture tests do not establish arbitrary music quality, physical-device output
or absence of all onset transients. Any new spectral candidate still needs
retained PCM analysis, without threshold relaxation.


The first integrated Signalsmith full attempt
(`audio-audit.local/signalsmith-full-fixed-20261002`) exposed an audit-start
race: the probe was connected before the application's asynchronous processor
was ready, so the audit enabled Start and clicked a disabled production Play.
The first two recordings remained paused at zero, with no Play event; later
matrix playback worked. This failed/incomplete attempt is retained. Initial
readiness now explicitly requires enabled production Play and separated mixer
controls, and the cold-module diagnostic asserts that audit Start is also
disabled while processing is unavailable. This changes harness readiness,
not audio acceptance thresholds. Error-path reviews also added immediate
transport failure when processor preparation rejects after graph cleanup, and
a server deadline that shares cancellation's SIGKILL escalation for a hung
ffmpeg process. Both have focused regression tests.


The subsequent integrated WebKit `seek 46` capture in
`audio-audit.local/signalsmith-complete-20261002` retained two broadband
candidates. Delay-aware reconstruction established that all 9,600 frames of
all six source streams exactly match consecutive fixture PCM with the expected
gains. Final output matches the fixture delayed by 5,760 frames (120 ms),
including the initial 98.667 ms of silence before the requested marker reaches
the output; maximum reconstruction error is 2.24e-8. The two flagged bands are
reproduced by that clean onset alone. This capture does not show an interior
hole, timeline jump, cross-talk or additional processor distortion. Its raw
inconclusive result remains unchanged. Evidence and the repeatable analyzer
are in that run's `metadata/seek46-delay-aware-analysis.json` and
`analyze-seek46.py`.

Native `playing`/readyState 4 had been observed at media time 10, but the source
had advanced only 21.333 ms when the steady-state capture started. Fixed wall
settling did not guarantee enough actual media progression. The follow-up
harness separately records a bounded native-clock warmup before settled
captures; it never waits for a desired PCM result. Boundary diagnostics retain
actual preparation silence and initial output. Do not classify all future
broadband candidates as startup merely because this one was explained.
