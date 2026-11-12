import { test, expect } from "./helpers.mjs";

for (const width of [320, 390, 768, 820, 1024, 1440]) {
  for (const theme of ["light", "dark"]) {
    test(`E2E-085/${width}/${theme} branding and controls fit the viewport`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`/?scoutTheme=${theme}`);
      await expect(page.locator("#event-search")).toBeVisible();
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
      await expect(page.locator(".site-header")).toContainText("Microsoft Events Guide");
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.locator("#event-list").getByRole("link", { name: "Contoso Dev Days 2026 (fixture)" }).click();
      await expect(page.locator("#app-content")).toBeVisible();
      await expect(page.locator(".site-header")).toContainText("DevEx");
      await expect(page.getByText("Rise from friction", { exact: true })).toHaveCount(0);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.getByText("Switch event", { exact: true }).click();
      const bounds = await page.locator(".event-switcher-list").boundingBox();
      expect(bounds.x).toBeGreaterThanOrEqual(0);
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(width);
      await page.keyboard.press("Escape");
      await page.getByRole("button", { name: "Save DEV200", exact: true }).click();
      await expect(page.locator("#nav-saved-count")).toHaveText("1");
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
