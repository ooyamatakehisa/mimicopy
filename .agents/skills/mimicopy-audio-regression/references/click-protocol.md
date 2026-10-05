# Click and music synchronization

Run this in addition to the three-source matrix. That matrix has `beats: []` and cannot establish click timing. A correct beat grid, correct click synthesis, and actual click/music alignment are separate properties. Synthetic known beats isolate playback from beat-tracking model accuracy; they do not prove that a user's analyzed grid matches that song.

## Capture current production behavior

Use the repository's Node/pnpm versions. Do not capture concurrently with another audio test, Simulator playback, heavy build, or PCM analysis. Each server snapshots the listed playback modules, instrumentation, fixture bytes and hashes into a new, empty output directory; inspect `click-server-metadata.json` for the exact scope. The pitch wrapper and installed Signalsmith module (including embedded WASM), package version and lockfile are recorded too. Other application modules still come from the workspace, so freeze application/dependency edits during recording and restart into another directory after changes. Never overwrite evidence to make a failed run disappear.

First validate the measurement tools without recording:

```sh
pnpm exec tsx e2e/clickAuditCheck.ts
pnpm exec tsx e2e/clickAuditRateCheck.ts
pnpm exec tsx e2e/audioAuditGraphCheck.ts
python3 e2e/audioAuditPcmAnalysisCheck.py
python3 e2e/audioAuditFixtureCheck.py
```

Python checks require NumPy; the fixture reader check also uses the repository's ffmpeg. These are synthetic calibration, not app validation. The music runner separately performs its unchanged 224-case calibration.

Start the isolated server in one terminal. Choose a fresh output path every time; use the identical path/port in the runner terminal:

```sh
MIMICOPY_CLICK_AUDIT_OUTPUT=/absolute/path/to/new-click-run \
MIMICOPY_CLICK_AUDIT_MIXER=1 \
pnpm exec tsx e2e/clickAuditServer.ts
```

The default port is 8201; `MIMICOPY_CLICK_AUDIT_PORT` changes it. The fixture contains unique 20 ms Hann pulses every 0.5 seconds, including time zero, and matching normal/downbeat cues. It uses production mixer generation and production playback controls. `MIMICOPY_CLICK_AUDIT_MIXER=1` supplies completed silent stems; omit it to test original-only playback with beats. Both current paths use eight-channel PCM WAV, with RF64 for payloads beyond RIFF capacity. Also run the independent three-source matrix, whose non-silent stem identities verify music routing.

```sh
MIMICOPY_CLICK_AUDIT_OUTPUT=/absolute/path/to/new-click-run \
pnpm exec tsx e2e/clickAuditDesktop.ts --once --replay

MIMICOPY_CLICK_AUDIT_OUTPUT=/absolute/path/to/new-click-run \
pnpm exec tsx e2e/clickAuditRates.ts --rates=1,0.75,0.5,0.25 --operations
```

An optional first argument `chromium` or `webkit` restricts the engine. Desktop 1x runs record fresh playback and, with `--replay`, restart through the production zero marker. Without `--once`, they repeat twice per engine. The rates runner selects a fixed rate before each capture. `--operations` covers six scenarios per rate: fresh playback, replay from zero, seek to 5.2 seconds, seek exactly to the beat at 5.0 seconds, click off/on during playback, and all music muted with clicks enabled. Both engines and all rates produce 48 recordings. This requires separated mode for the three mixer mute buttons. Inspect each raw action record and expected gating windows. These commands do not prove arbitrary mid-play rate changes, transposition or every M/S combination; use the music matrix and additional focused captures for affected behavior.

The server writes `click-server-metadata.json` and `source-snapshot/`. Desktop outputs include raw PCM, timing/identity analyses and `click-summary.json`; the rate runner writes its own raw captures, analyses and summary. Exit 0 means the recorded scope passed, 1 confirmed failures, and 2 incomplete/inconclusive coverage (which may coexist with confirmed failures). Keep expected/recorded/missing counts and review all failure arrays, not just relative lag.

Native uploads retain eight float32 streams encoded as base64. The fixture-only report endpoint has a bounded 256 MiB body limit, recorded in metadata; 50 seconds at 96 kHz needs 204.8 MB for those streams before JSON metadata. Keep this budget in sync if recording length, stream count or sample rate changes. A failed upload is missing evidence, not an audio pass. The panel displays the server's error detail; preserve the attempt and retry in a new output directory or under a new planned recording identity.

## Recheck preserved recordings

When the estimator changes, rerun its calibration and analyze the original PCM into a new subdirectory. This command refuses to overwrite an existing output directory:

```sh
pnpm exec tsx e2e/clickAuditRecheck.ts /absolute/path/to/run-one /absolute/path/to/run-two \
  --output-name=recheck-UNIQUE_ID --expected-total=EXPECTED_COUNT \
  --expected-native=ios27-UNIQUE_ID-1,ios27-ANOTHER_ID-1
```

