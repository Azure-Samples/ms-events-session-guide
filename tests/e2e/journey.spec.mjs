import {
  test, expect, GOLDEN, goldenGuide, shareGuide, recipientContext,
  expectShared, captureCalendar, FACTS, waitAgenda, ready,
} from "./helpers.mjs";

test("E2E-001 author guide to download to independent recipient to durable agenda", { tag: "@smoke" }, async ({ page, browser }, testInfo) => {
  await goldenGuide(page);
  await captureCalendar(page, page.locator("#export-draft-guide"), [FACTS.C1b, FACTS.C2], testInfo, {
    name: GOLDEN.title, artifact: "author-guide",
  });
  const url = await shareGuide(page, testInfo);
  await recipientContext(browser, testInfo, async (recipient) => {
    await recipient.goto(url);
    await expectShared(recipient, GOLDEN);
    await expect(recipient.locator("#nav-saved-count")).toHaveText("0");
    await captureCalendar(recipient, recipient.locator("#export-shared-guide"), [FACTS.C1b, FACTS.C2], testInfo, {
      name: GOLDEN.title, artifact: "recipient-guide",
    });
    await recipient.locator("#save-shared-agenda").click();
    await waitAgenda(recipient, ["S100-b", "S200-a", "S400-a"]);
    await recipient.reload();
    await ready(recipient);
    await expectShared(recipient, GOLDEN);
    await expect(recipient.locator("#nav-saved-count")).toHaveText("3");
    await expect(recipient.locator("#agenda-list article")).toHaveCount(3);
    await expect(recipient.locator("#agenda-list")).toContainText("Contoso keynote");
    await expect(recipient.locator("#agenda-list")).toContainText("Shipping small");
    await expect(recipient.locator("#agenda-list")).toContainText("Unscheduled lab");
    await captureCalendar(recipient, recipient.locator("#export-calendar"), [FACTS.C1b, FACTS.C2], testInfo, {
      artifact: "recipient-agenda",
    });
  });
  await expect(page.locator("#nav-saved-count")).toHaveText("0");
  await expect(page.locator("#guide-title")).toHaveValue(GOLDEN.title);
});
