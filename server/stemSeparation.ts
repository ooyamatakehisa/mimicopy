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

export type SeparateAudioInput = {
  inputFilename: string;
  outputFilename: string;
  remainderOutputFilename: string;
  targetStem: StemName;
};

export type SeparateAudio = (input: SeparateAudioInput) => Promise<void>;

type SeparatorResponse = {
  detail?: unknown;
  error?: unknown;
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

export function createStemSeparatorClient({
  baseUrl = process.env.MIMICOPY_STEM_SEPARATOR_URL ??
    "http://127.0.0.1:8091"
}: {
  baseUrl?: string;
} = {}): SeparateAudio {
  const endpoint = new URL("/v1/separations", baseUrl).toString();

  return async (input) => {
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
  };
}
