import ytdl from "@distube/ytdl-core";
import express, { type Request, type Response } from "express";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import type { Readable } from "node:stream";

const PORT = Number(process.env.PORT ?? 5174);
const MAX_YOUTUBE_DURATION_SECONDS = 60 * 60 * 2;
const mediaDir = path.resolve(process.cwd(), "storage", "media");

type YoutubeRequestBody = {
  url?: unknown;
};

type YoutubeResponseBody =
  | {
      mediaUrl: string;
      title: string;
      duration: number;
    }
  | {
      error: string;
    };

const youtubeHosts = new Set([
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
  "music.youtube.com",
  "youtu.be"
]);

function toErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }

  return "Unknown server error";
}

function parseYoutubeUrl(value: unknown) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error("YouTube URL is required.");
  }

  let parsed: URL;

  try {
    parsed = new URL(value.trim());
  } catch {
    throw new Error("Enter a valid YouTube URL.");
  }

  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("Only HTTP or HTTPS YouTube URLs are supported.");
  }

  const hostname = parsed.hostname.toLowerCase();
  const isYoutubeHost =
    youtubeHosts.has(hostname) || hostname.endsWith(".youtube.com");

  if (!isYoutubeHost || !ytdl.validateURL(parsed.toString())) {
    throw new Error("Enter a valid YouTube video URL.");
  }

  return parsed.toString();
}

function createFfmpegProcess(outputPath: string) {
  return spawn(
    process.env.FFMPEG_PATH ?? "ffmpeg",
    [
      "-hide_banner",
      "-loglevel",
      "error",
      "-i",
      "pipe:0",
      "-vn",
      "-codec:a",
      "libmp3lame",
      "-b:a",
      "192k",
      "-f",
      "mp3",
      outputPath
    ],
    {
      stdio: ["pipe", "ignore", "pipe"]
    }
  );
}

async function transcodeToMp3(input: Readable, outputPath: string) {
  const ffmpeg = createFfmpegProcess(outputPath);
  let stderr = "";

  ffmpeg.stderr?.setEncoding("utf8");
  ffmpeg.stderr?.on("data", (chunk: string) => {
    stderr += chunk;
  });

  const completed = new Promise<void>((resolve, reject) => {
    ffmpeg.on("error", reject);
    ffmpeg.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(stderr.trim() || `ffmpeg exited with code ${code}`));
    });
  });

  await Promise.all([pipeline(input, ffmpeg.stdin), completed]);
}

function getDurationSeconds(value: string | number | undefined) {
  const duration = Number(value);
  return Number.isFinite(duration) ? duration : 0;
}

function createApp() {
  const app = express();

  app.use(express.json({ limit: "1mb" }));
  app.use("/media", express.static(mediaDir, { maxAge: "1h" }));

  app.get("/api/health", (_request, response) => {
    response.json({ ok: true });
  });

  app.post(
    "/api/youtube",
    async (
      request: Request<never, YoutubeResponseBody, YoutubeRequestBody>,
      response: Response<YoutubeResponseBody>
    ) => {
      let outputPath: string | undefined;

      try {
        const url = parseYoutubeUrl(request.body.url);
        await mkdir(mediaDir, { recursive: true });

        const info = await ytdl.getBasicInfo(url);
        const duration = getDurationSeconds(info.videoDetails.lengthSeconds);

        if (duration > MAX_YOUTUBE_DURATION_SECONDS) {
          response.status(400).json({
            error: "Videos longer than 2 hours are not supported."
          });
          return;
        }

        const fileName = `${randomUUID()}.mp3`;
        outputPath = path.join(mediaDir, fileName);
        const stream = ytdl(url, {
          filter: "audioonly",
          highWaterMark: 1 << 25,
          quality: "highestaudio"
        });

        await transcodeToMp3(stream, outputPath);

        response.json({
          duration,
          mediaUrl: `/media/${fileName}`,
          title: info.videoDetails.title || "YouTube audio"
        });
      } catch (error) {
        if (outputPath) {
          await rm(outputPath, { force: true }).catch(() => undefined);
        }

        const message = toErrorMessage(error);
        const status = message.toLowerCase().includes("youtube url")
          ? 400
          : 500;

        response.status(status).json({
          error:
            status === 400
              ? message
              : `Could not convert the YouTube audio. ${message}`
        });
      }
    }
  );

  if (process.env.NODE_ENV === "production") {
    const distDir = path.resolve(process.cwd(), "dist");

    app.use(express.static(distDir));
    app.get(/.*/, (_request, response) => {
      response.sendFile(path.join(distDir, "index.html"));
    });
  }

  return app;
}

const app = createApp();

app.listen(PORT, () => {
  console.log(`Mimicopy API listening on http://127.0.0.1:${PORT}`);
});
