import { test, expect, gotoEvent, addSession, FACTS, shareGuide, recipientContext } from "./helpers.mjs";

test("E2E-033/clipboard-allowed Copy link writes the exact actual permalink", { tag: "@smoke" }, async ({ page, context }, testInfo) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await gotoEvent(page);
  await addSession(page, FACTS.C2);
  const url = await shareGuide(page, testInfo);
  await page.getByRole("button", { name: "Copy link", exact: true }).click();
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(url);
});

test("E2E-077 copied view link restores filters without carrying a private guide", async ({ page, context, browser }, testInfo) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await gotoEvent(page);
  await addSession(page, FACTS.C2);
  const privateURL = await shareGuide(page, testInfo);
  await page.goto(privateURL);
  await expect(page.locator("#shared-guide")).toBeVisible();
  await page.locator("#search").fill("DEV200");
  await expect(page.locator("#session-grid .session-code")).toHaveText(["DEV200"]);
  await page.locator("#share-filters").click();
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  const url = new URL(copied);
  expect(url.searchParams.get("q")).toBe("DEV200");
  expect(url.searchParams.has("guide")).toBe(false);
  expect(url.hash).toBe("#catalog");
  await recipientContext(browser, testInfo, async (page) => {
    await page.goto(copied);
    await expect(page.locator("#session-grid .session-code")).toHaveText(["DEV200"]);
    await expect(page.locator("#shared-guide")).toBeHidden();
    await expect(page.locator("#draft-count")).toHaveText("0 / 20 SESSIONS");
    await expect(page.locator("#nav-saved-count")).toHaveText("0");
  });
});
