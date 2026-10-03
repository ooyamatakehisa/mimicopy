import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { expect, test, type Page } from "@playwright/test";
import { generateMixerMedia } from "../server/mixerMedia";

const realYoutubeUrl =
  process.env.MIMICOPY_E2E_YOUTUBE_URL ??
  "https://www.youtube.com/watch?v=OS45uTF_8P0&list=RDOS45uTF_8P0&start_radio=1";
const runRealYoutubeE2e = process.env.MIMICOPY_E2E_REAL_YOUTUBE === "1";

const fixtureDurationSeconds = 20;
let fixtureDirectory: string | undefined;
let sourceMp3: Buffer;
let mixerWav: Buffer;

test.beforeAll(async () => {
  fixtureDirectory = await mkdtemp(path.join(tmpdir(), "mimicopy-e2e-media-"));
  const wavPath = path.join(fixtureDirectory, "source.wav");
  const mp3Path = path.join(fixtureDirectory, "source.mp3");
  const mixerPath = path.join(fixtureDirectory, "mixer.wav");
  const binary = process.env.FFMPEG_PATH ?? createRequire(import.meta.url)("ffmpeg-static") as unknown;
  if (typeof binary !== "string" || binary.length === 0) {
    throw new Error("ffmpeg is required to create genuine MP3 fixtures.");
  }
  await writeFile(wavPath, createToneWavBuffer());
  await promisify(execFile)(binary, [
    "-nostdin", "-hide_banner", "-loglevel", "error", "-y",
    "-i", wavPath, "-codec:a", "libmp3lame", "-b:a", "128k", mp3Path
  ]);
  await generateMixerMedia({
    originalPath: mp3Path, stemPath: mp3Path,
    remainderPath: mp3Path, outputPath: mixerPath
  }, binary);
  [sourceMp3, mixerWav] = await Promise.all([readFile(mp3Path), readFile(mixerPath)]);
});

test.afterAll(async () => {
  if (fixtureDirectory) await rm(fixtureDirectory, { recursive: true, force: true });
});

