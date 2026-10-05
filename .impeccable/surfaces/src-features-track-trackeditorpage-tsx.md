---
version: 1
slug: "src-features-track-trackeditorpage-tsx"
primary_target: "src/features/track/TrackEditorPage.tsx"
related_targets: ["src/features/track/TransportControls.tsx"]
---

# Playback sequence

Mode: Operate. Local addition to the established audio editor. Preserve its dark surfaces, teal controls, type, waveform, mixer and responsive ordering.

## Direction contract

THESIS: Playback remains immediately accessible while practicing; a focused mixer button must not consume transport shortcuts.

OWN-WORLD: Reuse the existing track-setting grouping, native checkbox, muted explanatory text and visible focus treatment.

STORY: Open a song from a list, optionally enable automatic next-track playback, and hear the same list in its original order. The final song stops. Text editing stays usable.

FIRST VIEWPORT: Keep play/seek/marker controls first, followed by the compact automatic playback preference and its list context. Existing speed, waveform zoom, pitch and click settings remain available on desktop and stack within the mobile transport grid. A muted help line below the settings explains Space / Enter / K for playback and Alt + Enter for the focused action; it wraps on mobile.

FORM: Narrow extension of the existing surface; no concept seed or new visual identity applies. Save only the preference locally; navigation carries the captured queue.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
