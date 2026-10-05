import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer, type Plugin } from "vite";
import { clickAuditBeatGrid, clickAuditDuration, createClickAuditWav } from "./clickAuditFixtures";
import { generateMixerMedia } from "../server/mixerMedia";
import { getClickCueFrames, getClickCueRevisionInput } from "../server/clickCueFormat";

const port = Number(process.env.MIMICOPY_CLICK_AUDIT_PORT ?? 8201);
const maximumReportBytes = 256 * 1024 * 1024;
const output = path.resolve(process.env.MIMICOPY_CLICK_AUDIT_OUTPUT ?? `audio-audit.local/click-${new Date().toISOString().replaceAll(":", "-")}`);
await mkdir(output, { recursive: true });
if ((await readdir(output)).length) throw new Error("Click audit output must be empty; preserve previous evidence.");
const baselineRef = process.env.MIMICOPY_CLICK_AUDIT_BASELINE_REF ?? null;
const baselineRevision = baselineRef ? execFileSync("git", ["rev-parse", "--verify", `${baselineRef}^{commit}`], { encoding: "utf8" }).trim() : null;
const media = createClickAuditWav();
await writeFile(path.join(output, "click-pulses.wav"), media);
const isMultichannel = process.env.MIMICOPY_CLICK_AUDIT_MIXER === "1";
const silence = Buffer.from(media);
silence.fill(0, 44);
let mixer: Buffer | null = null;
const mixerFormat = "wav";
let mixerOrigin = "not-used";
const cueRevision = createHash("sha256").update(getClickCueRevisionInput(clickAuditBeatGrid)).digest("hex");
if (baselineRevision && isMultichannel) {
  const baselineFixture = process.env.MIMICOPY_CLICK_AUDIT_BASELINE_FIXTURE;
  if (!baselineFixture) throw new Error("Baseline six-channel runs require MIMICOPY_CLICK_AUDIT_BASELINE_FIXTURE pointing to preserved six-channel WAV evidence.");
  mixer = await readFile(path.resolve(baselineFixture));
  if (mixer.toString("ascii", 0, 4) !== "RIFF" || mixer.readUInt16LE(22) !== 6) throw new Error("Baseline fixture must be the preserved six-channel RIFF WAV.");
  await writeFile(path.join(output, "click-mixer.wav"), mixer);
  mixerOrigin = path.resolve(baselineFixture);
} else if (!baselineRevision) {
  const silencePath = path.join(output, "click-silent-stem.wav");
  const mixerPath = path.join(output, "click-mixer.wav");
  await writeFile(silencePath, silence);
  const common = { originalPath: path.join(output, "click-pulses.wav"), outputPath: mixerPath, cues: getClickCueFrames(clickAuditBeatGrid) };
  await generateMixerMedia(isMultichannel ? { ...common, stemPath: silencePath, remainderPath: silencePath }
    : { ...common, mode: "original" });
  mixer = await readFile(mixerPath);
  mixerOrigin = "production-generateMixerMedia-eight-channel-cues";
}
const mixerContainer = mixer?.toString("ascii", 0, 4) ?? null;
if (mixer && (mixerContainer !== "RIFF" && mixerContainer !== "RF64" || mixer.toString("ascii", 8, 12) !== "WAVE")) {
  throw new Error("Generated click mixer must be RIFF/RF64 WAVE; do not label another container as WAV.");
}
const moduleNames = ["src/features/track/useClickTrack.ts", "src/features/track/usePlaybackState.ts",
  "src/features/track/useAudioPitchShift.ts", "src/features/track/TrackEditorPage.tsx", "src/features/track/PlaybackAudio.tsx",
  "src/features/track/TransportControls.tsx", "src/lib/api.ts", "src/lib/pitchProcessor.ts"];
const instrumentationNames = ["e2e/clickAuditSignal.ts", "e2e/clickAuditBrowser.ts", "e2e/clickAuditFixtures.ts", "e2e/clickAuditServer.ts"];
if (!baselineRevision) moduleNames.push("src/features/track/usePlaybackMedia.ts", "src/lib/clickCueProcessor.ts", "src/lib/clickCueProcessor.worklet.ts", "src/lib/clickCueDsp.ts",
  "server/clickCueFormat.ts", "server/clickCueMedia.ts", "server/mixerMedia.ts");
