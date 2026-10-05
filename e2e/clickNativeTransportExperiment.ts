import { execFile } from "node:child_process";
import { createRequire } from "node:module";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { createServer, type Plugin } from "vite";
import { chromium, webkit } from "@playwright/test";

const mechanics = process.argv.includes("--mechanics");
const startOrder = process.argv.includes("--start-order");
if (mechanics && startOrder) throw new Error("Choose either --mechanics or --start-order.");
const output = path.resolve(process.env.MIMICOPY_NATIVE_TRANSPORT_OUTPUT ?? (startOrder
  ? "audio-audit.local/click-native-start-order-20261005"
  : `audio-audit.local/click-native-${mechanics ? "mechanics" : "eight"}-${new Date().toISOString().replaceAll(":", "-")}`));
const port = Number(process.env.MIMICOPY_NATIVE_TRANSPORT_PORT ?? (startOrder ? 8202 : 8201));
await mkdir(output, { recursive: true });
if ((await readdir(output)).length) throw new Error("Use an empty experiment output directory; previous evidence is immutable.");
const sampleRate = 48_000, duration = 30, channels = 8;
type ExperimentCase = { codec: string; scenario: string; target: number; padded: boolean; order?: "immediate" | "wait-seeked"; label?: string };
const cases: ExperimentCase[] = startOrder ? [
  { codec: "flac", scenario: "fresh", target: 1 / sampleRate, padded: false, order: "immediate", label: "fresh-epsilon-immediate" },
  { codec: "flac", scenario: "fresh", target: 1 / sampleRate, padded: false, order: "wait-seeked", label: "fresh-epsilon-wait-seeked" },
  { codec: "flac", scenario: "reload", target: 1, padded: false, order: "immediate", label: "reload-target1-immediate" },
  { codec: "flac", scenario: "reload", target: 1, padded: false, order: "wait-seeked", label: "reload-target1-wait-seeked" }
] : mechanics ? [
  { codec: "flac", scenario: "fresh", target: 0, padded: true },
  ...["warm", "reload"].flatMap((scenario) => [0, 1].map((target) => ({ codec: "flac", scenario, target, padded: false })))
] : ["wav", "flac"].map((codec) => ({ codec, scenario: "fresh", target: 0, padded: false }));
const cueTimes = [0, .005, .05, .1, .25, .5, .75, 1, 1.25, 1.5, 1.75, 2, 2.5, 3, 3.5, 4, 5];
const frequencies = [375, 562.5, 750, 937.5, 1125, 1500];
const wav = Buffer.alloc(68 + sampleRate * duration * channels * 2);
wav.write("RIFF", 0); wav.writeUInt32LE(wav.length - 8, 4); wav.write("WAVEfmt ", 8);
wav.writeUInt32LE(40, 16); wav.writeUInt16LE(0xfffe, 20); wav.writeUInt16LE(channels, 22);
wav.writeUInt32LE(sampleRate, 24); wav.writeUInt32LE(sampleRate * channels * 2, 28);
wav.writeUInt16LE(channels * 2, 32); wav.writeUInt16LE(16, 34); wav.writeUInt16LE(22, 36);
wav.writeUInt16LE(16, 38); wav.writeUInt32LE(0x63f, 40);
Buffer.from("0100000000001000800000aa00389b71", "hex").copy(wav, 44);
wav.write("data", 60); wav.writeUInt32LE(wav.length - 68, 64);
for (let frame = 0; frame < sampleRate * duration; frame++) {
  const time = frame / sampleRate;
  const envelope = .45 + .25 * Math.sin(2 * Math.PI * .713 * time + .2) + .15 * Math.sin(2 * Math.PI * 1.123 * time + .6);
  for (let channel = 0; channel < 6; channel++) wav.writeInt16LE(Math.round(32767 * .03 * envelope * Math.sin(2 * Math.PI * frequencies[channel] * time)), 68 + (frame * channels + channel) * 2);
}
for (const [index, time] of cueTimes.entries()) {
  const start = Math.round(time * sampleRate);
  // Alternating channels and distinct amplitudes identify the dense first cue group.
  const channel = index % 2 === 0 ? 7 : 6;
  for (let frame = start; frame < start + 48; frame++) wav.writeInt16LE(2048 + index * 128, 68 + (frame * channels + channel) * 2);
}
await writeFile(path.join(output, "fixture.wav"), wav);
const ffmpeg: unknown = createRequire(import.meta.url)("ffmpeg-static");
if (typeof ffmpeg !== "string") throw new Error("ffmpeg-static is unavailable.");
await promisify(execFile)(ffmpeg, ["-nostdin", "-hide_banner", "-loglevel", "error", "-y", "-i", path.join(output, "fixture.wav"),
  "-c:a", "flac", "-sample_fmt", "s16", "-compression_level", "5", path.join(output, "fixture.flac")]);
