import { expect, test, type Page } from "@playwright/test";

const realYoutubeUrl =
  process.env.MIMICOPY_E2E_YOUTUBE_URL ??
  "https://www.youtube.com/watch?v=OS45uTF_8P0&list=RDOS45uTF_8P0&start_radio=1";
const runRealYoutubeE2e = process.env.MIMICOPY_E2E_REAL_YOUTUBE === "1";

function createToneWavBuffer() {
  const sampleRate = 44_100;
  const durationSeconds = 1;
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

  const mediaState = await page.locator("audio").evaluate((audioElement) => {
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
    duration: 1,
    id: "e2e-youtube-track",
    markerCount: 0,
    markers: [],
    mediaUrl: "/media/e2e-youtube.mp3",
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

  await page.route("**/api/youtube", async (route) => {
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
      body: createToneWavBuffer(),
      contentType: "audio/mpeg",
      status: 200
    });
  });
}

test("loads audio and supports the main playback and marker workflow", async ({
  page
}) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Mimicopy" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Library" })).toBeVisible();

  const fileChooserPromise = page.waitForEvent("filechooser");
  await page.getByTitle("MP3を選択").click();
  const fileChooser = await fileChooserPromise;
  await fileChooser.setFiles({
    buffer: createToneWavBuffer(),
    mimeType: "audio/mpeg",
    name: "e2e-tone.mp3"
  });

  await expect(page).toHaveURL(/\/tracks\/[^/]+$/);
  await expect(page.getByLabel("Waveform", { exact: true })).toContainText(
    "e2e-tone.mp3 を読み込みました。"
  );
  const editor = page.getByLabel("Audio editor");
  await editor.getByTitle("表示名を編集").click();
  await editor.getByLabel("e2e-tone.mp3 display name").fill("Detail practice");
  await editor.getByTitle("表示名を保存").click();
  await expect(
    page.getByRole("heading", { name: "Detail practice" })
  ).toBeVisible();
  const trackId = new URL(page.url()).pathname.split("/").at(-1);

  await expect(page.getByLabel("Playback speed")).toContainText("1x");
  await expect(page.getByLabel("Waveform zoom")).toContainText("1x");
  await expectWaveformCanvas(page);
  await expectInitialPlaybackPosition(page);
  await page.route("**/api/tracks/*/beat-grid", async (route) => {
    await route.fulfill({
      body: JSON.stringify({
        beatGrid: {
          analyzedAt: "2026-07-20T00:00:00.000Z",
          beats: [
            { isDownbeat: true, position: 1, time: 0.25 },
            { isDownbeat: false, position: 2, time: 0.5 },
            { isDownbeat: false, position: 3, time: 0.75 }
          ],
          beatsPerBar: [4],
          downbeats: [0.25],
          source: "madmom"
        }
      }),
      contentType: "application/json",
      status: 200
    });
  });

  const clickTrackControls = page.getByLabel("Click track");
  const clickToggle = page.getByTitle("クリック音をオン/オフ");

  await expect(clickTrackControls).toContainText("No beat grid");
  await expect(clickToggle).toBeDisabled();
  await page.getByTitle("madmomでbeat/downbeatを解析").click();
  await expect(clickTrackControls).toContainText("3 beats / 1 downbeats");
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
  await page.keyboard.press("Shift+Comma");
  await expect(page.getByLabel("Playback speed")).toContainText("0.75x");
  await page.keyboard.press("Shift+Period");
  await expect(page.getByLabel("Playback speed")).toContainText("1x");

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

  expect(trackId).toBeTruthy();
  await page.goto(`/tracks/${trackId}`);
  await expect(page.getByLabel("Playback speed")).toContainText("1x");
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
  await page.getByTitle("YouTubeを変換").click();

  await expect(page).toHaveURL("/tracks/e2e-youtube-track");
  await expect(page.getByLabel("Waveform", { exact: true })).toContainText(
    "Mock YouTube Track を読み込みました。"
  );
  await expect(page.getByLabel("Playback speed")).toContainText("1x");
  await expectWaveformCanvas(page);
  await expectInitialPlaybackPosition(page);

  const mediaState = await page.locator("audio").evaluate((audioElement) => {
    const audio = audioElement as HTMLAudioElement;

    return {
      duration: audio.duration,
      src: audio.currentSrc
    };
  });

  expect(mediaState.src).toContain("/media/e2e-youtube.mp3");
  expect(mediaState.duration).toBeGreaterThan(0);

  await page.getByTitle("ライブラリへ戻る").click();
  await expect(page).toHaveURL("/");
  const library = page.getByLabel("Saved MP3 library");
  await expect(library).toContainText("YouTube");

  page.once("dialog", (dialog) => dialog.accept());
  await library.getByTitle("保存済みMP3を削除").click();
  await expect(library.getByText("保存済みMP3はまだありません")).toBeVisible();
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
    "を読み込みました。",
    { timeout: 30_000 }
  );
  await expect(page.getByLabel("Playback speed")).toContainText("1x");
  await expectWaveformCanvas(page);
  await expectInitialPlaybackPosition(page);

  const mediaState = await page.locator("audio").evaluate((audioElement) => {
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
  await expect(library.getByText("保存済みMP3はまだありません")).toBeVisible();
});
