import express, { type Request, type Response } from "express";
import { Innertube, type Types } from "youtubei.js";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, rename, rm } from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";

const PORT = Number(process.env.PORT ?? 5174);
const MAX_YOUTUBE_DURATION_SECONDS = 60 * 60 * 2;
const mediaDir = path.resolve(process.cwd(), "storage", "media");
let youtubeClientPromise: Promise<Innertube> | null = null;

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

export type YoutubeDownloadPlan = {
  client: Types.InnerTubeClient;
  label: string;
  options: Types.DownloadOptions;
};

const youtubeHosts = new Set([
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
  "music.youtube.com",
  "youtu.be"
]);

export const youtubeDownloadPlans = [
  {
    client: "IOS",
    label: "iOS audio-only MP4",
    options: { format: "mp4", quality: "best", type: "audio" }
  },
  {
    client: "ANDROID",
    label: "Android 360p MP4 video",
    options: { format: "mp4", quality: "360p", type: "video+audio" }
  },
  {
    client: "ANDROID",
    label: "Android best MP4 video",
    options: { format: "mp4", quality: "best", type: "video+audio" }
  }
] satisfies readonly YoutubeDownloadPlan[];

class InputError extends Error {}

function toErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }

  return "Unknown server error";
}

export function getYoutubeVideoId(value: unknown) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new InputError("YouTube URL is required.");
  }

  let parsed: URL;

  try {
    parsed = new URL(value.trim());
  } catch {
    throw new InputError("Enter a valid YouTube URL.");
  }

  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new InputError("Only HTTP or HTTPS YouTube URLs are supported.");
  }

  const hostname = parsed.hostname.toLowerCase();
  const isYoutubeHost =
    youtubeHosts.has(hostname) || hostname.endsWith(".youtube.com");

  if (!isYoutubeHost) {
    throw new InputError("Enter a valid YouTube video URL.");
  }

  if (hostname === "youtu.be") {
    const videoId = parsed.pathname.split("/").filter(Boolean)[0];

    if (videoId) {
      return videoId;
    }
  }

  const watchVideoId = parsed.searchParams.get("v");

  if (watchVideoId) {
    return watchVideoId;
  }

  const pathMatch = parsed.pathname.match(
    /^\/(?:embed|live|shorts)\/([^/?#]+)/
  );

  if (pathMatch?.[1]) {
    return pathMatch[1];
  }

  throw new InputError("Enter a valid YouTube video URL.");
}

function getYoutubeClient() {
  youtubeClientPromise ??= Innertube.create();
  return youtubeClientPromise;
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

  let streamError: unknown;

  try {
    await pipeline(input, ffmpeg.stdin);
  } catch (error) {
    streamError = error;
    ffmpeg.kill("SIGTERM");
  }

  try {
    await completed;
  } catch (error) {
    if (streamError) {
      throw streamError;
    }

    throw error;
  }

  if (streamError) {
    throw streamError;
  }
}

function getDurationSeconds(value: string | number | undefined) {
  const duration = Number(value);
  return Number.isFinite(duration) ? duration : 0;
}

async function convertYoutubeToMp3(videoId: string, outputPath: string) {
  const youtube = await getYoutubeClient();
  const failures: string[] = [];
  let duration = 0;
  let title = "YouTube audio";

  for (const [index, plan] of youtubeDownloadPlans.entries()) {
    const attemptPath = `${outputPath}.${index}.tmp`;

    try {
      const info = await youtube.getBasicInfo(videoId, { client: plan.client });

      duration = getDurationSeconds(info.basic_info.duration) || duration;
      title = info.basic_info.title || title;

      if (duration > MAX_YOUTUBE_DURATION_SECONDS) {
        throw new InputError("Videos longer than 2 hours are not supported.");
      }

      const webStream = await info.download(plan.options);
      const stream = Readable.fromWeb(webStream);

      await transcodeToMp3(stream, attemptPath);
      await rename(attemptPath, outputPath);

      return { duration, title };
    } catch (error) {
      await rm(attemptPath, { force: true }).catch(() => undefined);

      if (error instanceof InputError) {
        throw error;
      }

      failures.push(`${plan.label}: ${toErrorMessage(error)}`);
    }
  }

  throw new Error(
    `All YouTube download methods failed. ${failures.join(" | ")}`
  );
}

export function createApp() {
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
        const videoId = getYoutubeVideoId(request.body.url);
        await mkdir(mediaDir, { recursive: true });

        const fileName = `${randomUUID()}.mp3`;
        outputPath = path.join(mediaDir, fileName);
        const converted = await convertYoutubeToMp3(videoId, outputPath);

        response.json({
          duration: converted.duration,
          mediaUrl: `/media/${fileName}`,
          title: converted.title
        });
      } catch (error) {
        if (outputPath) {
          await rm(outputPath, { force: true }).catch(() => undefined);
        }

        const message = toErrorMessage(error);
        const status = error instanceof InputError ? 400 : 500;

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

function isDirectRun() {
  const entryPath = process.argv[1];

  return Boolean(
    entryPath && path.resolve(entryPath) === fileURLToPath(import.meta.url)
  );
}

if (isDirectRun()) {
  const app = createApp();

  app.listen(PORT, () => {
    console.log(`Mimicopy API listening on http://127.0.0.1:${PORT}`);
  });
}
