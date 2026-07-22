import express, { type Request, type Response } from "express";
import { Innertube, type Types } from "youtubei.js";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";
import {
  runMadmomBeatAnalysis,
  type BeatGrid
} from "./beatAnalysis.js";
import {
  createLibraryStore,
  type LibraryClickTrack,
  type LibraryMarker,
  type LibraryTrack,
  type LibraryTrackSummary
} from "./libraryStore.js";

const PORT = Number(process.env.PORT ?? 5174);
const MAX_YOUTUBE_DURATION_SECONDS = 60 * 60 * 2;
const MAX_UPLOAD_BYTES = 250 * 1024 * 1024;
const require = createRequire(import.meta.url);
const bundledFfmpegPath = require("ffmpeg-static") as unknown;
let youtubeClientPromise: Promise<Innertube> | null = null;

type YoutubeRequestBody = {
  url?: unknown;
};

type YoutubeResponseBody =
  | {
      mediaUrl: string;
      track: LibraryTrack;
      title: string;
      duration: number;
    }
  | {
      error: string;
    };

type TrackListResponseBody =
  | {
      tracks: LibraryTrackSummary[];
    }
  | {
      error: string;
    };

type TrackResponseBody =
  | {
      track: LibraryTrack;
    }
  | {
      error: string;
    };

type MarkersRequestBody = {
  markers?: unknown;
};

type TrackPatchRequestBody = {
  duration?: unknown;
  title?: unknown;
};

type TrackDeleteResponseBody =
  | {
      ok: true;
    }
  | {
      error: string;
    };

type BeatGridResponseBody =
  | {
      beatGrid: BeatGrid;
    }
  | {
      error: string;
    };

type YoutubeBeatGridResponseBody = LibraryClickTrack | { error: string };

type StoredBeatGridResponseBody =
  | LibraryClickTrack
  | { beatGrid: null; reference: null }
  | { error: string };

type ConvertYoutubeAudio = (
  videoId: string,
  outputPath: string
) => Promise<{ duration: number; title: string }>;

type CreateAppOptions = {
  analyzeBeats?: (audioPath: string) => Promise<BeatGrid>;
  convertYoutubeAudio?: ConvertYoutubeAudio;
  storageDir?: string;
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

function getStoragePaths(storageDir: string) {
  return {
    beatReferenceDir: path.join(storageDir, "beat-references"),
    databasePath: path.join(storageDir, "library.sqlite"),
    mediaDir: path.join(storageDir, "media")
  };
}

function getTrackId(request: Request<{ trackId: string }>) {
  const trackId = request.params.trackId.trim();

  if (trackId.length === 0) {
    throw new InputError("Track id is required.");
  }

  return trackId;
}

function decodeHeaderValue(value: string | string[] | undefined) {
  const firstValue = Array.isArray(value) ? value[0] : value;

  if (!firstValue) {
    return "";
  }

  try {
    return decodeURIComponent(firstValue);
  } catch {
    return firstValue;
  }
}

function getUploadTitle(request: Request) {
  return decodeHeaderValue(request.headers["x-file-name"]) || "Uploaded MP3";
}

function isLikelyMp3Upload(request: Request) {
  const title = getUploadTitle(request).toLowerCase();
  const contentType = request.headers["content-type"]?.toLowerCase() ?? "";

  return (
    title.endsWith(".mp3") ||
    contentType.includes("audio/mpeg") ||
    contentType.includes("audio/mp3") ||
    contentType.includes("application/octet-stream")
  );
}

function parseDuration(value: unknown) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new InputError("Duration must be a non-negative number.");
  }

  return value;
}

function parseTrackTitle(value: unknown) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new InputError("Track title is required.");
  }

  return value;
}

function parseTrackPatchBody(value: unknown): TrackPatchRequestBody {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new InputError("Track update must be an object.");
  }

  return value;
}

function hasPatchField(
  body: TrackPatchRequestBody,
  field: keyof TrackPatchRequestBody
) {
  return Object.prototype.hasOwnProperty.call(body, field);
}

function parseMarkers(value: unknown) {
  if (!Array.isArray(value)) {
    throw new InputError("Markers must be an array.");
  }

  if (value.length > 500) {
    throw new InputError("A track can store up to 500 markers.");
  }

  return value.map((marker, index): LibraryMarker => {
    if (!marker || typeof marker !== "object") {
      throw new InputError(`Marker ${index + 1} is invalid.`);
    }

    const candidate = marker as Record<string, unknown>;

    if (typeof candidate.id !== "string" || candidate.id.trim().length === 0) {
      throw new InputError(`Marker ${index + 1} needs an id.`);
    }

    if (
      typeof candidate.label !== "string" ||
      candidate.label.trim().length === 0
    ) {
      throw new InputError(`Marker ${index + 1} needs a label.`);
    }

    if (
      typeof candidate.time !== "number" ||
      !Number.isFinite(candidate.time) ||
      candidate.time < 0
    ) {
      throw new InputError(`Marker ${index + 1} needs a valid time.`);
    }

    return {
      id: candidate.id.trim(),
      label: candidate.label.trim().slice(0, 120),
      time: candidate.time
    };
  });
}

