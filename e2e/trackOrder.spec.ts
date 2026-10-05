import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

test.use({ hasTouch: true });

async function fixture(request: APIRequestContext) {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const folderResponse = await request.post("/api/folders", { data: { name: `Order ${suffix}` } });
  expect(folderResponse.ok()).toBeTruthy();
  const { folder } = await folderResponse.json() as { folder: { id: string } };
  const tracks: { id: string; title: string }[] = [];
  for (const name of ["朝の練習曲", "Guitar solo", "アンコールの長い曲名を最後まで確認して並べ替える"]) {
    const title = `${name} ${suffix}`;
    const response = await request.post("/api/tracks", {
      headers: { "Content-Type": "audio/mpeg", "X-File-Name": encodeURIComponent(title) },
      data: Buffer.from([0x49, 0x44, 0x33, 0])
    });
    expect(response.ok()).toBeTruthy();
    const { track } = await response.json() as { track: { id: string } };
    tracks.unshift({ id: track.id, title });
  }
  const move = await request.put("/api/library/move", { data: { folderId: folder.id, trackIds: tracks.map((track) => track.id) } });
  expect(move.ok()).toBeTruthy();
  return { tracks, url: `/?folder=${folder.id}` };
}
async function expectOrder(page: Page, ids: string[], editing = false) {
  const prefix = editing ? "order-track-" : "library-track-";
  await expect.poll(() => page.locator(`[data-testid^="${prefix}"]`).evaluateAll((rows) => rows.map((row) => row.getAttribute("data-testid")))).toEqual(ids.map((id) => `${prefix}${id}`));
}
async function drag(page: Page, sourceId: string, targetId: string) {
  const start = await page.getByTestId(`order-track-${sourceId}`).locator("[data-drag-handle]").boundingBox();
  const end = await page.getByTestId(`order-track-${targetId}`).boundingBox();
  if (!start || !end) throw new Error("Missing order rows");
  await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2);
  await page.mouse.down();
  await page.mouse.move(start.x + start.width / 2 + 12, start.y + start.height / 2, { steps: 3 });
  await page.mouse.move(end.x + end.width / 2, end.y + end.height / 2, { steps: 12 });
  await expect(page.getByTestId(`order-track-${targetId}`)).toHaveAttribute("data-drop-active", "true");
}

test("saves drag and keyboard ordering, preserves focus, cancels and survives reload and rename", async ({ page, request }, testInfo) => {
  const { tracks: [a, b, c], url } = await fixture(request);
  await page.goto(url);
  await expectOrder(page, [a.id, b.id, c.id]);
  await page.getByRole("button", { name: "並べ替え", exact: true }).click();
  await expect(page.getByRole("heading", { name: "曲順を並べ替え" })).toBeFocused();
  await expect(page.getByRole("button", { name: "曲順を保存", exact: true })).toBeDisabled();
  const up = page.getByTitle(`${c.title} を上へ`, { exact: true });
  await up.focus();
  await up.press("Enter");
  await expectOrder(page, [a.id, c.id, b.id], true);
  await expect(up).toBeFocused();
  await up.press("Space");
  await expectOrder(page, [c.id, a.id, b.id], true);
  await expect(up).toBeFocused();
  await expect(up).toHaveAttribute("aria-disabled", "true");
  await drag(page, c.id, b.id);
  await page.mouse.up();
  await expectOrder(page, [a.id, b.id, c.id], true);
  await drag(page, c.id, a.id);
  await page.keyboard.press("Escape");
  await page.mouse.up();
  await expectOrder(page, [a.id, b.id, c.id], true);
  await drag(page, c.id, a.id);
  await page.mouse.up();
  await expectOrder(page, [c.id, a.id, b.id], true);
  await page.screenshot({ path: testInfo.outputPath("desktop-track-order.png"), fullPage: true });
  await page.getByRole("button", { name: "曲順を保存", exact: true }).click();
  await expectOrder(page, [c.id, a.id, b.id]);
  await expect(page.getByRole("button", { name: "並べ替え", exact: true })).toBeFocused();
  await page.reload();
  await expectOrder(page, [c.id, a.id, b.id]);
  const row = page.getByTestId(`library-track-${b.id}`);
  await row.getByTitle("表示名を編集").click();
  await row.getByLabel(`${b.title} display name`).fill("Renamed last song");
  await row.getByTitle("表示名を保存").click();
  await expect(row).toContainText("Renamed last song");
  await expectOrder(page, [c.id, a.id, b.id]);
  await page.getByLabel("曲を検索").fill("Renamed");
  await expect(page.getByRole("button", { name: "並べ替え", exact: true })).toBeDisabled();
  await page.getByLabel("曲を検索").fill("");
  await page.getByRole("button", { name: "並べ替え", exact: true }).click();
  await page.getByTitle(`${c.title} を下へ`, { exact: true }).click();
  await page.getByRole("button", { name: "キャンセル", exact: true }).click();
  await expectOrder(page, [c.id, a.id, b.id]);
  await expect(page.getByRole("button", { name: "並べ替え", exact: true })).toBeFocused();
});

test("orders on mobile and recovers from save failures and concurrent list changes", async ({ page, request }, testInfo) => {
  const { tracks: [a, b, c], url } = await fixture(request);
  await page.setViewportSize({ width: 320, height: 740 });
  await page.goto(url);
  await page.getByRole("button", { name: "並べ替え", exact: true }).tap();
  await page.getByTitle(`${c.title} を上へ`, { exact: true }).tap();
  await expectOrder(page, [a.id, c.id, b.id], true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(320);
  await page.screenshot({ path: testInfo.outputPath("mobile-track-order.png"), fullPage: true });
  await page.route("**/api/library/order", (route) => route.fulfill({
    status: 503, contentType: "application/json", body: JSON.stringify({ error: "一時的に保存できません。もう一度お試しください。" })
  }));
  await page.getByRole("button", { name: "曲順を保存", exact: true }).tap();
  await expect(page.getByRole("alert")).toContainText("一時的に保存できません");
  await expectOrder(page, [a.id, c.id, b.id], true);
  await page.unroute("**/api/library/order");
  await page.getByRole("button", { name: "曲順を保存", exact: true }).tap();
  await expectOrder(page, [a.id, c.id, b.id]);
  await page.reload();
  await expectOrder(page, [a.id, c.id, b.id]);
  await page.getByRole("button", { name: "並べ替え", exact: true }).tap();
  await page.getByTitle(`${b.title} を上へ`, { exact: true }).tap();
  expect((await request.put("/api/library/move", { data: { trackIds: [a.id], folderId: null } })).ok()).toBeTruthy();
  await page.getByRole("button", { name: "曲順を保存", exact: true }).tap();
  await expect(page.getByRole("alert")).toContainText("編集中に曲の一覧が変更されました");
  await page.getByRole("button", { name: "一覧に戻る", exact: true }).tap();
  await expectOrder(page, [c.id, b.id]);
});
