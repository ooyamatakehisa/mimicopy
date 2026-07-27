import { request } from "undici";

export const stemNames = [
  "bass",
  "drums",
  "other",
  "vocals",
  "guitar",
  "piano"
] as const;

export type StemName = (typeof stemNames)[number];

export type SeparationProgress = {
  completedSegments: number;
  estimatedRemainingSeconds: number | null;
  totalSegments: number;
};

export type SeparateAudioInput = {
  inputFilename: string;
  onProgress?: (progress: SeparationProgress) => void;
  outputFilename: string;
  remainderOutputFilename: string;
  targetStem: StemName;
};

export type SeparateAudio = (input: SeparateAudioInput) => Promise<void>;

type SeparatorResponse = {
  detail?: unknown;
  error?: unknown;
};

type SeparatorProgressResponse = {
  completed_segments?: unknown;
  estimated_remaining_seconds?: unknown;
  total_segments?: unknown;
};

function readErrorMessage(value: unknown) {
  if (
    value &&
    typeof value === "object" &&
    !Array.isArray(value)
  ) {
    const response = value as SeparatorResponse;

    if (typeof response.error === "string") {
      return response.error;
    }

    if (typeof response.detail === "string") {
      return response.detail;
    }
  }

  return null;
}

export function isStemName(value: unknown): value is StemName {
  return (
    typeof value === "string" &&
    stemNames.some((stemName) => stemName === value)
  );
}

export function parseSeparationProgress(
  value: unknown
): SeparationProgress | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const response = value as SeparatorProgressResponse;
  const completedSegments = response.completed_segments;
  const estimatedRemainingSeconds = response.estimated_remaining_seconds;
  const totalSegments = response.total_segments;

  if (
    typeof completedSegments !== "number" ||
    !Number.isInteger(completedSegments) ||
    completedSegments < 0 ||
    typeof totalSegments !== "number" ||
    !Number.isInteger(totalSegments) ||
    totalSegments <= 0 ||
    completedSegments > totalSegments ||
    (estimatedRemainingSeconds !== null &&
      (typeof estimatedRemainingSeconds !== "number" ||
        !Number.isFinite(estimatedRemainingSeconds) ||
        estimatedRemainingSeconds < 0))
  ) {
    return null;
  }

  return {
    completedSegments,
    estimatedRemainingSeconds,
    totalSegments
  };
}

export function createStemSeparatorClient({
  baseUrl = process.env.MIMICOPY_STEM_SEPARATOR_URL ??
    "http://127.0.0.1:8091",
  progressPollIntervalMs = 1000
}: {
  baseUrl?: string;
  progressPollIntervalMs?: number;
} = {}): SeparateAudio {
  const endpoint = new URL("/v1/separations", baseUrl).toString();

  return async (input) => {
    let requestSettled = false;
    const separationRequest = (async () => {
      const response = await request(endpoint, {
        body: JSON.stringify({
          input_filename: input.inputFilename,
          output_filename: input.outputFilename,
          remainder_output_filename: input.remainderOutputFilename,
          target_stem: input.targetStem
        }),
        bodyTimeout: 0,
        headers: { "Content-Type": "application/json" },
        headersTimeout: 0,
        method: "POST"
      });
      const body = (await response.body.json().catch(() => null)) as unknown;

      if (response.statusCode < 200 || response.statusCode >= 300) {
        throw new Error(
          readErrorMessage(body) ??
            `Stem separator returned HTTP ${response.statusCode}.`
        );
      }
    })();
    void separationRequest.then(
      () => {
        requestSettled = true;
      },
      () => {
        requestSettled = true;
      }
    );

    while (!requestSettled) {
      await new Promise((resolve) =>
        setTimeout(resolve, Math.max(50, progressPollIntervalMs))
      );

      if (requestSettled) {
        break;
      }

      const progressEndpoint = new URL(
        `/v1/separations/${encodeURIComponent(input.outputFilename)}/progress`,
        baseUrl
      ).toString();

      try {
        const progressResponse = await request(progressEndpoint, {
          bodyTimeout: 5000,
          headersTimeout: 5000,
          method: "GET"
        });
        const progressBody = (await progressResponse.body
          .json()
          .catch(() => null)) as unknown;
        const progress =
          progressResponse.statusCode >= 200 &&
          progressResponse.statusCode < 300
            ? parseSeparationProgress(progressBody)
            : null;

        if (progress) {
          input.onProgress?.(progress);
        }
      } catch {
        // Progress is best-effort; the separation request remains authoritative.
      }
    }

    await separationRequest;
  };
}
