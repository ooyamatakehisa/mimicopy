import {
  expect,
  test,
  type APIRequestContext,
  type Locator,
  type Page
} from "@playwright/test";

async function uploadFixture(request: APIRequestContext, title: string) {
  const response = await request.post("/api/tracks", {
    headers: {
      "Content-Type": "audio/mpeg",
      "X-File-Name": encodeURIComponent(title)
    },
    data: Buffer.from([0x49, 0x44, 0x33, 0])
  });
  expect(response.ok()).toBeTruthy();
  const body = (await response.json()) as { track: { id: string } };
  return body.track.id;
}

async function createFolder(page: Page, name: string) {
  await page.getByRole("button", { name: "新しいフォルダ" }).click();
  await page.getByLabel("フォルダ名", { exact: true }).fill(name);
  await page.getByTitle("フォルダ名を保存").click();
  await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
}

test("organizes tracks across folders, persists navigation, and keeps tracks when deleting folders", async ({
  page,
  request
}) => {
  const suffix = Date.now();
  const firstTitle = `Folder practice A ${suffix}`;
  const secondTitle = `Folder practice B ${suffix}`;
  const firstId = await uploadFixture(request, firstTitle);
  const secondId = await uploadFixture(request, secondTitle);
  const folderA = `Practice ${suffix}`;
  const folderB = `Set list ${suffix}`;
  await page.goto("/");
  await createFolder(page, folderA);
  const folderAUrl = page.url();
  await expect(page.getByText("このフォルダはまだ空です")).toBeVisible();
  await createFolder(page, folderB);
  const folderBUrl = page.url();
  await page
    .getByRole("navigation", { name: "ライブラリのフォルダ" })
    .getByRole("button", { name: /すべての曲/ })
    .click();
  await page.getByLabel("曲を検索").fill(`Folder practice`);
  await page.getByLabel(`${firstTitle} を選択`, { exact: true }).check();
  await page.getByLabel(`${secondTitle} を選択`, { exact: true }).check();
  await page.getByRole("button", { name: "選択した曲を移動" }).click();
  await page.getByLabel("2 曲の移動先").selectOption({ label: folderA });
  await page.getByRole("button", { name: "移動する", exact: true }).click();
  await expect(page.getByRole("status", { name: "移動結果" })).toContainText(
    "2 曲を移動しました。"
  );
  await page.goto(folderAUrl);
  await expect(page.getByTestId(`library-track-${firstId}`)).toBeVisible();
  await expect(page.getByTestId(`library-track-${secondId}`)).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("heading", { name: folderA, exact: true })
  ).toBeVisible();
  await page.getByRole("button", { name: "名前を変更" }).click();
  const renamed = `Guitar ${suffix}`;
  await page.getByLabel("フォルダ名", { exact: true }).fill(renamed);
  await page.getByLabel("フォルダ名", { exact: true }).press("Enter");
  await expect(
    page.getByRole("heading", { name: renamed, exact: true })
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "名前を変更" })).toBeFocused();
  await page
    .getByTestId(`library-track-${firstId}`)
    .getByTitle("フォルダに移動")
    .click();
  await page.getByLabel("1 曲の移動先").selectOption({ label: folderB });
  await page.getByRole("button", { name: "移動する", exact: true }).click();
  await expect(page.getByTestId(`library-track-${firstId}`)).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: renamed, exact: true })
  ).toBeFocused();
  await page.getByRole("navigation").getByTitle(folderB).click();
  await expect(page.getByTestId(`library-track-${firstId}`)).toBeVisible();
  await page.goBack();
  await expect(
    page.getByRole("heading", { name: renamed, exact: true })
  ).toBeVisible();
  await page.goForward();
  await expect(page).toHaveURL(folderBUrl);
  await page
    .getByTestId(`library-track-${firstId}`)
    .getByTitle("フォルダに移動")
    .click();
  await page.getByLabel("1 曲の移動先").selectOption("unfiled");
  await page.getByRole("button", { name: "移動する", exact: true }).click();
  await expect(page.getByText("このフォルダはまだ空です")).toBeVisible();
  await page.goto(folderAUrl);
  page.once("dialog", (dialog) => {
    expect(dialog.message()).toContain("曲は削除されず");
    void dialog.accept();
  });
  await page
    .getByRole("button", { name: "フォルダを削除", exact: true })
    .click();
  await expect(page).toHaveURL(/folder=unfiled/);
  await expect(page.getByTestId(`library-track-${firstId}`)).toBeVisible();
  await expect(page.getByTestId(`library-track-${secondId}`)).toBeVisible();
  await page.reload();
  await expect(page.getByTestId(`library-track-${secondId}`)).toBeVisible();
  await page.goto(folderAUrl);
  await expect(page.getByText("このフォルダは見つかりません")).toBeVisible();
});

