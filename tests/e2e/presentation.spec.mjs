import { test, expect } from "./helpers.mjs";

test.use({ contextOptions: { reducedMotion: "no-preference" } });

for (const width of [320, 390, 768, 820, 1024, 1440]) {
  for (const theme of ["light", "dark"]) {
    test(`E2E-085/${width}/${theme} branding and controls fit the viewport`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.clock.setFixedTime(new Date("2026-11-12T12:00:00Z"));
      await page.goto(`/?scoutTheme=${theme}`);
      expect(await page.evaluate(() => matchMedia("(prefers-reduced-motion: reduce)").matches)).toBe(false);
      await expect(page.locator("#event-search")).toBeVisible();
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
      await expect(page.locator(".site-header")).toContainText("Microsoft Events Guide");
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.locator("#event-list").getByRole("link", { name: "Contoso Dev Days 2026 (fixture)" }).click();
      await expect(page.locator("#app-content")).toBeVisible();
      await expect(page.locator(".site-header")).toContainText("DevEx");
      await expect(page.getByText("Rise from friction", { exact: true })).toHaveCount(0);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await expect(page.locator("#event-registration-link")).toBeInViewport();
      const eventBar = await page.locator("#event-bar").boundingBox();
      const identity = await page.locator(".event-identity").boundingBox();
      const eyebrow = await page.locator(".journey-intro .eyebrow").boundingBox();
      expect(identity.y - eventBar.y).toBeLessThanOrEqual(16);
      expect(eyebrow.y - (eventBar.y + eventBar.height)).toBeGreaterThanOrEqual(0);
      expect(eyebrow.y - (eventBar.y + eventBar.height)).toBeLessThanOrEqual(28);
      const notice = page.locator("#event-registration-notice");
      const noticeBounds = await notice.boundingBox();
      const registrationAction = await notice.getByRole("link").boundingBox();
      expect(noticeBounds.x).toBeGreaterThanOrEqual(0);
      expect(noticeBounds.x + noticeBounds.width).toBeLessThanOrEqual(width);
      expect(registrationAction.x).toBeGreaterThanOrEqual(noticeBounds.x);
      expect(registrationAction.x + registrationAction.width).toBeLessThanOrEqual(noticeBounds.x + noticeBounds.width);
      if (width <= 600) {
        const registration = await page.locator("#event-registration-link").boundingBox();
        const switcher = await page.locator(".event-switcher summary").boundingBox();
        const allEvents = await page.locator(".event-switcher > .text-link").boundingBox();
        expect(switcher.y).toBe(registration.y);
        expect(allEvents.y).toBe(registration.y);
      }
      if (width >= 1024) {
        const choices = await page.locator(".journey-choices").boundingBox();
        expect(choices.y + choices.height).toBeLessThanOrEqual(900);
      }
      await page.getByText("Switch event", { exact: true }).click();
      const bounds = await page.locator(".event-switcher-list").boundingBox();
      expect(bounds.x).toBeGreaterThanOrEqual(0);
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(width);
      await page.keyboard.press("Escape");
      await page.getByRole("button", { name: "Save DEV200", exact: true }).click();
      await expect(page.locator("#nav-saved-count")).toHaveText("1");
      await expect(page.locator("#toast")).toBeVisible();
      await expect(page.locator("#toast")).toHaveCSS("pointer-events", "none");
      await page.getByRole("button", { name: "Add DEV200 to custom guide", exact: true }).click();
      await expect(page.locator("#draft-steps textarea")).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.locator("#session-grid .session-card").filter({ hasText: "DEV200" }).getByRole("button", { name: "Session brief" }).click();
      await expect(page.locator("#session-dialog")).toBeVisible();
      const dialog = await page.locator("#session-dialog").boundingBox();
      expect(dialog.x).toBeGreaterThanOrEqual(0);
      expect(dialog.x + dialog.width).toBeLessThanOrEqual(width);
    });
  }
}