function createToneWavBuffer() {
  const sampleRate = 44_100;
  const durationSeconds = fixtureDurationSeconds;
  const sampleCount = sampleRate * durationSeconds;
  const channelCount = 1;
  const bitsPerSample = 16;
  const bytesPerSample = bitsPerSample / 8;
  const dataSize = sampleCount * channelCount * bytesPerSample;
  const buffer = Buffer.alloc(44 + dataSize);

  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write("WAVE", 8);
  buffer.write("fmt ", 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(channelCount, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * channelCount * bytesPerSample, 28);
  buffer.writeUInt16LE(channelCount * bytesPerSample, 32);
  buffer.writeUInt16LE(bitsPerSample, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(dataSize, 40);

  for (let index = 0; index < sampleCount; index += 1) {
    const value = Math.sin((index / sampleRate) * Math.PI * 2 * 440);
    buffer.writeInt16LE(Math.round(value * 0x7fff * 0.35), 44 + index * 2);
  }

  return buffer;
}

function createCompletedBeatAnalysis() {
  const now = "2026-07-20T00:00:00.000Z";

  return {
    beatGrid: {
      analyzedAt: now,
      beats: [
        { isDownbeat: true, position: 1, time: 0.25 },
        { isDownbeat: false, position: 2, time: 0.5 },
        { isDownbeat: false, position: 3, time: 0.75 }
      ],
      beatsPerBar: [4],
      downbeats: [0.25],
      source: "beat-this",
      model: "final0",
      postprocessor: "dbn"
    },
    createdAt: now,
    error: null,
    status: "completed",
    updatedAt: now
  };
}

async function expectWaveformCanvas(page: Page) {
  await expect
    .poll(() =>
      page
        .locator("canvas")
        .evaluate((element) => {
          const canvas = element as HTMLCanvasElement;

          return canvas.width > 0 && canvas.height > 0;
        })
    )
    .toBe(true);
}

async function expectInitialPlaybackPosition(page: Page) {
  await expect(page.getByLabel("再生位置")).toHaveAttribute("aria-valuenow", "0");
  await expect(page.getByLabel("Waveform", { exact: true })).toContainText(
    "0:00 /"
  );

  const mediaState = await page
    .locator('audio[aria-label="Original audio"]')
    .evaluate((audioElement) => {
      const audio = audioElement as HTMLAudioElement;

      return {
        currentTime: audio.currentTime,
        duration: audio.duration
      };
    });
  const playheadLeft = await page
    .locator(".waveformSurface > div")
    .last()
    .evaluate((element) => {
      const waveform = element.parentElement;
      const canvas = waveform?.querySelector("canvas");

      if (!waveform || !canvas) {
        throw new Error("Waveform surface or canvas was not found.");
      }

      return {
        computedLeft: Math.round(
          element.getBoundingClientRect().left -
            canvas.getBoundingClientRect().left
        ),
        style: element.getAttribute("style") ?? ""
      };
    });

  expect(mediaState.currentTime).toBe(0);
  expect(mediaState.duration).toBeGreaterThan(0);
  expect(playheadLeft.style).toContain("--playhead-left: 0%");
  expect(playheadLeft.computedLeft).toBe(0);
}

async function mockYoutubeConversion(page: Page) {
  let hasConvertedTrack = false;
  const now = new Date().toISOString();
  const track = {
    createdAt: now,
    duration: fixtureDurationSeconds,
    id: "e2e-youtube-track",
    markerCount: 0,
    markers: [],
    mediaUrl: "/media/e2e-youtube.mp3",
    separation: {
      createdAt: now,
      error: null,
      mediaUrl: "/media/e2e-youtube-guitar.mp3",
      progress: null,
      remainderMediaUrl:
        "/media/e2e-youtube-guitar-remainder.mp3",
      status: "completed",
      targetStem: "guitar",
      updatedAt: now
    },
    sourceType: "youtube",
    title: "Mock YouTube Track",
    updatedAt: now
  };
  const trackSummary = {
    createdAt: track.createdAt,
    duration: track.duration,
    id: track.id,
    markerCount: track.markerCount,
    mediaUrl: track.mediaUrl,
    sourceType: track.sourceType,
    title: track.title,
    updatedAt: track.updatedAt
  };

  await page.route(
    "**/api/tracks/e2e-youtube-track/beat-grid",
    async (route) => {
      await route.fulfill({
        body: JSON.stringify(createCompletedBeatAnalysis()),
        contentType: "application/json",
        status: 200
      });
    }
  );
  await page.route("**/api/tracks/e2e-youtube-track/mixer", async (route) => {
    await route.fulfill({
      json: { mediaUrl: "/media/e2e-youtube-mixer.wav" }
    });
  });
  await page.route("**/media/e2e-youtube-mixer.wav", async (route) => {
    // Mirror express.static byte ranges so real media seeks stay seekable.
    const range = /^bytes=(\d+)-(\d*)$/.exec(route.request().headers().range ?? "");
    const start = range ? Number(range[1]) : 0;
    const end = range?.[2] ? Math.min(Number(range[2]), mixerWav.length - 1) : mixerWav.length - 1;
    await route.fulfill({
      body: mixerWav.subarray(start, end + 1),
      contentType: "audio/wav",
      headers: {
        "accept-ranges": "bytes",
        ...(range ? { "content-range": `bytes ${start}-${end}/${mixerWav.length}` } : {})
      },
      status: range ? 206 : 200
    });
  });
  await page.route("**/api/youtube", async (route) => {
    const requestBody = route.request().postDataJSON() as {
      targetStem?: unknown;
    };

    expect(requestBody.targetStem).toBe("guitar");
    hasConvertedTrack = true;
    await route.fulfill({
      body: JSON.stringify({ track }),
      contentType: "application/json",
      status: 200
    });
  });
  await page.route("**/api/tracks/e2e-youtube-track", async (route) => {
    if (route.request().method() === "DELETE") {
      hasConvertedTrack = false;
      await route.fulfill({
        body: JSON.stringify({ ok: true }),
        contentType: "application/json",
        status: 200
      });
      return;
    }

    await route.fulfill({
      body: JSON.stringify({ track }),
      contentType: "application/json",
      status: 200
    });
  });
  await page.route("**/api/tracks", async (route) => {
    if (route.request().method() !== "GET") {
      await route.fallback();
      return;
    }

    await route.fulfill({
      body: JSON.stringify({ tracks: hasConvertedTrack ? [trackSummary] : [] }),
      contentType: "application/json",
      status: 200
    });
  });
  await page.route("**/media/e2e-youtube.mp3", async (route) => {
    await route.fulfill({
      body: sourceMp3,
      contentType: "audio/mpeg",
      status: 200
    });
  });
  await page.route("**/media/e2e-youtube-guitar.mp3", async (route) => {
    await route.fulfill({
      body: sourceMp3,
      contentType: "audio/mpeg",
      status: 200
    });
  });
  await page.route(
    "**/media/e2e-youtube-guitar-remainder.mp3",
    async (route) => {
      await route.fulfill({
        body: sourceMp3,
        contentType: "audio/mpeg",
        status: 200
      });
    }
  );
}

test("loads audio and supports the main playback and marker workflow", async ({
  page
}) => {
  await page.route("**/api/tracks/*/beat-grid", async (route) => {
    await route.fulfill({
      body: JSON.stringify(createCompletedBeatAnalysis()),
      contentType: "application/json",
      status: 200
    });
  });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Mimicopy" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Library" })).toBeVisible();

  const fileChooserPromise = page.waitForEvent("filechooser");
  await page.getByTitle("MP3を選択").click();
  const fileChooser = await fileChooserPromise;
  await fileChooser.setFiles({
    buffer: sourceMp3,
    mimeType: "audio/mpeg",
    name: "e2e-tone.mp3"
  });

  await expect(page).toHaveURL(/\/tracks\/[^/]+$/);
  await expect(page.getByLabel("Waveform", { exact: true })).toContainText(
    "ready"
  );
  await expect(page.getByText("e2e-tone.mp3 を読み込みました。")).toHaveCount(0);
  const editor = page.getByLabel("Audio editor");
  await editor.getByTitle("表示名を編集").click();
  await editor.getByLabel("e2e-tone.mp3 display name").fill("Detail practice");
  await editor.getByTitle("表示名を保存").click();
  await expect(
    page.getByRole("heading", { name: "Detail practice" })
  ).toBeVisible();
  const trackId = new URL(page.url()).pathname.split("/").at(-1);

  await expect(page.getByLabel("Playback speed")).toContainText("1x");
  await expect(page.getByLabel("Transpose")).toContainText("0");
  await expect(page.getByLabel("Waveform zoom")).toContainText("1x");
  await expectWaveformCanvas(page);
  await expectInitialPlaybackPosition(page);

  const waveformSlider = page.getByRole("slider", { name: "再生位置" });

  await waveformSlider.dispatchEvent("wheel", {
    ctrlKey: true,
    deltaY: -10
  });
  await expect(page.getByLabel("Waveform zoom")).toContainText("1.11x");
  await waveformSlider.dispatchEvent("wheel", {
    ctrlKey: true,
    deltaY: 100
  });
  await expect(page.getByLabel("Waveform zoom")).toContainText("1x");

  const clickTrackControls = page.getByLabel("Click track");
  const clickToggle = page.getByTitle("クリック音をオン/オフ");

  await expect(clickTrackControls).toContainText("3 beats / 1 downbeats");
  await expect(page.getByLabel("Click source YouTube URL")).toHaveCount(0);
  await expect(clickToggle).toBeEnabled();
  await clickToggle.click();
  await expect(clickToggle).toHaveAttribute("aria-pressed", "true");
  await clickToggle.click();
  await expect(clickToggle).toHaveAttribute("aria-pressed", "false");

  await page.getByTitle("再生").click();
  await expect(page.getByTitle("停止")).toBeVisible();
  await page.keyboard.press("KeyK");
  await expect(page.getByTitle("再生")).toBeVisible();
  await page.keyboard.press("Space");
  await expect(page.getByTitle("停止")).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(page.getByTitle("再生")).toBeVisible();

  await page.evaluate(() => {
    const audio = document.querySelector("audio");

    if (!audio) {
      throw new Error("Audio element was not found.");
    }

    audio.currentTime = 0.5;
    audio.dispatchEvent(new Event("timeupdate", { bubbles: true }));
  });
  await page.keyboard.press("ArrowLeft");
  await expect
    .poll(() =>
      page.evaluate(() => document.querySelector("audio")?.currentTime ?? -1)
    )
    .toBeLessThan(0.1);
  await page.keyboard.press("ArrowRight");
  await expect
    .poll(() =>
      page.evaluate(() => document.querySelector("audio")?.currentTime ?? -1)
    )
    .toBeGreaterThan(0.9);
  await page.keyboard.press("KeyJ");
  await expect
    .poll(() =>
      page.evaluate(() => document.querySelector("audio")?.currentTime ?? -1)
    )
    .toBeLessThan(0.1);
  await page.keyboard.press("KeyL");
  await expect
    .poll(() =>
      page.evaluate(() => document.querySelector("audio")?.currentTime ?? -1)
    )
    .toBeGreaterThan(0.9);

  await page.getByTitle("速度を下げる").focus();
  for (const speed of ["0.75x", "0.5x", "0.25x"]) {
    await page.keyboard.press("Shift+Comma");
    await expect(page.getByLabel("Playback speed")).toContainText(speed);
  }
  for (const speed of ["0.5x", "0.75x", "1x"]) {
    await page.keyboard.press("Shift+Period");
    await expect(page.getByLabel("Playback speed")).toContainText(speed);
  }

  await page.getByTitle("半音上げる").click();
  await expect(page.getByLabel("Transpose")).toContainText("+1");
  await expect(page.getByLabel("Waveform", { exact: true })).toContainText(
    "ready"
  );
  await page
    .locator('audio[aria-label="Original audio"]')
    .evaluate((audio) => {
      (audio as HTMLAudioElement).currentTime = 0;
    });
  await page.getByTitle("再生").click();
  await expect
    .poll(() =>
      page
        .locator('audio[aria-label="Original audio"]')
        .evaluate((audio) => (audio as HTMLAudioElement).currentTime)
    )
    .toBeGreaterThan(0.1);
  await page.getByTitle("停止").click();
  await expect(page.getByLabel("Waveform", { exact: true })).toContainText(
    "ready"
  );
  await page.getByTitle("半音下げる").click();
  await expect(page.getByLabel("Transpose")).toContainText("0");

  await page.getByLabel("Marker time").fill("0:00");
  await page.getByTitle("入力時刻にマーカー追加").click();
  await expect(page.getByLabel("Marker 1 label")).toHaveValue("Marker 1");
  await expect(page.getByLabel("Marker 1 time")).toHaveValue("0:00");
  await page.getByTitle("選択マーカーへ戻る").click();
  await expect
    .poll(() =>
      page.evaluate(() => document.querySelector("audio")?.currentTime ?? -1)
    )
    .toBeLessThan(0.1);
  await page.getByTitle("マーカー削除").click();
  await expect(page.getByText("No markers")).toBeVisible();
  await page.getByTitle("再生").focus();
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("KeyM");
  await expect(page.getByLabel("Marker 1 time")).toHaveValue("0:05");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("Backspace");
  await expect.poll(() => page.locator("audio").evaluate((element) =>
    (element as HTMLAudioElement).currentTime
  )).toBeCloseTo(5, 1);
  await page.getByTitle("マーカー削除").focus();
  await page.keyboard.press("Enter");
  await expect(page.getByText("No markers")).toBeVisible();

  expect(trackId).toBeTruthy();
  await page.goto(`/tracks/${trackId}`);
  await expect(page.getByLabel("Playback speed")).toContainText("1x");
  await expect(page.getByLabel("Click track")).toContainText(
    "3 beats / 1 downbeats"
  );
  await expect(page.getByLabel("Click source YouTube URL")).toHaveCount(0);
  await page.getByTitle("ライブラリへ戻る").click();
  await expect(page).toHaveURL("/");
  const library = page.getByLabel("Saved MP3 library");
  const uploadedTrackRow = library.getByTestId(`library-track-${trackId}`);
  await expect(uploadedTrackRow).toContainText("Detail practice");
  await uploadedTrackRow.getByTitle("表示名を編集").click();
  await uploadedTrackRow
    .getByLabel("Detail practice display name")
    .fill("Practice loop");
  await uploadedTrackRow.getByTitle("表示名を保存").click();
  await expect(uploadedTrackRow).toContainText("Practice loop");

  page.once("dialog", (dialog) => dialog.accept());
  await uploadedTrackRow.getByTitle("保存済みMP3を削除").click();
  await expect(library.getByTestId(`library-track-${trackId}`)).toHaveCount(0);
});

