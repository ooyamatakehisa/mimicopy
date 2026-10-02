import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_ANALYSIS_TIMEOUT_MS = 5 * 60 * 1000;
const MAX_BEAT_OUTPUT_BYTES = 1024 * 1024;

export type BeatPoint = {
  time: number;
  position: number;
  isDownbeat: boolean;
};

export type BeatGrid = {
  analyzedAt: string;
  beats: BeatPoint[];
  beatsPerBar: number[];
  downbeats: number[];
} & (
  | { source: "madmom" }
  | { source: "beat-this"; model: "final0"; postprocessor: "dbn" }
);

type BeatAnalysisOptions = {
  pythonPath?: string;
  scriptPath?: string;
  timeoutMs?: number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function readFiniteNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function parseBeatsPerBar(value: unknown) {
  if (!Array.isArray(value)) {
    throw new Error("Beat This! returned invalid measure lengths.");
  }

  const beatsPerBar = value.filter(
    (candidate): candidate is number =>
      Number.isSafeInteger(candidate) && candidate > 0
  );

  if (beatsPerBar.length !== value.length) {
    throw new Error("Beat This! returned invalid measure lengths.");
  }

  return beatsPerBar;
}

function parseBeatPoint(value: unknown): BeatPoint | null {
  if (!isRecord(value)) {
    return null;
  }

  const time = readFiniteNumber(value.time);
  const position = readFiniteNumber(value.position);

  if (time === null || time < 0 || position === null || position < 1) {
    return null;
  }

  return {
    isDownbeat: value.isDownbeat === true,
    position: Math.max(1, Math.round(position)),
    time
  };
}

function getScriptPath() {
  return path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../scripts/analyze_beats.py"
  );
}

function getTimeoutMs(timeoutMs: number | undefined) {
  if (timeoutMs !== undefined) {
    return timeoutMs;
  }

  const timeoutFromEnv = Number(process.env.MIMICOPY_BEAT_ANALYSIS_TIMEOUT_MS);

  return Number.isFinite(timeoutFromEnv) && timeoutFromEnv > 0
    ? timeoutFromEnv
    : DEFAULT_ANALYSIS_TIMEOUT_MS;
}

export function parseBeatThisBeatGrid(value: unknown): BeatGrid {
  if (
    !isRecord(value) ||
    value.source !== "beat-this" ||
    value.model !== "final0" ||
    value.postprocessor !== "dbn" ||
    !Array.isArray(value.beats)
  ) {
    throw new Error("Beat This! returned an invalid beat grid.");
  }

  const beats = value.beats.map(parseBeatPoint);

  if (beats.some((beat) => beat === null)) {
    throw new Error("Beat This! returned an invalid beat position.");
  }

  const sortedBeats = (beats as BeatPoint[]).sort((left, right) => {
    return left.time - right.time;
  });

  return {
    analyzedAt: new Date().toISOString(),
    beats: sortedBeats,
    beatsPerBar: parseBeatsPerBar(value.beatsPerBar),
    downbeats: sortedBeats
      .filter((beat) => beat.isDownbeat)
      .map((beat) => beat.time),
    source: "beat-this",
    model: "final0",
    postprocessor: "dbn"
  };
}

export function parseStoredBeatGrid(value: unknown): BeatGrid {
  if (
    !isRecord(value) ||
    typeof value.analyzedAt !== "string" ||
    value.analyzedAt.length === 0 ||
    (value.source !== "madmom" && value.source !== "beat-this") ||
    (value.source === "beat-this" &&
      (value.model !== "final0" || value.postprocessor !== "dbn")) ||
    !Array.isArray(value.beats) ||
    !Array.isArray(value.beatsPerBar)
  ) {
    throw new Error("Stored beat grid is invalid.");
  }

  const beats = value.beats.map(parseBeatPoint);
  const beatsPerBar = value.beatsPerBar.filter(
    (candidate): candidate is number =>
      Number.isSafeInteger(candidate) && candidate > 0
  );

  if (
    beats.some((beat) => beat === null) ||
    beatsPerBar.length !== value.beatsPerBar.length ||
    (value.source === "madmom" && beatsPerBar.length === 0)
  ) {
    throw new Error("Stored beat grid is invalid.");
  }

  const sortedBeats = (beats as BeatPoint[]).sort((left, right) => {
    return left.time - right.time;
  });

  return {
    analyzedAt: value.analyzedAt,
    beats: sortedBeats,
    beatsPerBar,
    downbeats: sortedBeats
      .filter((beat) => beat.isDownbeat)
      .map((beat) => beat.time),
    ...(value.source === "madmom"
      ? { source: "madmom" as const }
      : {
          source: "beat-this" as const,
          model: "final0" as const,
          postprocessor: "dbn" as const
        })
  };
}

export async function runBeatThisBeatAnalysis(
  audioPath: string,
  options: BeatAnalysisOptions = {}
) {
  const pythonPath =
    options.pythonPath ?? process.env.MIMICOPY_BEAT_PYTHON ?? "python3";
  const scriptPath = options.scriptPath ?? getScriptPath();
  const timeoutMs = getTimeoutMs(options.timeoutMs);
  const output = await new Promise<string>((resolve, reject) => {
    const child = spawn(pythonPath, [scriptPath, audioPath], {
      env: {
        ...process.env,
        PYTHONUNBUFFERED: "1"
      },
      stdio: ["ignore", "pipe", "pipe"]
    });
    let settled = false;
    let stdout = "";
    let stderr = "";
    const timeoutId = setTimeout(() => {
      if (settled) {
        return;
      }

      settled = true;
      child.kill("SIGTERM");
      reject(new Error("Beat This! beat analysis timed out."));
    }, timeoutMs);

    const settle = (error: Error | null, value?: string) => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timeoutId);

      if (error) {
        reject(error);
        return;
      }

      resolve(value ?? "");
    };

    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;

      if (stdout.length > MAX_BEAT_OUTPUT_BYTES) {
        child.kill("SIGTERM");
        settle(new Error("Beat This! beat analysis returned too much data."));
      }
    });

    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });

    child.on("error", (error) => {
      settle(
        new Error(
          `Could not start Beat This! Install requirements-beat-this.txt for Python or set MIMICOPY_BEAT_PYTHON. ${error.message}`
        )
      );
    });

    child.on("close", (code, signal) => {
      if (code === 0) {
        settle(null, stdout);
        return;
      }

      settle(
        new Error(
          `Beat This! beat analysis failed${
            signal ? ` with signal ${signal}` : ` with exit code ${code}`
          }. ${stderr.trim()}`
        )
      );
    });
  });

  try {
    return parseBeatThisBeatGrid(JSON.parse(output) as unknown);
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error("Beat This! returned invalid JSON.");
    }

    throw error;
  }
}
