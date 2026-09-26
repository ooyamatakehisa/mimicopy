import {
  expect,
  test,
  type APIRequestContext,
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
  await expect(page.getByRole("status")).toContainText("2 曲を移動しました。");
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
  await expect(page.getByRole("status")).toContainText("1 曲を移動しました。");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth
    )
  ).toBe(true);
});