test("converts a YouTube URL through the UI", async ({ page }) => {
  await mockYoutubeConversion(page);

  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Library" })).toBeVisible();

  await page.getByLabel("YouTube URL").fill(realYoutubeUrl);
  await page.getByLabel("分離する楽器").selectOption("guitar");
  await page.getByTitle("YouTubeを変換").click();

  await expect(page).toHaveURL("/tracks/e2e-youtube-track");
  await expect(page.getByLabel("Waveform", { exact: true })).toContainText(
    "ready"
  );
  await expect(page.getByText("Mock YouTube Track を読み込みました。")).toHaveCount(0);
  await expect(page.getByLabel("Playback speed")).toContainText("1x");
  await expectWaveformCanvas(page);
  await expectInitialPlaybackPosition(page);

  const mediaState = await page
    .locator('audio[aria-label="Original audio"]')
    .evaluate((audioElement) => {
      const audio = audioElement as HTMLAudioElement;

      return {
        duration: audio.duration,
        src: audio.currentSrc
      };
    });

  expect(mediaState.src).toContain("/media/e2e-youtube-mixer.wav");
  expect(mediaState.duration).toBeGreaterThan(0);
  const mixer = page.getByLabel("Audio mixer");

  await expect(mixer.getByLabel("原音 channel")).toBeVisible();
  await expect(mixer.getByLabel("ギター channel")).toBeVisible();
  await expect(mixer.getByLabel("ギター以外 channel")).toBeVisible();
  await expect(
    mixer.getByRole("link", { name: "原音をダウンロード" })
  ).toHaveAttribute("download", "Mock YouTube Track.mp3");
  await expect(
    mixer.getByRole("link", { name: "ギターをダウンロード" })
  ).toHaveAttribute("download", "Mock YouTube Track-guitar.mp3");
  await expect(
    mixer.getByRole("link", { name: "ギター以外をダウンロード" })
  ).toHaveAttribute(
    "download",
    "Mock YouTube Track-guitar-remainder.mp3"
  );
  const downloadPromise = page.waitForEvent("download");
  await mixer.getByRole("link", { name: "ギターをダウンロード" }).click();
  const download = await downloadPromise;

  expect(download.suggestedFilename()).toBe("Mock YouTube Track-guitar.mp3");
  await mixer.getByLabel("原音の音量").fill("40");
  await expect(mixer.getByLabel("原音の音量")).toHaveValue("40");
  await mixer.getByTitle("原音をミュート").click();
  await expect(mixer.getByTitle("原音をミュート")).toHaveAttribute(
    "aria-pressed",
    "true"
  );
  await mixer.getByTitle("原音をミュート").click();
  await mixer.getByTitle("ギターをソロ").click();
  await expect(mixer.getByTitle("ギターをソロ")).toHaveAttribute(
    "aria-pressed",
    "true"
  );

  const transport = page.locator('audio[aria-label="Original audio"]');
  await expect(page.locator("audio")).toHaveCount(1);
  await expect.poll(() => transport.evaluate((element) =>
    (element as HTMLAudioElement).readyState
  )).toBeGreaterThanOrEqual(2);

  await page.getByTitle("再生").click();
  await expect(page.getByTitle("停止")).toBeVisible();
  await expect.poll(() => transport.evaluate((element) =>
    (element as HTMLAudioElement).currentTime
  )).toBeGreaterThan(0.1);
  // Exercise all six native buttons during real playback. The audio audit
  // separately measures output; this UI test never substitutes media clocks.
  await mixer.getByTitle("ギターをソロ").click();
  for (const channel of ["原音", "ギター", "ギター以外"]) {
    for (const action of ["ソロ", "ミュート"]) {
      const button = mixer.getByTitle(`${channel}を${action}`);
      await button.focus();
      await page.keyboard.press("Space");
      await expect(button).toHaveAttribute("aria-pressed", "true");
      await expect(page.getByTitle("停止")).toBeVisible();
      await page.keyboard.press("Enter");
      await expect(button).toHaveAttribute("aria-pressed", "false");
      await expect(page.getByTitle("停止")).toBeVisible();
    }
  }
  await page.getByTitle("速度を下げる").focus();
  for (const rate of [0.75, 0.5, 0.25]) {
    await page.keyboard.press("Shift+Comma");
    await expect.poll(() => transport.evaluate((element) =>
      (element as HTMLAudioElement).playbackRate
    )).toBe(rate);
  }
  for (const rate of [0.5, 0.75, 1]) {
    await page.keyboard.press("Shift+Period");
    await expect.poll(() => transport.evaluate((element) =>
      (element as HTMLAudioElement).playbackRate
    )).toBe(rate);
  }
  // Clicking another control must not strand the global K transport shortcut.
  // Include a speed change so Stop can also cancel its pending preparation.
  for (const title of ["ギターをソロ", "速度を下げる"]) {
    await page.getByTitle(title, { exact: true }).click();
    await page.keyboard.press("KeyK");
    await expect(page.getByTitle("再生", { exact: true })).toBeVisible();
    await expect.poll(() => transport.evaluate((element) =>
      (element as HTMLAudioElement).paused
    )).toBe(true);
    await page.keyboard.press("KeyK");
    await expect(page.getByTitle("停止", { exact: true })).toBeVisible();
    await expect.poll(() => transport.evaluate((element) =>
      (element as HTMLAudioElement).paused
    )).toBe(false);
  }
  await page.getByTitle("停止").click();
  await expect.poll(() => transport.evaluate((element) =>
    (element as HTMLAudioElement).paused
  )).toBe(true);
  await page.keyboard.press("ArrowRight");
  await expect.poll(() => transport.evaluate((element) =>
    (element as HTMLAudioElement).currentTime
  )).toBeGreaterThan(5);
  const seekTime = await transport.evaluate((element) => (element as HTMLAudioElement).currentTime);
  expect(seekTime).toBeGreaterThan(5);
  await page.keyboard.press("ArrowLeft");
  await expect.poll(() => transport.evaluate((element) =>
    (element as HTMLAudioElement).currentTime
  )).toBeCloseTo(seekTime - 5, 1);
  await expect(page.locator("audio")).toHaveCount(1);

  await page.getByTitle("ライブラリへ戻る").click();
  await expect(page).toHaveURL("/");
  const library = page.getByLabel("Saved MP3 library");
  await expect(library).toContainText("YouTube");

  page.once("dialog", (dialog) => dialog.accept());
  await library.getByTitle("保存済みMP3を削除").click();
  await expect(library.getByText("最初の1曲を読み込もう")).toBeVisible();
});