Replace the count and native basenames with the scope actually planned. Copy native basenames from the panel's **Saved** status, including its sequence suffix (`-1` for the first capture on a page). Use the `ios27-` run prefix for the current native grouping contract, and separately record the actual runtime/model rather than inferring it from this filename. Omit `--expected-native` only for a desktop-only scope. Desktop plans preserve exact scenario names; unrelated extra recordings cannot replace missing scenarios. Historical captures without explicit plans retain the origin of reconstructed expectations, and unnamed expected cases remain missing. The first directory receives `cross-directory-summary.json`; every directory receives its own summary, per-capture analyses, raw SHA256 references, estimator source snapshots and calibration results. Keep earlier verdicts even when an estimator defect is corrected. A successful reanalysis is not a new browser capture.

## Native iOS Simulator

Desktop WebKit is not native iOS validation. Use Simulator Safari with actual UI controls, record its runtime/model from Simulator, and keep it foreground. Open a fresh unique URL:

`http://127.0.0.1:8201/tracks/click-audit?run=ios27-UNIQUE_ID&start=0`

Wait for production Play and Click to be enabled. Select the desired production rate, enable Click, tap the audit panel's **Arm**, wait for **Recording … press the app's Play now**, then tap production **Play** as a separate trusted action. The panel records for `5000 / rate + 30000` ms (35–50 seconds), with at least 45 seconds for click-toggle, then saves the raw report. This allows separate trusted UI actions and tool round trips; acceptance thresholds and minimum measured-pair counts are unchanged. Wait for **Saved** before stopping or leaving the page; the capture finishing does not itself stop music. Check whether the button currently says Play or Stop, since the fixture may have ended naturally. Reacquire screenshots/AX state before coordinates. Use a fresh unique run ID for each rate or operation so native files are not overwritten.

The `start` parameter records the intended source position independently of the observed cursor; it defaults to zero. For a marker/seek test, use the planned target such as `start=5.2`, then reach it using production controls. The panel checks a paused, completed seek within 2 ms before arming and again immediately before the trusted production Play handler, saving both observations with `requestedStartSeconds`. Seeking between Arm and Play, a missing Play gesture or repeated Play makes the capture inconclusive. The panel does not move the audio itself. Older native recordings without that field can verify alignment at the observed position, but cannot independently establish that a requested seek landed correctly.

Native Safari can remain at `HAVE_METADATA` until its first trusted Play even with `preload="auto"`. The panel therefore requires metadata, a ready audio graph, a paused/non-seeking element and the requested cursor, without requiring decoded data before that first gesture. The captured readiness and actual output PCM remain evidence; do not warm the element with unrecorded playback merely to satisfy a desktop preload assumption.

Analyze saved native captures after audio stops:

```sh
# Exact fixture fit: constant 1x only
pnpm exec tsx e2e/clickAuditIdentity.ts /absolute/path/to/native-capture.json
# All supported constant rates; requires captured raw cue streams
pnpm exec tsx e2e/clickAuditRateAnalysis.ts /absolute/path/to/native-capture.json
```

Do not use the 1x exact-fit estimator on time-stretched output. Native first Play after a seek, resume, marker return, all four rates, click enable/disable, and mixer independence need their own saved actions/PCM when changed. Simulator output proves the Web Audio graph on that runtime; it does not validate physical speakers, Bluetooth/AirPlay or human assessment of a real song's beat grid.

The native panel accepts `scenario=music-and-click` (default), `scenario=click-toggle`, and `scenario=all-music-muted`. For off/on, leave at least three beats after Play, press the real Click button off, wait at least three beats, then turn it on once. The panel records trusted actions before the production handler and after the next animation frame verifies the committed button state. It requires exactly one ordered off/on sequence during playback; missing or invalid actions retain the PCM with an explicit inconclusive operation expectation. The analyzer checks stable on/off intervals using those actual action brackets.

For all-muted, press all three enabled production Mute buttons before arming and leave Click on. The panel records the initial/final mute states, and the PCM gate separately requires music silence and click output. For both operation modes, choose a nonzero `start` when needed to separate the operation from a known first-play boundary issue. Preserve that requested position; do not exclude missing initial beats retrospectively.

A focused native plan can include all four fixed rates from zero, a cold marker start at 5.2 seconds, another start at the same marker on the same warmed page, off/on at 5.2 seconds, and all-muted at 5.2 seconds. The warm capture deliberately shares the page/run name and receives the next sequence suffix. These eight recordings are a defined scope, not coverage of every possible native interaction. Do not apply a desktop gating expectation to unrelated native PCM.

The fixture's 5.2-second marker is **Click seek target**; **Click restart target** is zero and **Click beat boundary** is 5.0 seconds. Use the actual marker-return button rather than approximating a waveform coordinate. If Simulator wheel/drag input does not scroll, Safari's Find on Page can bring the marker row into view; close Find before pressing its app button. Verify the full URL after entering it, since an incomplete run name or missing parameter changes the recorded intent.

## Measurement contract

The probe records native music, processed music and synthesized click output on one AudioWorklet sample clock. Current captures also retain both raw cue lanes. It does not replace `.play()`, write native time, or infer successful output from UI state. Preserve source and module hashes with captures.