async function dragTrack(page: Page, track: Locator, destination: Locator) {
  await track.scrollIntoViewIfNeeded();
  const start = await track.locator("[data-track-link]").boundingBox();
  const end = await destination.boundingBox();
  if (!start || !end)
    throw new Error("Drag source or destination is not visible");
  const x = start.x + start.width / 2;
  const y = start.y + start.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 12, y, { steps: 3 });
  await expect(page.getByTestId("track-drag-preview")).toBeVisible();
  await page.mouse.move(end.x + end.width / 2, end.y + end.height / 2, {
    steps: 12
  });
}

test("drags single and selected tracks into folders and back to unfiled", async ({
  page,
  request
}) => {
  const suffix = Date.now();
  const first = await uploadFixture(request, `Drag A ${suffix}`);
  const second = await uploadFixture(request, `Drag B ${suffix}`);
  const third = await uploadFixture(request, `Drag C ${suffix}`);
  await page.goto("/");
  const folderA = `Drop A ${suffix}`;
  const folderB = `Drop B ${suffix}`;
  await createFolder(page, folderA);
  await createFolder(page, folderB);
  const navigation = page.getByRole("navigation", {
    name: "ライブラリのフォルダ"
  });
  await navigation.getByTitle("すべての曲").click();
  await page.getByLabel("曲を検索").fill(`Drag`);
  const firstRow = page.getByTestId(`library-track-${first}`);
  const secondRow = page.getByTestId(`library-track-${second}`);
  const thirdRow = page.getByTestId(`library-track-${third}`);
  await firstRow.getByRole("checkbox").check();
  await secondRow.getByRole("checkbox").check();

  // An unselected song moves alone, even when other songs are selected.
  await dragTrack(page, thirdRow, navigation.getByTitle(folderA));
  await expect(navigation.getByTitle(folderA)).toHaveAttribute(
    "data-drop-active",
    "true"
  );
  await page.mouse.up();
  await expect(page.getByRole("status", { name: "移動結果" })).toContainText(
    "1 曲を移動しました。"
  );
  await expect(
    page.getByRole("heading", { name: "すべての曲", exact: true })
  ).toBeVisible();
  await expect(thirdRow.getByTitle(folderA, { exact: true })).toBeVisible();
  await expect(firstRow.getByTitle("未分類", { exact: true })).toBeVisible();

  await firstRow.getByRole("checkbox").check();
  await secondRow.getByRole("checkbox").check();
  await dragTrack(page, firstRow, navigation.getByTitle(folderB));
  await expect(page.getByTestId("track-drag-preview")).toContainText(
    "2 曲を移動"
  );
  await page.mouse.up();
  await expect(page.getByRole("status", { name: "移動結果" })).toContainText(
    "2 曲を移動しました。"
  );
  await navigation.getByTitle(folderB).click();
  await expect(firstRow).toBeVisible();
  await expect(secondRow).toBeVisible();
  await page.reload();
  await expect(firstRow).toBeVisible();

  await dragTrack(
    page,
    firstRow,
    navigation.getByTitle("未分類", { exact: true })
  );
  await page.mouse.up();
  await expect(firstRow).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: folderB, exact: true })
  ).toBeFocused();
  await navigation.getByTitle("未分類", { exact: true }).click();
  await expect(firstRow).toBeVisible();
  await expect(secondRow).toHaveCount(0);
});