const overrides = new Map<string, string>();
const modules: { path: string; sha256: string; source: string; snapshot: string }[] = [];
for (const moduleName of moduleNames) {
  const contents = baselineRevision ? execFileSync("git", ["show", `${baselineRevision}:${moduleName}`], { encoding: "utf8" })
    : await readFile(moduleName, "utf8");
  overrides.set(path.resolve(moduleName), contents);
  const snapshot = path.join("source-snapshot", moduleName);
  await mkdir(path.dirname(path.join(output, snapshot)), { recursive: true });
  await writeFile(path.join(output, snapshot), contents);
  modules.push({ path: moduleName, sha256: createHash("sha256").update(contents).digest("hex"),
    source: baselineRevision ? `git:${baselineRevision}` : "captured-workspace", snapshot });
}
for (const moduleName of instrumentationNames) {
  const contents = await readFile(moduleName, "utf8");
  overrides.set(path.resolve(moduleName), contents);
  const snapshot = path.join("source-snapshot", moduleName);
  await mkdir(path.dirname(path.join(output, snapshot)), { recursive: true });
  await writeFile(path.join(output, snapshot), contents);
  modules.push({ path: moduleName, sha256: createHash("sha256").update(contents).digest("hex"), source: "captured-instrumentation", snapshot });
}
// Both the browser factory and its ?url AudioWorklet import execute this same
// upstream ES module, which embeds its WASM bytes. Serve the archived bytes so
// the recorded hash describes the running dependency, including baseline runs.
const stretchEntry = fileURLToPath(import.meta.resolve("signalsmith-stretch"));
const stretchPackagePath = path.join(path.dirname(stretchEntry), "package.json");
const stretchPackage: unknown = JSON.parse(await readFile(stretchPackagePath, "utf8"));
if (!stretchPackage || typeof stretchPackage !== "object" || !("name" in stretchPackage) ||
  stretchPackage.name !== "signalsmith-stretch" || !("version" in stretchPackage) || typeof stretchPackage.version !== "string") {
  throw new Error("Cannot identify the installed Signalsmith runtime package.");
}
const dependencyFiles = [
  { path: "node_modules/signalsmith-stretch/SignalsmithStretch.mjs", input: stretchEntry,
    snapshot: "source-snapshot/runtime-dependencies/signalsmith-stretch/SignalsmithStretch.mjs" },
  { path: "node_modules/signalsmith-stretch/package.json", input: stretchPackagePath,
    snapshot: "source-snapshot/runtime-dependencies/signalsmith-stretch/package.json" },
  { path: "pnpm-lock.yaml", input: path.resolve("pnpm-lock.yaml"), snapshot: "source-snapshot/pnpm-lock.yaml" }
];
for (const file of dependencyFiles) {
  const contents = await readFile(file.input);
  await mkdir(path.dirname(path.join(output, file.snapshot)), { recursive: true });
  await writeFile(path.join(output, file.snapshot), contents);
  modules.push({ path: file.path, sha256: createHash("sha256").update(contents).digest("hex"),
    source: "captured-installed-runtime", snapshot: file.snapshot });
}
const stretchSnapshot = path.join(output, dependencyFiles[0]!.snapshot);
const runtime = { node: process.version, platform: process.platform, architecture: process.arch,
  dependencies: [{ name: stretchPackage.name, version: stretchPackage.version, resolvedEntry: stretchEntry,
    executedSnapshot: dependencyFiles[0]!.snapshot, imports: ["signalsmith-stretch", "signalsmith-stretch?url"],
    format: "ES module with embedded WebAssembly", provenance: "Installed runtime, including for historical baseline source overrides; see archived package and lockfile hashes." }] };
const metadata = { protocol: "mimicopy-click-fixture-v1", startedAt: new Date().toISOString(),
  baselineRef, baselineRevision, modules, runtime, isMultichannel, mixerFormat, mixerContainer, mixerOrigin, cueRevision,
  reportLimits: { maximumBytes: maximumReportBytes, maximumMiB: maximumReportBytes / (1024 * 1024),
    scope: "Isolated fixture reports only; accommodates eight base64 float32 streams for50s at96kHz plus clocks and metadata." },
  transportFixture: mixer ? { filename: "click-mixer.wav", container: "wav", riffType: mixerContainer,
    codec: "pcm_s16le", sampleRate: 48_000, bitsPerSample: 16, channels: baselineRevision ? 6 : 8,
    generationRf64Mode: baselineRevision ? null : "auto" } : null,
  mixerSha256: mixer ? createHash("sha256").update(mixer).digest("hex") : null,
  fixture: { sha256: createHash("sha256").update(media).digest("hex"),
    beats: clickAuditBeatGrid.beats, duration: clickAuditDuration,
    description: "Unique 20ms Hann pulses at600+64*beatIndex Hz. Candidate uses production eight-channel PCM16 WAV (RIFF/RF64) with two cue channels; separated mode adds known-silent stereo stems. Baseline six-channel WAV is explicitly copied from preserved evidence. Container-specific results apply only to the recorded fixture and source snapshot." },
  revision: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim() };
await writeFile(path.join(output, "click-server-metadata.json"), JSON.stringify(metadata, null, 2));
const date = "2026-10-05T00:00:00.000Z";
const track = { id: "click-audit", title: "Click audit · known 120 BPM pulses", folderId: null,
  sourceType: "imported", duration: clickAuditDuration, mediaUrl: "/media/click-audit.wav",
  markerCount: 3, markers: [
    { id: "click-seek", label: "Click seek target", time: 5.2 },
    { id: "click-restart", label: "Click restart target", time: 0 },
    { id: "click-beat-boundary", label: "Click beat boundary", time: 5 }
  ], createdAt: date, updatedAt: date, separation: isMultichannel ? {
    createdAt: date, updatedAt: date, error: null, progress: null, status: "completed", targetStem: "guitar",
    mediaUrl: "/media/click-silent-stem.wav", remainderMediaUrl: "/media/click-silent-stem.wav"
  } : null };
