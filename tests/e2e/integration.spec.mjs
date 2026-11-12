import {
  test, expect, gotoEvent, ready, FACTS, GOLDEN, goldenGuide, addSession,
  saveOccurrence, waitAgenda, captureCalendar, recipientContext,
  shareGuide, expectShared, expectDraft, waitDraft, C, eventPath,
} from "./helpers.mjs";
import { EVENTS } from "./calendar-oracle.mjs";

test("E2E-014 saving both repeats retains two appointments; removing one preserves the other", async ({ page }, testInfo) => {
  await gotoEvent(page);
  await saveOccurrence(page, FACTS.C1a);
  await saveOccurrence(page, FACTS.C1b);
  await waitAgenda(page, ["S100-a", "S100-b"]);
  await captureCalendar(page, page.locator("#export-calendar"), [FACTS.C1a, FACTS.C1b], testInfo);
  await page.locator('#agenda-list [data-focus-key="agenda-remove-S100-a"]').click();
  await waitAgenda(page, ["S100-b"]);
  await page.reload();
  await ready(page);
  await expect(page.locator("#nav-saved-count")).toHaveText("1");
  await captureCalendar(page, page.locator("#export-calendar"), [FACTS.C1b], testInfo, { artifact: "remaining-repeat" });
});

for (const variant of ["root", "wrong-event", "repository-prefix"]) {
  test(`E2E-039/${variant} actual share token opens the correct event`, async ({ page, browser }, testInfo) => {
    await goldenGuide(page);
    const url = new URL(await shareGuide(page, testInfo));
    url.pathname = variant === "wrong-event" ? "/events/fabrikam-summit-2027/" : variant === "repository-prefix" ? "/repo/" : "/";
    await recipientContext(browser, testInfo, async (recipient) => {
      await recipient.goto(url.href);
      await expect(recipient).toHaveURL(new RegExp(`${variant === "repository-prefix" ? "/repo" : ""}/events/${C}/\\?guide=`));
      await expectShared(recipient, GOLDEN);
      await expect(recipient.locator("#nav-saved-count")).toHaveText("0");
    });
  });
}

test("E2E-059 colliding source occurrence IDs produce independently parsed event-scoped UIDs", async ({ page }, testInfo) => {
  await gotoEvent(page);
  await saveOccurrence(page, FACTS.C1a);
  await waitAgenda(page, ["S100-a"]);
  const c = await captureCalendar(page, page.locator("#export-calendar"), [FACTS.C1a], testInfo, { artifact: "contoso" });
  await gotoEvent(page, EVENTS.F.id);
  await saveOccurrence(page, FACTS.F1);
  await waitAgenda(page, ["S100-a"], EVENTS.F.id);
  const f = await captureCalendar(page, page.locator("#export-calendar"), [FACTS.F1], testInfo, {
    artifact: "fabrikam", event: EVENTS.F,
  });
  expect(c.getFirstSubcomponent("vevent").getFirstPropertyValue("uid")).not.toBe(
    f.getFirstSubcomponent("vevent").getFirstPropertyValue("uid"));
});

test("E2E-078 real Back and Forward restore editor, shared view and bookmarked filters", async ({ page }, testInfo) => {
  await goldenGuide(page);
  const url = await shareGuide(page, testInfo);
  await page.goto(`${eventPath()}?q=DEV200&tz=UTC#catalog`);
  await expect(page.locator("#session-grid .session-code")).toHaveText(["DEV200"]);
  await expectDraft(page, GOLDEN);
  await page.goto(url);
  await expectShared(page, GOLDEN);
  await page.goBack();
  await expect(page.locator("#session-grid .session-code")).toHaveText(["DEV200"]);
  await expect(page.locator("#timezone")).toHaveValue("UTC");
  await expectDraft(page, GOLDEN);
  await page.goForward();
  await expectShared(page, GOLDEN);
});

test("E2E-086 sequential deliberate exports produce two complete real files without edits", async ({ page }, testInfo) => {
  await goldenGuide(page);
  for (const artifact of ["first-export", "second-export"]) {
    await captureCalendar(page, page.locator("#export-draft-guide"), [FACTS.C1b, FACTS.C2], testInfo, { artifact });
  }
  await expectDraft(page, GOLDEN);
  await expect(page.locator("#nav-saved-count")).toHaveText("0");
});

test("E2E-088 sequential edits in two tabs restore last durable state on reload", async ({ page, context }) => {
  await gotoEvent(page);
  await addSession(page, FACTS.C2);
  await page.locator("#guide-title").fill("First tab plan");
  const first = {
    version: 2, eventId: C, title: "First tab plan", summary: "",
    steps: [{ session: FACTS.C2, note: "" }],
  };
  await waitDraft(page, first);
  const second = await context.newPage();
  try {
    await gotoEvent(second);
    await expectDraft(second, first);
    await second.locator("#guide-title").fill("Second tab plan");
    const last = { ...first, title: "Second tab plan" };
    await waitDraft(second, last);
    await page.reload();
    await ready(page);
    await expectDraft(page, last);
  } finally {
    await second.close();
  }
});