test("shows stem separation progress and remaining time", async ({ page }) => {
  const now = new Date().toISOString();
  const track = {
    createdAt: now,
    duration: fixtureDurationSeconds,
    id: "e2e-progress-track",
    markerCount: 0,
    markers: [],
    mediaUrl: "/media/e2e-progress.mp3",
    separation: {
      createdAt: now,
      error: null,
      mediaUrl: null,
      progress: {
        completedSegments: 2,
        estimatedRemainingSeconds: 18.5,
        percentage: 40,
        totalSegments: 5
      },
      remainderMediaUrl: null,
      status: "running",
      targetStem: "guitar",
      updatedAt: now
    },
    sourceType: "youtube",
    title: "Progress Track",
    updatedAt: now
  };

  await page.route("**/api/tracks/e2e-progress-track", async (route) => {
    await route.fulfill({
      body: JSON.stringify({ track }),
      contentType: "application/json",
      status: 200
    });
  });
  await page.route(
    "**/api/tracks/e2e-progress-track/beat-grid",
    async (route) => {
      await route.fulfill({
        body: JSON.stringify(createCompletedBeatAnalysis()),
        contentType: "application/json",
        status: 200
      });
    }
  );
  await page.route("**/media/e2e-progress.mp3", async (route) => {
    await route.fulfill({
      body: sourceMp3,
      contentType: "audio/mpeg",
      status: 200
    });
  });

  await page.goto("/tracks/e2e-progress-track");

  const progress = page.getByLabel("音源分離の進捗");

  await expect(progress).toContainText("ギターを分離中 40%");
  await expect(progress).toContainText("2 / 5 セグメント完了");
  await expect(progress).toContainText("残り約19秒");
  await expect(progress.getByRole("progressbar")).toHaveAttribute(
    "aria-valuenow",
    "40"
  );
});

