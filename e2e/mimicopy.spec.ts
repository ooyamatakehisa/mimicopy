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
  await expect(page.getByLabel("Audio editor", { exact: true })).toContainText(
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

async function mockYoutubeConversion(page: Page, title = "Mock YouTube Track") {
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
    title,
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
}, testInfo) => {
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
  await expect(page.getByTitle("再生", { exact: true })).toBeEnabled();
  await expect(page.getByText("e2e-tone.mp3 を読み込みました。")).toHaveCount(0);
  const editor = page.getByLabel("Audio editor");
  await editor.getByTitle("表示名を編集").click();
  await editor.getByLabel("e2e-tone.mp3 display name").fill("Detail practice");
  await editor.getByTitle("表示名を保存").click();
  await expect(
    page.getByRole("heading", { name: "Detail practice" })
  ).toBeVisible();
  const trackId = new URL(page.url()).pathname.split("/").at(-1);

  await expect(page.getByLabel("Playback speed").locator("strong")).toHaveText("1x");
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
    await expect(page.getByLabel("Playback speed").locator("strong")).toHaveText(speed);
  }
  for (const speed of ["0.5x", "0.75x", "1x"]) {
    await page.keyboard.press("Shift+Period");
    await expect(page.getByLabel("Playback speed").locator("strong")).toHaveText(speed);
  }

  await page.getByTitle("半音上げる").click();
  await expect(page.getByLabel("Transpose")).toContainText("+1");
  await expect(page.getByTitle("再生", { exact: true })).toBeEnabled();
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
  await expect(page.getByTitle("再生", { exact: true })).toBeEnabled();
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
  await page.setViewportSize({ width: 320, height: 568 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(320);
  await page.getByLabel("Marker 1 label").fill("Practice cue");
  await expect(page.getByLabel("Practice cue time")).toHaveValue("0:00");
  await page.screenshot({ path: testInfo.outputPath("mobile-marker-320.png"), fullPage: true });
  await page.getByTitle("マーカー削除").click();
  await expect(page.getByText("No markers")).toBeVisible();
  await page.setViewportSize({ width: 1280, height: 720 });
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
  await page.keyboard.press("Alt+Enter");
  await expect(page.getByText("No markers")).toBeVisible();

  expect(trackId).toBeTruthy();
  await page.goto(`/tracks/${trackId}`);
  await expect(page.getByLabel("Playback speed").locator("strong")).toHaveText("1x");
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
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
  await page.screenshot({ path: testInfo.outputPath("mobile-library.png"), fullPage: true });

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
  await expect(page.getByTitle("再生", { exact: true })).toBeEnabled();
  await expect(page.getByText("Mock YouTube Track を読み込みました。")).toHaveCount(0);
  await expect(page.getByLabel("Playback speed").locator("strong")).toHaveText("1x");
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
  // Focused mixer controls must not steal playback shortcuts. The audio audit
  // separately measures output; this UI test never substitutes media clocks.
  await mixer.getByTitle("ギターをソロ").click();
  for (const channel of ["原音", "ギター", "ギター以外"]) {
    for (const action of ["ソロ", "ミュート"]) {
      const button = mixer.getByTitle(`${channel}を${action}`);
      await button.focus();
      await page.keyboard.press("Space");
      await expect(button).toHaveAttribute("aria-pressed", "false");
      await expect(page.getByTitle("再生", { exact: true })).toBeVisible();
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
  await expect(page.getByLabel("Playback preparation")).toHaveCount(0);
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
  await expect(page.getByTitle("再生", { exact: true })).toBeEnabled({ timeout: 30_000 });
  await expect(page.getByLabel("Playback speed").locator("strong")).toHaveText("1x");
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


test.describe("mobile track editor", () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test("keeps playback above the fold and discloses mixer controls", async ({ page }, testInfo) => {
    await mockYoutubeConversion(page, "Evening guitar practice — とても長い曲名でも再生操作にすぐアクセスできるモバイル表示");
    await page.goto("/tracks/e2e-youtube-track");
    const play = page.getByTitle("再生", { exact: true });
    const waveform = page.getByRole("slider", { name: "再生位置" });
    const mixer = page.getByLabel("Audio mixer", { exact: true });
    const toggle = mixer.getByRole("button", { name: "Audio mixer", exact: true });
    await expect(play).toBeEnabled();
    await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
    const heading = await page.getByLabel("曲の情報").boundingBox();
    expect(heading?.height).toBeLessThan(90);
    await expectWaveformCanvas(page);
    await expect(page.getByLabel("Waveform", { exact: true })).not.toContainText("ready");
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await expect(mixer.getByTitle("原音をミュート")).toBeHidden();

    for (const viewport of [{ width: 390, height: 844 }, { width: 320, height: 568 }, { width: 844, height: 390 }]) {
      await page.setViewportSize(viewport);
      const waveBounds = await waveform.boundingBox();
      const playBounds = await play.boundingBox();
      const mixerBounds = await mixer.boundingBox();
      if (!waveBounds || !playBounds || !mixerBounds) throw new Error("Missing mobile controls");
      expect(waveBounds.height).toBeLessThanOrEqual(viewport.width < 640 ? 180 : 260);
      if (viewport.height > viewport.width) expect(playBounds.y + playBounds.height).toBeLessThan(viewport.height);
      expect(playBounds.y).toBeLessThan(mixerBounds.y);
      expect(mixerBounds.height).toBeLessThan(80);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(viewport.width);
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await toggle.tap();
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    for (const channel of ["原音", "ギター", "ギター以外"]) {
      const mute = mixer.getByTitle(`${channel}をミュート`);
      await expect(mute).toBeEnabled();
      const bounds = await mute.boundingBox();
      expect(bounds?.height).toBeGreaterThanOrEqual(44);
      await mute.tap();
      await expect(mute).toHaveAttribute("aria-pressed", "true");
      await mute.tap();
      await expect(mute).toHaveAttribute("aria-pressed", "false");
      await expect(mixer.getByRole("link", { name: `${channel}をダウンロード` })).toBeVisible();
    }
    await page.setViewportSize({ width: 320, height: 568 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(320);
    await page.setViewportSize({ width: 390, height: 844 });
    await mixer.getByLabel("原音の音量").fill("40");
    await toggle.tap();
    await toggle.tap();
    await expect(mixer.getByLabel("原音の音量")).toHaveValue("40");
    await toggle.focus();
    await page.keyboard.press("Alt+Enter");
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: testInfo.outputPath("mobile.png"), fullPage: true });
    await page.setViewportSize({ width: 1440, height: 1000 });
    await expect(toggle).toBeHidden();
    await expect(mixer.getByTitle("原音をミュート")).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("desktop.png"), fullPage: true });
  });

  test("seeks on a short tap but leaves scrolling, holds and pinches alone", async ({ page, context }) => {
    await mockYoutubeConversion(page);
    await page.goto("/tracks/e2e-youtube-track");
    await expect(page.getByTitle("再生", { exact: true })).toBeEnabled();
    const waveform = page.getByRole("slider", { name: "再生位置" });
    const bounds = await waveform.boundingBox();
    if (!bounds) throw new Error("Missing waveform");
    const x = bounds.x + bounds.width * 0.27;
    const y = bounds.y + bounds.height * 0.5;
    await page.touchscreen.tap(x, y);
    await expect(waveform).toHaveAttribute("aria-valuenow", "5");
    const client = await context.newCDPSession(page);
    const start = async (points = [{ x: x + 80, y }]) => client.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: points });
    const end = async () => client.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });

    await start();
    await expect(waveform).toHaveAttribute("aria-valuenow", "5");
    await page.waitForTimeout(400);
    await end();
    await expect(waveform).toHaveAttribute("aria-valuenow", "5");

    // A native browser touch swipe must scroll the document without seeking.
    await start();
    for (const distance of [20, 40, 60, 80, 100]) {
      await client.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: x + 80, y: y - distance }] });
    }
    await end();
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(30);
    await expect(waveform).toHaveAttribute("aria-valuenow", "5");
    await page.evaluate(() => window.scrollTo(0, 0));

    // Browser cancellation and multi-touch cannot become seek gestures.
    await start();
    await client.send("Input.dispatchTouchEvent", { type: "touchCancel", touchPoints: [] });
    await expect(waveform).toHaveAttribute("aria-valuenow", "5");
    await start([{ x, y }, { x: x + 80, y }]);
    await client.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: x - 10, y }, { x: x + 90, y }] });
    await end();
    await expect(waveform).toHaveAttribute("aria-valuenow", "5");

    await expect(page.getByLabel("Waveform zoom")).toContainText("1.25x");
    await page.getByTitle("波形を縮小", { exact: true }).tap();
    await page.evaluate(() => window.scrollTo(0, 0));

    // A drag that returns to its origin is not a tap, including mouse input.
    await page.mouse.move(x + 60, y);
    await page.mouse.down();
    await page.mouse.move(x + 90, y);
    await page.mouse.move(x + 60, y);
    await page.mouse.up();
    await expect(waveform).toHaveAttribute("aria-valuenow", "5");
    await page.mouse.click(x + 60, y, { button: "right" });
    await expect(waveform).toHaveAttribute("aria-valuenow", "5");
    await page.mouse.click(x + 60, y);
    await expect(waveform).not.toHaveAttribute("aria-valuenow", "5");
    await page.touchscreen.tap(x, y);
    await expect(waveform).toHaveAttribute("aria-valuenow", "5");
  });
  test("pans zoomed audio horizontally without seeking and keeps vertical scrolling", async ({ page, context }) => {
    await mockYoutubeConversion(page);
    await page.goto("/tracks/e2e-youtube-track");
    await expect(page.getByTitle("再生", { exact: true })).toBeEnabled();
    const waveform = page.getByRole("slider", { name: "再生位置" });
    const box = await waveform.boundingBox();
    if (!box) throw new Error("Missing waveform");
    const x = box.x + box.width / 2, y = box.y + box.height / 2;
    const client = await context.newCDPSession(page);
    await client.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: x - 40, y }, { x: x + 40, y }] });
    await client.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: x - 80, y }, { x: x + 80, y }] });
    await client.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await expect(page.getByLabel("Waveform zoom")).toContainText("2x");
    const range = page.getByLabel("波形の表示範囲");
    await expect(range).toHaveText("0:00 – 0:10");
    const swipe = async (dx: number, dy: number) => {
      await client.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: x + 70, y }] });
      for (const fraction of [0.25, 0.5, 0.75, 1]) {
        await client.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: x + 70 + dx * fraction, y: y + dy * fraction }] });
      }
      await client.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    };
    await swipe(-120, 0);
    await expect(range).not.toHaveText("0:00 – 0:10");
    await expect(waveform).toHaveAttribute("aria-valuenow", "0");
    await expect(page.getByTitle("再生位置を追従")).toHaveAttribute("aria-pressed", "false");
    const inspectedRange = await range.textContent();
    await page.getByTitle("再生", { exact: true }).tap();
    await expect(page.getByTitle("停止", { exact: true })).toBeVisible();
    await expect.poll(() => page.locator("audio").evaluate((audio) => (audio as HTMLAudioElement).currentTime)).toBeGreaterThan(0.3);
    await expect(range).toHaveText(inspectedRange ?? "");
    await page.getByTitle("停止", { exact: true }).tap();
    await page.evaluate(() => window.scrollTo(0, 0));
    await swipe(0, -90);
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(20);
    await expect(range).toHaveText(inspectedRange ?? "");
    await page.getByTitle("波形を右へ").click();
    await page.getByTitle("波形を右へ").click();
    await expect(page.getByTitle("波形を右へ")).toBeDisabled();
    await expect(range).toHaveText("0:10 – 0:20");
    await waveform.focus();
    await page.keyboard.press("Shift+ArrowLeft");
    await expect(range).toHaveText("0:05 – 0:15");
    await page.getByTitle("再生位置を追従").tap();
    await expect(range).toHaveText("0:00 – 0:10");
    await expect(page.getByTitle("再生位置を追従")).toHaveAttribute("aria-pressed", "true");
  });

  test("selects slower and faster rates by touch and changes the actual media clock", async ({ page }) => {
    await mockYoutubeConversion(page);
    await page.goto("/tracks/e2e-youtube-track");
    await expect(page.getByTitle("再生", { exact: true })).toBeEnabled();
    const speed = page.getByLabel("Playback speed");
    await speed.getByRole("button", { name: "0.25x", exact: true }).tap();
    await page.getByTitle("再生", { exact: true }).tap();
    for (const rate of [0.25, 0.5, 0.75, 1, 0.5, 1]) {
      await speed.getByRole("button", { name: `${rate}x`, exact: true }).tap();
      await expect(speed.getByRole("button", { name: `${rate}x`, exact: true })).toHaveAttribute("aria-pressed", "true");
      await expect(page.getByLabel("Playback preparation", { exact: true })).toHaveCount(0, { timeout: 16000 });
      await expect.poll(() => page.locator("audio").evaluate((element) => {
        const audio = element as HTMLAudioElement;
        return audio.paused ? 0 : audio.playbackRate;
      })).toBe(rate);
      const sample = () => page.locator("audio").evaluate((element) => ({
        time: (element as HTMLAudioElement).currentTime, wall: performance.now()
      }));
      const before = await sample();
      await page.waitForTimeout(800);
      const after = await sample();
      expect(Math.abs((after.time - before.time) / ((after.wall - before.wall) / 1000) - rate)).toBeLessThan(0.08);
    }
    await page.getByTitle("停止", { exact: true }).tap();
  });

});

