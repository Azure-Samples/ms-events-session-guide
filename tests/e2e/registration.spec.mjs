import { test, expect, gotoEvent } from "./helpers.mjs";

const registrationUrl = "https://example.com/contoso-dev-days/register";

test("E2E-090/link event registration opens the configured official site without changing the guide", { tag: "@smoke" }, async ({ page, context }) => {
  await page.clock.setFixedTime(new Date("2026-11-12T12:00:00Z"));
  await gotoEvent(page);
  const navigation = page.getByRole("navigation", { name: "Events", exact: true });
  const link = navigation.getByRole("link", { name: "Register for Contoso Dev Days 2026 (fixture)", exact: true });
  await expect(link).toBeVisible();
  const notice = page.getByRole("complementary", { name: "Event registration", exact: true });
  await expect(notice).toBeVisible();
  await expect(notice.getByRole("heading", { name: "Event registration", exact: true })).toBeVisible();
  await expect(notice).toContainText("Saving sessions here does not register you for the event or reserve a session seat");
  await expect(notice.locator("#event-registration-note")).not.toHaveClass(/sr-only/);
  await expect(notice.getByRole("link")).toHaveAttribute("href", registrationUrl);
  await expect(notice.getByRole("link")).toHaveAttribute("target", "_blank");
  await expect(notice.getByRole("link")).toHaveAttribute("rel", "noopener noreferrer");
  await expect(notice.getByRole("link")).toHaveAccessibleDescription("Opens the event website in a new tab.");
  await expect(link).toHaveAccessibleDescription(/does not register you for the event or reserve a session seat/);
  await expect(link).toHaveAttribute("href", registrationUrl);
  await expect(link).toHaveAttribute("target", "_blank");
  await expect(link).toHaveAttribute("rel", "noopener noreferrer");
  await context.route(registrationUrl, async (route) => {
    expect(route.request().headers().referer).toBeUndefined();
    await route.fulfill({ contentType: "text/html", body: "<title>Official event registration</title>" });
  });
  const opened = context.waitForEvent("page");
  await link.click();
  const popup = await opened;
  await popup.waitForLoadState("domcontentloaded");
  await expect(popup).toHaveURL(registrationUrl);
  await popup.close();
  await expect(page.locator("#nav-saved-count")).toHaveText("0");
  await expect(page.locator("#draft-count")).toHaveText("0 / 20 SESSIONS");
});

test("E2E-090/sticky registration stays available after selecting a guide without covering its heading", async ({ page }) => {
  await page.clock.setFixedTime(new Date("2026-11-12T12:00:00Z"));
  await gotoEvent(page);
  const header = page.locator("#event-header");
  const link = header.locator("#event-registration-link");
  expect(await link.evaluate((element) => Boolean(element.compareDocumentPosition(
    document.querySelector(".event-switcher details")) & Node.DOCUMENT_POSITION_FOLLOWING))).toBe(true);
  await expect(page.locator("main #event-registration")).toHaveCount(0);
  await page.locator('.journey-entry[data-entry="startup"]').click();
  await expect(link).toBeInViewport();
  const headerBounds = await header.boundingBox();
  const headingBounds = await page.locator("#audience-heading").boundingBox();
  expect(headerBounds.y).toBe(0);
  expect(headingBounds.y).toBeGreaterThanOrEqual(headerBounds.y + headerBounds.height);
});

test("E2E-090/absent events without a registration URL have no registration control", async ({ page }) => {
  await gotoEvent(page, "fabrikam-summit-2027");
  await expect(page.locator("#event-registration")).toHaveCount(0);
  await expect(page.locator("#event-registration-notice")).toHaveCount(0);
});

test("E2E-090/past past events offer details rather than advertising active registration", async ({ page }) => {
  await page.clock.setFixedTime(new Date("2026-11-14T05:00:00Z"));
  await gotoEvent(page);
  await expect(page.locator("#event-registration-link")).toHaveText(/Registration details/);
  await expect(page.locator("#event-registration-link")).toHaveAccessibleDescription(/This event has ended/);
  await expect(page.locator("#event-registration-link")).toHaveAttribute("title", /This event has ended/);
  await expect(page.locator("#event-registration-ended")).toBeVisible();
  await expect(page.locator("#event-registration")).not.toContainText("Registration is closed");
});

test("E2E-090/catalog-failure registration remains available when session loading fails", async ({ page }) => {
  await page.route(/\/catalog\.[^/]+\.json$/, (route) => route.fulfill({ status: 503, body: "Unavailable" }));
  await page.goto("/events/contoso-dev-days-2026/");
  await expect(page.locator("#load-error")).toBeVisible();
  await expect(page.locator("#event-registration-link")).toHaveAttribute("href", registrationUrl);
  await expect(page.locator("#event-registration-link")).toBeVisible();
  await expect(page.locator("#event-registration-notice")).toBeVisible();
});

test("E2E-090/repo repository-prefix deployments keep the external registration URL unchanged", async ({ page }) => {
  await page.clock.setFixedTime(new Date("2026-11-12T12:00:00Z"));
  await page.goto("/repo/events/contoso-dev-days-2026/");
  await expect(page.locator("#event-registration-label")).toHaveText("Register");
  await expect(page.locator("#event-registration-link")).toHaveAttribute("href", registrationUrl);
  await expect(page.locator("#event-registration-notice")).toBeVisible();
  await expect(page.locator("#event-registration-note")).toContainText("does not register you for the event");
});

test("E2E-090/ignite Ignite uses the verified year-specific registration destination", async ({ page }) => {
  await page.clock.setFixedTime(new Date("2026-11-18T12:00:00Z"));
  await page.goto("/real/events/ignite-2026/");
  await expect(page.locator("#event-registration-link")).toHaveAccessibleName("Register for Microsoft Ignite 2026");
  await expect(page.locator("#event-registration-link")).toHaveAttribute("href", "https://aka.ms/MSIgniteFY27RegNow");
  await expect(page.locator("#event-registration-link")).toBeInViewport();
  const eventBar = await page.locator("#event-bar").boundingBox();
  const eyebrow = await page.locator(".journey-intro .eyebrow").boundingBox();
  expect(eyebrow.y - (eventBar.y + eventBar.height)).toBeGreaterThanOrEqual(0);
  expect(eyebrow.y - (eventBar.y + eventBar.height)).toBeLessThanOrEqual(28);
});

test.describe("registration without JavaScript", () => {
  test.use({ javaScriptEnabled: false });
  test("E2E-090/no-javascript the registration link does not depend on the session application", async ({ page }) => {
    await page.goto("/events/contoso-dev-days-2026/");
    await expect(page.locator("#event-registration-link")).toBeVisible();
    await expect(page.locator("#event-registration-link")).toHaveAttribute("href", registrationUrl);
  });
});
