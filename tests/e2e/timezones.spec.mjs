import { test, expect, gotoEvent, findSession, captureCalendar, FACTS, F } from "./helpers.mjs";
import { EVENTS } from "./calendar-oracle.mjs";

const expectedTimes = {
  "America/Chicago": ["Sunday, Mar 14", "1:30 AM - 3:30 AM CDT"],
  "America/New_York": ["Sunday, Mar 14", "3:30 AM - 4:30 AM EDT"],
  "America/Los_Angeles": ["Saturday, Mar 13", "11:30 PM - Mar 14, 12:30 AM PST"],
  UTC: ["Sunday, Mar 14", "7:30 AM - 8:30 AM UTC"],
};

for (const browserZone of ["America/New_York", "America/Los_Angeles", "UTC"]) {
  test.describe(`Browser zone ${browserZone}`, () => {
    test.use({ timezoneId: browserZone });
    for (const choice of ["America/Chicago", "local", "UTC"]) {
      test(`E2E-057/${choice} display conversion preserves actual exported UTC instants`, async ({ page }, testInfo) => {
        await gotoEvent(page, F);
        await page.locator("#timezone").selectOption(choice);
        const session = await findSession(page, "FAB200");
        await session.getByRole("button", { name: "Session brief", exact: true }).click();
        const row = page.locator("#session-dialog .occurrence").filter({
          has: page.locator('[data-save-instance="S200-a"]'),
        });
        const [date, times] = expectedTimes[choice === "local" ? browserZone : choice];
        await expect(row.locator(".occurrence-info strong")).toHaveText(date);
        await expect(row.locator(".occurrence-info")).toContainText(
          choice === "local" && browserZone === "America/Los_Angeles" ?
            /11:30 PM - Mar 14(?:,| at) 12:30 AM PST · 60 min/ : `${times} · 60 min`);
        await captureCalendar(page, row.getByRole("button", { name: /Download calendar event/ }),
          [FACTS.FDST], testInfo, { event: EVENTS.F });
      });
    }
  });
}