async function mockPlaybackQueue(page: Page) {
  const tracks = ["first", "outside", "last"].map((id) => ({
    id, title: `Queue ${id}`, folderId: id === "outside" ? null : "practice",
    createdAt: "2026-10-01T00:00:00Z", updatedAt: "2026-10-01T00:00:00Z",
    duration: fixtureDurationSeconds, mediaUrl: `/media/queue-${id}.mp3`,
    markerCount: 1, markers: [{ id: "near-end", label: "Ending", time: 19 }],
    sourceType: "upload", separation: id === "last" ? {
      createdAt: "2026-10-01T00:00:00Z", updatedAt: "2026-10-01T00:00:00Z",
      status: "completed", targetStem: "guitar", error: null, progress: null,
      mediaUrl: "/media/queue-stem.mp3", remainderMediaUrl: "/media/queue-remainder.mp3"
    } : null
  }));
  await page.route("**/api/folders", (route) => route.fulfill({ json: { folders: [{ id: "practice", name: "練習" }] } }));
  await page.route("**/api/tracks", (route) => route.fulfill({ json: { tracks } }));
  await page.route(/\/api\/tracks\/(first|outside|last)$/, (route) => {
    const track = tracks.find((item) => route.request().url().endsWith(`/${item.id}`));
    return route.fulfill({ json: { track } });
  });
  await page.route("**/api/tracks/*/beat-grid", (route) => route.fulfill({ json: createCompletedBeatAnalysis() }));
  await page.route("**/api/tracks/last/mixer", async (route) => {
    // Make original audio/graph arrive before the multichannel replacement.
    await new Promise((resolve) => setTimeout(resolve, 500));
    await route.fulfill({ json: { mediaUrl: "/media/queue-mixer.wav" } });
  });
  await page.route("**/media/queue-*", async (route) => {
    const isMixer = route.request().url().endsWith(".wav");
    const buffer = isMixer ? mixerWav : sourceMp3;
    const range = /^bytes=(\d+)-(\d*)$/.exec(route.request().headers().range ?? "");
    const start = range ? Number(range[1]) : 0;
    const end = range?.[2] ? Math.min(Number(range[2]), buffer.length - 1) : buffer.length - 1;
    await route.fulfill({
      body: buffer.subarray(start, end + 1), contentType: isMixer ? "audio/wav" : "audio/mpeg",
      status: range ? 206 : 200,
      headers: { "accept-ranges": "bytes", ...(range ? { "content-range": `bytes ${start}-${end}/${buffer.length}` } : {}) }
    });
  });
}

