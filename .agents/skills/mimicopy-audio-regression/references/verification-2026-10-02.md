# Verification snapshot — 2026-10-02

The integrated repair uses a single six-channel transport, channel GainNodes,
native varispeed and common Signalsmith processing. This snapshot deliberately
separates completed desktop validation from outstanding native iOS coverage.

## Completed evidence

| Environment / check | Result | Local evidence under `audio-audit.local/` |
|---|---|---|
| Chromium WAV matrix + MP3 supplement | 852 + 105 captures, strict pass; no failures or inconclusive checks | `signalsmith-chromium-final-20261002/gate-summary.json` |
| WebKit WAV matrix + MP3 supplement | 852 + 105 captures, strict pass; no failures or inconclusive checks | `signalsmith-webkit-final-20261002/gate-summary.json` |
| Playing speed changes / cancellation | 24 captures in each of Chromium, WebKit and native iOS; all three completed and passed | `signalsmith-rate-20261002/` |
| Native rate run to use | iPhone 17 Pro, iOS 27.0 Simulator; 24 captures, no findings/errors/inconclusive checks | `signalsmith-rate-20261002/ios-rate-signalsmith-ready-20261002.json` |
| Held dynamic import | Chromium and WebKit show the initialization deadline error; released late import cannot revive playback | `signalsmith-chromium-final-20261002/metadata/init-deadline.json` |
| Post-rebase audio smoke | 2 real-audio captures and 12 keyboard checks per desktop engine; strict pass | `signalsmith-post-rebase-smoke-20261002/gate-summary.json` |
| Measurement calibration | All 224 signal/pitch/stereo/transient/varispeed cases passed | `signalsmith-ios-final-20261002/signal-calibration.json` |
| Built production client workflow | MP3 upload, waveform, transport, keyboard, speeds and markers passed; beat analysis was stubbed | `production-smoke/result.json` |

Desktop keyboard reports contain 12 native Enter/Space checks per suite. Cold
initialization, delayed media and missing media edges were inspected separately.
Real tab switching did not produce hidden visibility in either desktop engine,
so those background edges are skipped, not passed.

After integration with main's Beat This! update, `pnpm lint`, `pnpm typecheck`,
`pnpm test` (189 tests), `pnpm build`, and `pnpm e2e` (7 passed, 1 optional external
YouTube test skipped) passed. The ordinary E2E includes clicking a guitar solo
or speed button and using K to stop and resume. Space/Enter activate a focused
button; on the page they toggle playback. Inputs retain normal typing behavior.

## Provenance and scope

The Chromium matrix was reused from its completed original run
`signalsmith-complete-20261002/chromium-full-1790929433427.json`; its parent
runner was interrupted later during WebKit. Copy hashes and the reason for
reuse are recorded in `signalsmith-chromium-final-20261002/metadata/`.
The interrupted WebKit run was retained and replaced by a fresh complete run.
Native clock warmup was added to the steady-state harness after an explained
startup-onset capture; audio thresholds were not relaxed. See known-findings.

The last production hardening added a graph-owned 15-second deadline covering
module import and processor initialization, with late-completion cancellation.
It did not change the successful signal path. Chromium's supplement and the
held-import browser checks include that change; successful-path source files
were unchanged by the subsequent main integration. The post-rebase audio smoke
has its own directory, `signalsmith-post-rebase-smoke-20261002`.

The earlier `ios-rate-signalsmith-20261002.json` stopped before any capture
because its harness required pregesture media readiness. It remains a failed
setup attempt; it is not included in the 72 accepted rate recordings. The
separate `...-ready-...` run corrected that readiness assumption and completed.
Earlier failed or inconclusive repair experiments remain in their original
directories and are described in known-findings; they are not silently waived.

## Outstanding native validation

The final Signalsmith integration still needs the native iOS 852-case WAV
matrix, 105-case MP3 supplement, twelve native M/S touch toggles, a genuine
background-return measurement, and both fresh-page seek/first-Play policy
cases. The Mac locked before these final UI runs and automatic unlock failed.
The user was asked to unlock it. Keep the PR in draft until this scope is
completed and any resulting findings are investigated.

The native output directory above contains calibration only at this point.
Resume with the native instructions in protocol.md after unlocking; use fresh
unique run IDs. A previous iOS matrix under the old native pitch-preserving
implementation is diagnostic history and cannot validate Signalsmith.

There is a queried 120 ms processing delay and intentional preparation silence
during seek, resume and rate changes. Physical devices, acoustic output,
Bluetooth/AirPlay, phone interruptions, long-file memory and arbitrary-music
quality are outside this fixture-based validation.
