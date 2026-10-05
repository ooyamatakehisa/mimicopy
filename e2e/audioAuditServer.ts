import { mkdir, readFile, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import ffmpeg from "ffmpeg-static";
import path from "node:path";
import { createServer, type Plugin } from "vite";
import { generateMixerMedia } from "../server/mixerMedia";
import { getClickCueRevisionInput } from "../server/clickCueFormat";
import { createStereoAudioAuditWav } from "./audioAuditFixtures";

// Isolated fixture API: never opens the user's library or runs separation tools.
const port = Number(process.env.MIMICOPY_AUDIO_AUDIT_PORT ?? 8197);
const outputDirectory = path.resolve(
  process.env.MIMICOPY_AUDIO_AUDIT_OUTPUT ?? "audio-audit.local/manual"
);
const date = "2026-10-02T00:00:00.000Z";
const duration = 240;
const format = process.env.MIMICOPY_AUDIO_AUDIT_FORMAT === "mp3" ? "mp3" : "wav";
const browserModule = process.env.MIMICOPY_AUDIO_AUDIT_SUITE === "native-policy"
  ? "audioAuditNativePolicy"
  : process.env.MIMICOPY_AUDIO_AUDIT_SUITE === "rate" ? "audioAuditRateBrowser"
    : process.env.MIMICOPY_AUDIO_AUDIT_SUITE === "additional" ? "audioAuditAdditionalBrowser" : "audioAuditBrowser";
await mkdir(outputDirectory, { recursive: true });
const media: Buffer[] = [];
for (const index of [0, 1, 2]) {
  const wav = createStereoAudioAuditWav(index, duration);
  if (format === "wav") {
    media.push(wav);
    await writeFile(path.join(outputDirectory, `fixture-${index}.wav`), wav);
    continue;
  }
  if (!ffmpeg) throw new Error("FFmpeg unavailable for MP3 fixture encoding");
  const filename = path.join(outputDirectory, `fixture-${index}.mp3`);
  execFileSync(ffmpeg, ["-hide_banner", "-loglevel", "error", "-y", "-f", "wav", "-i", "pipe:0", "-codec:a", "libmp3lame", "-b:a", "128k", filename], { input: wav });
  media.push(await readFile(filename));
}
const mixerPath = path.join(outputDirectory, `fixture-mixer-${format}.wav`);
const cueRevision = createHash("sha256").update(getClickCueRevisionInput(null)).digest("hex");
await generateMixerMedia({
  originalPath: path.join(outputDirectory, `fixture-0.${format}`),
  stemPath: path.join(outputDirectory, `fixture-1.${format}`),
  remainderPath: path.join(outputDirectory, `fixture-2.${format}`),
  outputPath: mixerPath,
  cues: []
});
const mixer = await readFile(mixerPath);
const riffType = mixer.toString("ascii", 0, 4);
if ((riffType !== "RIFF" && riffType !== "RF64") || mixer.toString("ascii", 8, 12) !== "WAVE") {
  throw new Error("Generated audio mixer must be RIFF/RF64 WAVE; do not label another container as WAV.");
}
const transportFixture = {
  filename: path.basename(mixerPath), container: "wav", riffType, codec: "pcm_s16le", generationRf64Mode: "auto", sourceFormat: format,
  sha256: createHash("sha256").update(mixer).digest("hex"),
  sampleRate: 48_000, bitsPerSample: 16, channels: 8,
  musicChannelPairs: [[0, 1], [2, 3], [4, 5]], cueChannels: [6, 7], cueCount: 0, cueRevision
};
// Root-level JSON is reserved for captured runs consumed by the strict gate.
const metadataDirectory = path.join(outputDirectory, "metadata");
await mkdir(metadataDirectory, { recursive: true });
await writeFile(path.join(metadataDirectory, `fixture-mixer-${format}-metadata.json`), JSON.stringify(transportFixture, null, 2));
const track = {
  id: "audio-audit", title: "Audio audit · three independent signals",
  folderId: null, sourceType: "imported", duration,
  mediaUrl: `/media/audio-audit-0.${format}`, markerCount: 3,
  markers: [
    { id: "audit-marker", label: "Audit seek target", time: 10 },
    { id: "audit-offset-marker", label: "Audit seek offset target", time: 10.1 },
    { id: "audit-end-marker", label: "Audit end target", time: duration - 0.6 }
  ],
  createdAt: date, updatedAt: date,
  separation: {
    createdAt: date, updatedAt: date, error: null, progress: null,
    status: "completed", targetStem: "guitar",
    mediaUrl: `/media/audio-audit-1.${format}`,
    remainderMediaUrl: `/media/audio-audit-2.${format}`
  }
};
await mkdir(outputDirectory, { recursive: true });

const auditPlugin: Plugin = {
  name: "audio-audit-only",
  configResolved(config) { config.server.proxy = {}; },
  transformIndexHtml(html) {
    return html.replace("<head>", `<head><script type="module" src="/e2e/${browserModule}.ts"></script>`);
  },
  configureServer(server) {
    server.middlewares.use(async (request, response, next) => {
      const url = new URL(request.url ?? "/", `http://127.0.0.1:${port}`);
      const json = (body: unknown) => {
        response.setHeader("Content-Type", "application/json");
        response.end(JSON.stringify(body));
      };
      try {
        if (url.pathname === "/__audio-audit/report" && request.method === "POST") {
          const chunks: Buffer[] = [];
          for await (const chunk of request) chunks.push(Buffer.from(chunk));
          const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as { runId: string; cases: unknown[]; complete: boolean };
          const runId = body.runId.replace(/[^a-zA-Z0-9_-]/g, "_");
          await writeFile(path.join(outputDirectory, `${runId}.json`), JSON.stringify({ ...body, transportFixture }, null, 2));
          console.log(JSON.stringify({ runId, cases: body.cases.length, complete: body.complete }));
          json({ ok: true });
          return;
        }
        const mediaMatch = /^\/media\/audio-audit-([012])\.(wav|mp3)$/.exec(url.pathname);
        if (mediaMatch || url.pathname === "/media/audio-audit-mixer.wav") {
          const buffer = mediaMatch ? media[Number(mediaMatch[1])] : mixer;
          if (!buffer) throw new Error("Missing audio fixture");
          const range = /^bytes=(\d+)-(\d*)$/.exec(request.headers.range ?? "");
          const start = range ? Number(range[1]) : 0;
          const end = range?.[2] ? Math.min(Number(range[2]), buffer.length - 1) : buffer.length - 1;
          response.statusCode = range ? 206 : 200;
          response.setHeader("Accept-Ranges", "bytes");
          response.setHeader("Content-Type", mediaMatch && format === "mp3" ? "audio/mpeg" : "audio/wav");
          response.setHeader("Content-Length", end - start + 1);
          if (range) response.setHeader("Content-Range", `bytes ${start}-${end}/${buffer.length}`);
          response.end(buffer.subarray(start, end + 1));
          return;
        }
        if (url.pathname.endsWith("/beat-grid")) {
          json({
            createdAt: date, updatedAt: date, error: null, status: "completed",
            beatGrid: { analyzedAt: date, source: "madmom", beats: [], downbeats: [], beatsPerBar: [4] }
          });
          return;
        }
        if (url.pathname === "/api/tracks/audio-audit/mixer") {
          json({ mediaUrl: "/media/audio-audit-mixer.wav", cueRevision });
          return;
        }
        if (url.pathname === "/api/tracks") { json({ tracks: [track] }); return; }
        if (url.pathname === "/api/folders") { json({ folders: [] }); return; }
        if (url.pathname.startsWith("/api/tracks/audio-audit")) { json({ track }); return; }
        if (url.pathname.startsWith("/api/")) { response.statusCode = 404; json({ error: "Audit fixture route unavailable" }); return; }
        if (url.pathname.startsWith("/media/")) { response.statusCode = 404; json({ error: "Audit media unavailable" }); return; }
        next();
      } catch (error) {
        response.statusCode = 500;
        json({ error: error instanceof Error ? error.message : String(error) });
      }
    });
  }
};

const server = await createServer({
  plugins: [auditPlugin],
  server: { host: "127.0.0.1", port, strictPort: true, proxy: {}, hmr: false, watch: null }
});
await server.listen();
console.log(`Audio audit: http://127.0.0.1:${port}/tracks/audio-audit`);