function sendError(
  response: Response<{ error: string }>,
  error: unknown,
  fallbackMessage: string
) {
  const message = toErrorMessage(error);
  const status = error instanceof InputError ? 400 : 500;

  response.status(status).json({
    error: status === 400 ? message : `${fallbackMessage} ${message}`
  });
}

function getFfmpegPath() {
  if (process.env.FFMPEG_PATH) {
    return process.env.FFMPEG_PATH;
  }

  if (typeof bundledFfmpegPath === "string" && bundledFfmpegPath.length > 0) {
    return bundledFfmpegPath;
  }

  throw new Error("ffmpeg binary is not available.");
}

function createFfmpegProcess(outputPath: string) {
  return spawn(
    getFfmpegPath(),
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

export function createApp(options: CreateAppOptions = {}) {
  const app = express();
  const storageDir =
    options.storageDir ??
    process.env.MIMICOPY_STORAGE_DIR ??
    path.resolve(process.cwd(), "storage");
  const paths = getStoragePaths(storageDir);
  const store = createLibraryStore(paths);
  const analyzeBeats = options.analyzeBeats ?? runMadmomBeatAnalysis;
  const convertYoutubeAudio =
    options.convertYoutubeAudio ?? convertYoutubeToMp3;
  const analyzeYoutubeClickTrack = async (
    url: unknown
  ): Promise<LibraryClickTrack> => {
    let outputPath: string | undefined;

    try {
      const videoId = getYoutubeVideoId(url);

      await mkdir(paths.beatReferenceDir, { recursive: true });
      outputPath = path.join(paths.beatReferenceDir, `${randomUUID()}.mp3`);

      const converted = await convertYoutubeAudio(videoId, outputPath);
      const beatGrid = await analyzeBeats(outputPath);

      return {
        beatGrid,
        reference: {
          duration: converted.duration,
          sourceType: "youtube",
          title: converted.title,
          url: `https://www.youtube.com/watch?v=${videoId}`
        }
      };
    } finally {
      if (outputPath) {
        await rm(outputPath, { force: true }).catch(() => undefined);
      }
    }
  };

  app.use(express.json({ limit: "1mb" }));
  app.use("/media", express.static(paths.mediaDir, { maxAge: "1h" }));

  app.get("/api/health", (_request, response) => {
    response.json({ ok: true });
  });

  app.get(
    "/api/tracks",
    (_request: Request, response: Response<TrackListResponseBody>) => {
      response.json({ tracks: store.listTracks() });
    }
  );

  app.get(
    "/api/tracks/:trackId",
    (
      request: Request<{ trackId: string }>,
      response: Response<TrackResponseBody>
    ) => {
      try {
        const track = store.getTrack(getTrackId(request));

        if (!track) {
          response.status(404).json({ error: "Track was not found." });
          return;
        }

        response.json({ track });
      } catch (error) {
        sendError(response, error, "Could not load the track.");
      }
    }
  );

  app.post(
    "/api/tracks",
    express.raw({
      limit: MAX_UPLOAD_BYTES,
      type: ["audio/mpeg", "audio/mp3", "application/octet-stream"]
    }),
    async (request: Request, response: Response<TrackResponseBody>) => {
      let outputPath: string | undefined;

      try {
        if (!isLikelyMp3Upload(request)) {
          throw new InputError("Only MP3 uploads are supported.");
        }

        if (!Buffer.isBuffer(request.body) || request.body.length === 0) {
          throw new InputError("MP3 file is required.");
        }

        const fileName = `${randomUUID()}.mp3`;
        outputPath = path.join(paths.mediaDir, fileName);

        await writeFile(outputPath, request.body);

        const track = store.createTrack({
          duration: 0,
          mediaFilename: fileName,
          sourceType: "upload",
          title: getUploadTitle(request)
        });

        response.status(201).json({ track });
      } catch (error) {
        if (outputPath) {
          await rm(outputPath, { force: true }).catch(() => undefined);
        }

        sendError(response, error, "Could not save the MP3.");
      }
    }
  );

  app.patch(
    "/api/tracks/:trackId",
    (
      request: Request<{ trackId: string }, TrackResponseBody, TrackPatchRequestBody>,
      response: Response<TrackResponseBody>
    ) => {
      try {
        const trackId = getTrackId(request);
        const patchBody = parseTrackPatchBody(request.body);
        const hasDuration = hasPatchField(patchBody, "duration");
        const hasTitle = hasPatchField(patchBody, "title");
        let track: LibraryTrack | null = null;

        if (!hasDuration && !hasTitle) {
          throw new InputError("Track update requires a title or duration.");
        }

        if (hasTitle) {
          track = store.updateTrackTitle(
            trackId,
            parseTrackTitle(patchBody.title)
          );
        }

        if (hasDuration) {
          track = store.updateTrackDuration(
            trackId,
            parseDuration(patchBody.duration)
          );
        }

        if (!track) {
          response.status(404).json({ error: "Track was not found." });
          return;
        }

        response.json({ track });
      } catch (error) {
        sendError(response, error, "Could not update the track.");
      }
    }
  );

  app.put(
    "/api/tracks/:trackId/markers",
    (
      request: Request<{ trackId: string }, TrackResponseBody, MarkersRequestBody>,
      response: Response<TrackResponseBody>
    ) => {
      try {
        const track = store.replaceMarkers(
          getTrackId(request),
          parseMarkers(request.body.markers)
        );

        if (!track) {
          response.status(404).json({ error: "Track was not found." });
          return;
        }

        response.json({ track });
      } catch (error) {
        sendError(response, error, "Could not save the markers.");
      }
    }
  );

  app.post(
    "/api/tracks/:trackId/beat-grid",
    async (
      request: Request<{ trackId: string }>,
      response: Response<BeatGridResponseBody>
    ) => {
      try {
        const mediaFilename = store.getMediaFilename(getTrackId(request));

        if (!mediaFilename) {
          response.status(404).json({ error: "Track was not found." });
          return;
        }

        const beatGrid = await analyzeBeats(
          path.join(paths.mediaDir, mediaFilename)
        );

        response.json({ beatGrid });
      } catch (error) {
        sendError(response, error, "Could not analyze the beat grid.");
      }
    }
  );

  app.get(
    "/api/tracks/:trackId/beat-grid",
    (
      request: Request<{ trackId: string }>,
      response: Response<StoredBeatGridResponseBody>
    ) => {
      try {
        const trackId = getTrackId(request);

        if (!store.getMediaFilename(trackId)) {
          response.status(404).json({ error: "Track was not found." });
          return;
        }

        const clickTrack = store.getClickTrack(trackId);

        response.json(
          clickTrack ?? {
            beatGrid: null,
            reference: null
          }
        );
      } catch (error) {
        sendError(response, error, "Could not load the saved beat grid.");
      }
    }
  );

  app.post(
    "/api/tracks/:trackId/beat-grid/youtube",
    async (
      request: Request<
        { trackId: string },
        YoutubeBeatGridResponseBody,
        YoutubeRequestBody
      >,
      response: Response<YoutubeBeatGridResponseBody>
    ) => {
      try {
        const trackId = getTrackId(request);

        if (!store.getMediaFilename(trackId)) {
          response.status(404).json({ error: "Track was not found." });
          return;
        }

        const clickTrack = await analyzeYoutubeClickTrack(request.body.url);
        const savedClickTrack = store.replaceClickTrack(trackId, clickTrack);

        if (!savedClickTrack) {
          response.status(404).json({ error: "Track was not found." });
          return;
        }

        response.json(savedClickTrack);
      } catch (error) {
        sendError(response, error, "Could not analyze the YouTube beat grid.");
      }
    }
  );

  app.post(
    "/api/beat-grid/youtube",
    async (
      request: Request<never, YoutubeBeatGridResponseBody, YoutubeRequestBody>,
      response: Response<YoutubeBeatGridResponseBody>
    ) => {
      try {
        response.json(await analyzeYoutubeClickTrack(request.body.url));
      } catch (error) {
        sendError(response, error, "Could not analyze the YouTube beat grid.");
      }
    }
  );

  app.delete(
    "/api/tracks/:trackId",
    async (
      request: Request<{ trackId: string }>,
      response: Response<TrackDeleteResponseBody>
    ) => {
      try {
        const mediaFilename = store.deleteTrack(getTrackId(request));

        if (!mediaFilename) {
          response.status(404).json({ error: "Track was not found." });
          return;
        }

        await rm(path.join(paths.mediaDir, mediaFilename), {
          force: true
        }).catch(() => undefined);

        response.json({ ok: true });
      } catch (error) {
        sendError(response, error, "Could not delete the track.");
      }
    }
  );

  app.post(
    "/api/youtube",
    async (
      request: Request<never, YoutubeResponseBody, YoutubeRequestBody>,
      response: Response<YoutubeResponseBody>
    ) => {
      let outputPath: string | undefined;

      try {
        const videoId = getYoutubeVideoId(request.body.url);

        const fileName = `${randomUUID()}.mp3`;
        outputPath = path.join(paths.mediaDir, fileName);
        const converted = await convertYoutubeAudio(videoId, outputPath);
        const track = store.createTrack({
          duration: converted.duration,
          mediaFilename: fileName,
          sourceType: "youtube",
          title: converted.title
        });

        response.json({
          duration: converted.duration,
          mediaUrl: `/media/${fileName}`,
          track,
          title: converted.title
        });
      } catch (error) {
        if (outputPath) {
          await rm(outputPath, { force: true }).catch(() => undefined);
        }

        sendError(response, error, "Could not convert the YouTube audio.");
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