- At 1x, identify native and processed music pulses with a unique fit to the saved fixture, then pair **actual** click/music PCM within ±20 ms. The 1e-5 identity fit tolerance is not an audio acceptance threshold. Click detection includes about 0.5 ms of envelope attack bias.
- At slowed rates, identify the distinct restored-pitch music carriers and varispeed native carriers. Compare the actual click against the processed-music origin using both energy centroid and leading edge. Include the measured cue/native-origin offset: subtracting cue-to-click delay from native-to-music delay alone would hide a common cue/click shift. The native origin is fitted from the known Hann pulse center and the actual source envelope. Both must satisfy ±20 ms; more than 10 ms disagreement between estimators is inconclusive. Merely subtracting a declared 120 ms DSP setting would not measure music output.
- Missing initial beats, interior skipped/repeated identities, orphan clicks, absent output, ambiguous identities or insufficient pairs cannot pass. Separate capture-end truncation explicitly. Preserve both relative alignment results and absolute source completeness.
- Verify both stereo outputs. Duplicated native fixture/click lanes must be exact copies. The pitch processor can introduce small numerical differences in music, so require zero-lag correlation ≥0.99999, RMS ratio within 0.1%, and each identified pulse's left/right centroid difference ≤1 ms. Also check click against the measured right-music centroid within ±20 ms. Calibrate with missing, delayed, attenuated and inverted right output, plus bounded numerical noise; do not enlarge timing tolerances to hide a failure.
- `currentTime`, `AudioContext.currentTime`, `getOutputTimestamp()` and `outputLatency` are diagnostic clocks, not proof of audible phase. A common context alone does not validate conversion from a native media clock.
- When changing the transport container or seek path, match actual source PCM against the requested location in a longer fixture, including a non-round middle position and near the end. A shared undershoot can preserve perfect click/music alignment while playing the wrong part of the song. The short pulse fixture and source-to-source lag gate alone cannot rule this out. `audioAuditEndReplay.ts` preserves native/output PCM plus trusted end/replay actions for such diagnostics; an extended native duration is evidence to investigate, not justification to lengthen a fixed wait automatically.
- Click should remain independent of music gains, mute/solo and transpose. Off must silence pending audible click tails; enabling can emit only future beats. Seek/rate/reset must discard old queued cues. Unit/worklet tests complement actual control-driven PCM captures.

The ordinary off/on recordings bracket action completion on the context clock and check the stable off/on intervals. They do not specifically time an enable between a cue's arrival and its delayed audible deadline; focused DSP/worklet tests cover that narrower contract. Do not infer sample-exact user-action timing from wall-clock sleeps.

## Historical comparisons and native diagnostics

For transport changes that affect the two-hour limit, qualify byte ranges beyond 4 GiB separately from the short click fixture:

```sh
MIMICOPY_RF64_OUTPUT=/absolute/path/to/new-rf64-run \
pnpm exec tsx e2e/audioAuditRf64.ts --prepare-only
python3 e2e/audioAuditRf64Check.py /absolute/path/to/new-rf64-run --selftest
MIMICOPY_RF64_OUTPUT=/absolute/path/to/new-rf64-run \
pnpm exec tsx e2e/audioAuditRf64.ts --reuse --desktop
```

The server remains on port 8203 for native Safari. Open `http://127.0.0.1:8203/?run=native-ios-rf64-2h`, tap **Prepare RF64**, wait for **Prepared**, then tap **Start capture** and wait for **Saved**. Stop the server after native playback finishes, and run `python3 e2e/audioAuditRf64Check.py /absolute/path/to/new-rf64-run`. `--desktop-only` deliberately reports a narrower scope. Never reuse an existing recording name to overwrite a failed capture.

This laboratory uses an actual sparse 5.53 GB RF64 file with distinct PCM in the first second and last eight seconds, a silent middle, and three final cue pulses. It warms the native element, reloads, then seeks to 7198.4 seconds. The checker requires actual HTTP ranges beyond 4 GiB, the correct duration and end state, and source PCM identity on all eight lanes. It qualifies the native container and warmed seek path; it is not a two-hour continuous playback, full React workflow, or memory-stress test. Preserve browser failures separately from gesture/preparation failures.

For an old six-channel baseline, set `MIMICOPY_CLICK_AUDIT_BASELINE_REF` to a verified commit. Separated mode additionally requires `MIMICOPY_CLICK_AUDIT_BASELINE_FIXTURE` pointing to preserved six-channel WAV evidence; do not combine old source modules with the new eight-channel container and call it a baseline. The fixture/source snapshots document which implementation was measured.

`clickNativeTransportExperiment*.ts` is a separate mechanism lab, not production regression. It compares WAV/FLAC channel fidelity and controlled pause/reload/seek order, including first-block PCM identity. Its `--mechanics` and `--start-order` modes preserve separate immutable directories; review their source and calibration before choosing an experiment. A clean padded-file experiment does not establish an app fix for arbitrary seeks. An upstream WebKit source path or bug report is a causal lead unless the installed runtime and controlled experiment establish the same defect.

The dated [click verification record](verification-2026-10-05.md) records the observed clock-offset bug and any remaining native boundary limitations. It is not a substitute for rerunning affected production scenarios.