const flac = await readFile(path.join(output, "fixture.flac"));
const prefixFrames = sampleRate / 4;
const paddedWav = Buffer.alloc(wav.length + prefixFrames * channels * 2);
wav.copy(paddedWav, 0, 0, 68); wav.copy(paddedWav, 68 + prefixFrames * channels * 2, 68);
paddedWav.writeUInt32LE(paddedWav.length - 8, 4); paddedWav.writeUInt32LE(paddedWav.length - 68, 64);
await writeFile(path.join(output, "fixture-padded.wav"), paddedWav);
await promisify(execFile)(ffmpeg, ["-nostdin", "-hide_banner", "-loglevel", "error", "-y", "-i", path.join(output, "fixture-padded.wav"),
  "-c:a", "flac", "-sample_fmt", "s16", "-compression_level", "5", path.join(output, "fixture-padded.flac")]);
const paddedFlac = await readFile(path.join(output, "fixture-padded.flac"));
const metadata = { scope: "Nonproduction codec mechanism: one native HTMLAudioElement, MediaElementSource, discrete eight-channel worklet input; no React or pitch processor.",
  sampleRate, duration, channels, frequencies, cueTimes, cueChannels: cueTimes.map((_, index) => index % 2 === 0 ? 7 : 6),
  wavBytes: wav.length, flacBytes: flac.length, paddingSeconds: .25,
  experiment: startOrder ? "start-order" : mechanics ? "mechanics" : "eight", cases, startedAt: new Date().toISOString() };