async function playEnding(page: Page) {
  await expect(page.getByTitle("再生", { exact: true })).toBeEnabled();
  await page.getByTitle("マーカーへ移動", { exact: true }).click();
  await expect(page.getByLabel("Playback preparation")).toHaveCount(0);
  await page.getByTitle("再生", { exact: true }).click();
}

for (const scope of ["all", "folder", "search"] as const) {
  test(`auto-advances in the entered ${scope} list and preserves local preference`, async ({ page }, testInfo) => {
    await mockPlaybackQueue(page);
    await page.goto(scope === "folder" ? "/?folder=practice" : "/");
    if (scope === "search") await page.getByLabel("曲を検索").fill("Queue first");
    await page.getByTitle("Queue first を開く", { exact: true }).click();
    const setting = page.getByRole("checkbox", { name: "次の曲を自動再生", exact: true });
    await expect(setting).not.toBeChecked();
    await setting.check();
    await page.reload();
    await expect(setting).toBeChecked();
    await expect(page.getByTitle("再生", { exact: true })).toBeEnabled();
    await expect.poll(() => page.locator("audio").evaluate((audio: HTMLAudioElement) => audio.paused)).toBe(true);
    if (scope === "folder") {
      await page.setViewportSize({ width: 1440, height: 1000 });
      await page.screenshot({ path: testInfo.outputPath("auto-next-desktop.png"), fullPage: true });
      await page.setViewportSize({ width: 390, height: 844 });
      await page.screenshot({ path: testInfo.outputPath("auto-next-mobile.png"), fullPage: true });
      await page.setViewportSize({ width: 1440, height: 1000 });
    }
    await playEnding(page);
    if (scope === "search") {
      await expect(page.getByTitle("再生", { exact: true })).toBeVisible();
      await expect(page).toHaveURL(/\/tracks\/first$/);
      return;
    }
    const next = scope === "folder" ? "last" : "outside";
    await expect(page).toHaveURL(new RegExp(`/tracks/${next}$`));
    await expect(page.getByTitle("停止", { exact: true })).toBeVisible();
    await expect.poll(() => page.locator("audio").evaluate((audio: HTMLAudioElement) => audio.currentTime)).toBeGreaterThan(0.3);
    await expect(page.locator("audio")).toHaveCount(1);
    // The automatic request is consumed: reload/back must not restart audio.
    await page.reload();
    await expect(page.getByTitle("再生", { exact: true })).toBeEnabled();
    await expect.poll(() => page.locator("audio").evaluate((audio: HTMLAudioElement) => audio.paused)).toBe(true);
    if (scope === "folder") {
      await expect(page.getByText("練習の最後の曲です。再生後に停止します。")).toBeVisible();
      await expect(page.getByTitle("ギターをソロ", { exact: true })).toBeEnabled();
      await playEnding(page);
      try {
        await expect(page.getByTitle("再生", { exact: true })).toBeVisible();
      } catch (error) {
        await testInfo.attach("final-track-media-state", { contentType: "application/json", body: JSON.stringify(await page.locator("audio").evaluate((audio: HTMLAudioElement) => ({
          src: audio.currentSrc, currentTime: audio.currentTime, duration: audio.duration,
          paused: audio.paused, ended: audio.ended, seeking: audio.seeking, readyState: audio.readyState,
          rate: audio.playbackRate, error: audio.error?.message
        }))) });
        throw error;
      }
      await expect(page).toHaveURL(/\/tracks\/last$/);
      await page.getByTitle("ライブラリへ戻る").click();
      await expect(page).toHaveURL(/\?folder=practice$/);
    } else {
      await setting.uncheck();
      await playEnding(page);
      await expect(page.getByTitle("再生", { exact: true })).toBeVisible();
      await expect(page).toHaveURL(/\/tracks\/outside$/);
    }
  });
}
