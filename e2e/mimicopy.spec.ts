import { expect, test, type Page } from "@playwright/test";

const realYoutubeUrl =
  process.env.MIMICOPY_E2E_YOUTUBE_URL ??
  "https://www.youtube.com/watch?v=OS45uTF_8P0&list=RDOS45uTF_8P0&start_radio=1";

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
  const trackId = new URL(page.url()).pathname.split("/").at(-1);

  await expect(page.getByLabel("Playback speed")).toContainText("1x");
  await expect(page.getByLabel("Waveform zoom")).toContainText("1x");
  await expectWaveformCanvas(page);

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
  await expect(library).toContainText("e2e-tone.mp3");

  page.once("dialog", (dialog) => dialog.accept());
  await library.getByTitle("保存済みMP3を削除").click();
  await expect(library.getByText("保存済みMP3はまだありません")).toBeVisible();
});

test("converts a real playlist-backed YouTube URL", async ({ page }) => {
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