test("converts a real playlist-backed YouTube URL", async ({ page }) => {
  test.skip(
    !runRealYoutubeE2e,
    "Real YouTube conversion is opt-in because GitHub Actions network access to YouTube is slow or flaky."
  );
  test.setTimeout(120_000);

  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Library" })).toBeVisible();

  await page.getByLabel("YouTube URL").fill(realYoutubeUrl);
  await page.getByTitle("YouTubeを変換").click();

  await expect(page).toHaveURL(/\/tracks\/[^/]+$/, { timeout: 90_000 });
  await expect(page.getByLabel("Waveform", { exact: true })).toContainText(
    "ready",
    { timeout: 30_000 }
  );
  await expect(page.getByLabel("Playback speed")).toContainText("1x");
  await expectWaveformCanvas(page);
  await expectInitialPlaybackPosition(page);

  const mediaState = await page
    .locator('audio[aria-label="Original audio"]')
    .evaluate((audioElement) => {
    const audio = audioElement as HTMLAudioElement;

    return {
      duration: audio.duration,
      src: audio.currentSrc
    };
    });

  expect(mediaState.src).toContain("/media/");
  expect(mediaState.duration).toBeGreaterThan(0);

  await page.getByTitle("ライブラリへ戻る").click();
  await expect(page).toHaveURL("/");
  const library = page.getByLabel("Saved MP3 library");
  await expect(library).toContainText("YouTube");

  page.once("dialog", (dialog) => dialog.accept());
  await library.getByTitle("保存済みMP3を削除").click();
  await expect(library.getByText("最初の1曲を読み込もう")).toBeVisible();
});