const plugin: Plugin = {
  name: "click-audit-fixtures-only", enforce: "pre", configResolved(config) { config.server.proxy = {}; },
  resolveId(source, importer) {
    if (source === "signalsmith-stretch" || source === "signalsmith-stretch?url") {
      return stretchSnapshot + (source.endsWith("?url") ? "?url" : "");
    }
    if (!baselineRevision && source.startsWith("./clickCueProcessor.worklet.ts?") &&
      importer?.split("?")[0] === path.resolve("src/lib/clickCueProcessor.ts")) {
      // Keep Vite's worker bundling pipeline, with both its entry and relative
      // DSP import read from the recorded snapshot rather than mutable files.
      return path.join(output, "source-snapshot/src/lib/clickCueProcessor.worklet.ts") + source.slice(source.indexOf("?"));
    }
    return null;
  },
  load: (id) => id.includes("?worker") ? null : overrides.get(id.split("?")[0]) ?? null,
  transformIndexHtml: (html) => html.replace("<head>", '<head><script type="module" src="/e2e/clickAuditSignal.ts"></script><script type="module" src="/e2e/clickAuditBrowser.ts"></script>'),
  configureServer(server) {
    server.middlewares.use(async (request, response, next) => {
      const url = new URL(request.url ?? "/", `http://127.0.0.1:${port}`);
      const json = (body: unknown) => { response.setHeader("Content-Type", "application/json"); response.end(JSON.stringify(body)); };
      if (url.pathname === "/__click-audit/metadata") { json(metadata); return; }
      if (url.pathname === "/__click-audit/report" && request.method === "POST") {
        try {
          const chunks: Buffer[] = [];
          let size = 0;
          for await (const chunk of request) {
            const bytes = Buffer.from(chunk); size += bytes.length;
            if (size > maximumReportBytes) throw new Error(`Click capture exceeds ${maximumReportBytes / (1024 * 1024)} MiB.`);
            chunks.push(bytes);
          }
          const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as { runId?: unknown };
          if (typeof body.runId !== "string" || !body.runId) throw new Error("Click capture runId is required.");
          const runId = body.runId.replace(/[^a-zA-Z0-9_-]/g, "_");
          await writeFile(path.join(output, `${runId}.json`), JSON.stringify({ ...body, serverMetadata: metadata }), { flag: "wx" });
          console.log(JSON.stringify({ saved: runId })); json({ ok: true, runId });
        } catch (error) {
          response.statusCode = error && typeof error === "object" && "code" in error && error.code === "EEXIST" ? 409 : 400;
          json({ error: error instanceof Error ? error.message : String(error) });
        }
        return;
      }
      const audioBytes = url.pathname === "/media/click-audit.wav" ? media :
        url.pathname === "/media/click-silent-stem.wav" ? silence :
          url.pathname === `/media/click-audit-mixer.${mixerFormat}` ? mixer : null;
      if (audioBytes) {
        const range = /^bytes=(\d+)-(\d*)$/.exec(request.headers.range ?? "");
        const start = range ? Number(range[1]) : 0;
        const end = range?.[2] ? Math.min(Number(range[2]), audioBytes.length - 1) : audioBytes.length - 1;
        if (start > end || start >= audioBytes.length) { response.statusCode = 416; response.end(); return; }
        response.statusCode = range ? 206 : 200;
        response.setHeader("Content-Type", "audio/wav"); response.setHeader("Accept-Ranges", "bytes");
        response.setHeader("Content-Length", end - start + 1);
        if (range) response.setHeader("Content-Range", `bytes ${start}-${end}/${audioBytes.length}`);
        response.end(audioBytes.subarray(start, end + 1)); return;
      }
      if (url.pathname === "/api/tracks/click-audit/mixer" && mixer) { json({ mediaUrl: `/media/click-audit-mixer.${mixerFormat}`, cueRevision }); return; }
      if (url.pathname === "/api/tracks/click-audit/beat-grid") {
        json({ createdAt: date, updatedAt: date, status: "completed", error: null, beatGrid: clickAuditBeatGrid }); return;
      }
      if (url.pathname === "/api/tracks") { json({ tracks: [track] }); return; }
      if (url.pathname === "/api/folders") { json({ folders: [] }); return; }
      if (url.pathname.startsWith("/api/tracks/click-audit")) { json({ track }); return; }
      if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/media/")) {
        response.statusCode = 404; json({ error: "Click audit fixture route is unavailable." }); return;
      }
      next();
    });
  }
};
const server = await createServer({ plugins: [plugin],
  server: { host: "127.0.0.1", port, strictPort: true, proxy: {}, hmr: false, watch: null,
    fs: { allow: [process.cwd(), output] } } });
await server.listen();
console.log(`Click audit: http://127.0.0.1:${port}/tracks/click-audit`);
for (const name of ["SIGTERM", "SIGINT"] as const) process.on(name, () => { void server.close().then(() => process.exit()); });