test("cancels invalid drops and keyboard drags, and retries failed drops", async ({
  page,
  request
}) => {
  const suffix = Date.now();
  const id = await uploadFixture(request, `Drag error ${suffix}`);
  const folder = `Retry ${suffix}`;
  await page.goto("/");
  await createFolder(page, folder);
  const navigation = page.getByRole("navigation", {
    name: "ライブラリのフォルダ"
  });
  await navigation.getByTitle("すべての曲").click();
  await page.getByLabel("曲を検索").fill(`Drag error ${suffix}`);
  const row = page.getByTestId(`library-track-${id}`);
  let moveRequests = 0;
  page.on("request", (request) => {
    if (request.url().endsWith("/api/library/move")) moveRequests++;
  });
  for (const target of ["すべての曲", "未分類"]) {
    await dragTrack(page, row, navigation.getByTitle(target, { exact: true }));
    await expect(
      navigation.getByTitle(target, { exact: true })
    ).not.toHaveAttribute("data-drop-active");
    await page.mouse.up();
    await expect(page.getByTestId("track-drag-preview")).toHaveCount(0);
  }
  await row.locator("[data-drag-handle]").focus();
  await page.keyboard.press("Space");
  await expect(page.getByTestId("track-drag-preview")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("track-drag-preview")).toHaveCount(0);
  expect(moveRequests).toBe(0);

  await page.route("**/api/library/move", (route) =>
    route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({
        error: "移動に失敗しました。もう一度お試しください。"
      })
    })
  );
  await dragTrack(page, row, navigation.getByTitle(folder));
  await page.mouse.up();
  await expect(page.getByRole("alert")).toContainText("移動に失敗しました");
  await expect(row.getByTitle("未分類", { exact: true })).toBeVisible();
  await expect(row).toBeFocused();
  await page.unroute("**/api/library/move");
  await page.getByRole("button", { name: "もう一度試す" }).click();
  await expect(page.getByRole("status", { name: "移動結果" })).toContainText(
    "1 曲を移動しました。"
  );
  await expect(row.getByTitle(folder, { exact: true })).toBeVisible();
});

test("supports keyboard folder creation, errors, cancellation and compact screens", async ({
  page,
  request
}) => {
  const title = `Mobile practice ${Date.now()}`;
  const trackId = await uploadFixture(request, title);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByRole("button", { name: "新しいフォルダ" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByLabel("フォルダ名", { exact: true })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("button", { name: "新しいフォルダ" })
  ).toBeFocused();
  const name = `Mobile ${Date.now()}`;
  await createFolder(page, name);
  await page.getByRole("button", { name: "新しいフォルダ" }).click();
  await page.getByLabel("フォルダ名", { exact: true }).fill(name);
  await page.getByLabel("フォルダ名", { exact: true }).press("Enter");
  await expect(page.getByRole("alert")).toContainText("同じ名前");
  await page.getByLabel("フォルダ名", { exact: true }).press("Escape");
  await page
    .getByLabel("表示するフォルダ", { exact: true })
    .selectOption("all");
  await page.getByLabel("曲を検索").fill(title);
  await page
    .getByTestId(`library-track-${trackId}`)
    .getByTitle("フォルダに移動")
    .click();
  await expect(page.getByLabel("1 曲の移動先")).toBeFocused();
  await page.getByRole("button", { name: "キャンセル", exact: true }).click();
  await expect(
    page.getByTestId(`library-track-${trackId}`).getByTitle("フォルダに移動")
  ).toBeFocused();
  await page
    .getByTestId(`library-track-${trackId}`)
    .getByTitle("フォルダに移動")
    .click();
  await page.getByLabel("1 曲の移動先").selectOption({ label: name });
  await page.route("**/api/library/move", (route) =>
    route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({
        error: "移動に失敗しました。もう一度お試しください。"
      })
    })
  );
  await page.getByRole("button", { name: "移動する", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("もう一度");
  await expect(page.getByLabel("1 曲の移動先")).toHaveValue(/.+/);
  await page.unroute("**/api/library/move");
  await page.getByRole("button", { name: "移動する", exact: true }).click();
  await expect(page.getByRole("status", { name: "移動結果" })).toContainText(
    "1 曲を移動しました。"
  );
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth
    )
  ).toBe(true);
});