await writeFile(path.join(output, "metadata.json"), JSON.stringify(metadata, null, 2));
const plugin: Plugin = { name: "native-eight-experiment", configureServer(server) {
  server.middlewares.use(async (request, response, next) => {
    const url = new URL(request.url ?? "/", `http://127.0.0.1:${port}`);
    if (url.pathname === "/") {
      response.setHeader("Content-Type", "text/html");
      response.end('<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><h1>Eight-channel codec experiment</h1><p>Nonproduction native media test; four seconds.</p><button id="start" disabled style="font-size:24px;padding:24px">Start capture</button><p id="status">Preparing recorder…</p><script type="module" src="/e2e/clickNativeTransportExperimentBrowser.ts"></script></body></html>'); return;
    }
    if (["/fixture.wav", "/fixture.flac", "/fixture-padded.wav", "/fixture-padded.flac"].includes(url.pathname)) {
      const data = url.pathname.includes("padded") ? url.pathname.endsWith("flac") ? paddedFlac : paddedWav : url.pathname.endsWith("flac") ? flac : wav;
      const range = /^bytes=(\d+)-(\d*)$/.exec(request.headers.range ?? "");
      const start = range ? Number(range[1]) : 0;
      const end = range?.[2] ? Math.min(Number(range[2]), data.length - 1) : data.length - 1;
      if (start > end || start >= data.length) { response.statusCode = 416; response.end(); return; }
      response.statusCode = range ? 206 : 200;
      response.setHeader("Content-Type", url.pathname.endsWith("flac") ? "audio/flac" : "audio/wav");
      response.setHeader("Accept-Ranges", "bytes"); response.setHeader("Content-Length", end - start + 1);
      if (range) response.setHeader("Content-Range", `bytes ${start}-${end}/${data.length}`);
      response.end(data.subarray(start, end + 1)); return;
    }
    if (url.pathname === "/report" && request.method === "POST") {
      try {
        let size = 0; const chunks: Buffer[] = [];
        for await (const chunk of request) { const data = Buffer.from(chunk); size += data.length;
          if (size > 32 * 1024 * 1024) throw new Error("Report exceeds limit."); chunks.push(data); }
        const report: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        const name = (url.searchParams.get("run") ?? "manual").replace(/[^a-zA-Z0-9_-]/g, "_");
        await writeFile(path.join(output, `${name}.json`), JSON.stringify(report));
        console.log(JSON.stringify({ saved: name })); response.end("ok");
      } catch (error) { response.statusCode = 400; response.end(String(error)); }
      return;
    }
    next();
  });
} };
const server = await createServer({ configFile: false, plugins: [plugin], server: { host: "127.0.0.1", port, strictPort: true, hmr: false, watch: null } });
await server.listen();
console.log(startOrder
  ? `Native start-order experiment ready http://127.0.0.1:${port}/?codec=flac&scenario=fresh&target=${1 / sampleRate}&order=immediate&run=ios27-fresh-epsilon-immediate`
  : `Native experiment ready http://127.0.0.1:${port}/?codec=flac&run=ios27-flac-eight`);
for (const name of ["SIGINT", "SIGTERM"] as const) process.on(name, () => { void server.close().then(() => process.exit()); });
if (!process.argv.includes("--serve-only")) {
  for (const engine of ["chromium", "webkit"] as const) {
    const browser = await (engine === "chromium" ? chromium : webkit).launch();
    try {
      for (const { codec, scenario, target, padded, order, label } of cases) {
        const name = label ? `${engine}-${label}` : mechanics ? `${engine}-${scenario}-target${target}-${padded ? "padded" : "plain"}` : `${engine}-${codec}-eight`;
        const page = await browser.newPage(); const errors: string[] = [];
        page.on("pageerror", (error) => errors.push(error.message));
        try {
          await page.goto(`http://127.0.0.1:${port}/?codec=${codec}&scenario=${scenario}&target=${target}&padded=${padded ? "1" : "0"}&run=${name}${order ? `&order=${order}` : ""}`);
          if (scenario !== "fresh") {
            await page.getByRole("button", { name: "Prepare warm transport", exact: true }).click({ timeout: 20_000 });
            await page.getByRole("button", { name: "Start capture", exact: true }).waitFor({ timeout: 20_000 });
          }
          await page.locator("#start").click({ timeout: 20_000 });
          await page.waitForFunction(() => window.__nativeTransportResult || window.__nativeTransportError, undefined, { timeout: 20_000 });
          await page.waitForFunction(() => document.querySelector("#status")?.textContent?.startsWith("Saved") || window.__nativeTransportError, undefined, { timeout: 10_000 });
          const capture = await page.evaluate(() => ({ capture: window.__nativeTransportResult, error: window.__nativeTransportError }));
          await writeFile(path.join(output, `${name}.json`), JSON.stringify({ ...capture.capture, error: capture.error, pageErrors: errors }));
          console.log(JSON.stringify({ name, engine, codec, frames: capture.capture?.frames, channels: capture.capture?.inputChannelCounts, error: capture.error, pageErrors: errors }));
        } catch (error) { await writeFile(path.join(output, `${name}-error.json`), JSON.stringify({ error: String(error), pageErrors: errors })); console.log(String(error)); }
        finally { await page.close(); }
      }
    } finally { await browser.close(); }
  }
  console.log("Desktop captures complete; server remains available for native Safari.");
}
