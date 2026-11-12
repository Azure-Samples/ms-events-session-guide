import { deflateSync } from "node:zlib";
import {
  test, expect, C, FACTS, GOLDEN, eventPath, ready, card, goldenGuide,
  saveOccurrence, addSession, waitAgenda, waitDraft, expectDraft, expectShared,
  recipientContext, observeContext, guardTelemetry, independentSharePayload,
} from "./helpers.mjs";

function contextOptions(testInfo) {
  const options = { acceptDownloads: true };
  for (const key of ["baseURL", "viewport", "screen", "isMobile", "hasTouch",
    "userAgent", "deviceScaleFactor", "locale", "timezoneId", "colorScheme"]) {
    if (testInfo.project.use[key] !== undefined) options[key] = testInfo.project.use[key];
  }
  return options;
}

test("E2E-019 real persistent-profile browser restart restores only that profile", async ({ browser }, testInfo) => {
  test.setTimeout(90_000);
  const profile = testInfo.outputPath("profile");
  const options = {
    ...testInfo.project.use.launchOptions,
    ...contextOptions(testInfo),
    headless: testInfo.project.use.headless ?? true,
  };
  const withProfile = async (run) => {
    const context = await browser.browserType().launchPersistentContext(profile, options);
    const problems = observeContext(context);
    try {
      await guardTelemetry(context, problems);
      const page = context.pages()[0] || await context.newPage();
      await run(page);
    } finally {
      await context.close();
      expect(problems, "Persistent-profile browser errors, native dialogs, and telemetry").toEqual([]);
    }
  };
  await withProfile(async (author) => {
    await goldenGuide(author);
    await saveOccurrence(author, FACTS.C2);
    await waitAgenda(author, [FACTS.C2.id]);
    await waitDraft(author, GOLDEN);
  });
  // Closing a persistent context closes its browser process; no storageState is copied.
  await withProfile(async (reopened) => {
    await reopened.goto(eventPath());
    await ready(reopened);
    await expect(reopened.locator("#nav-saved-count")).toHaveText("1");
    await expect(reopened.locator("#agenda-list article")).toHaveCount(1);
    await expect(reopened.locator("#agenda-list")).toContainText(FACTS.C2.title);
    await expectDraft(reopened, GOLDEN);
    await waitAgenda(reopened, [FACTS.C2.id]);
    await waitDraft(reopened, GOLDEN);
  });
  await recipientContext(browser, testInfo, async (fresh) => {
    await fresh.goto(eventPath());
    await ready(fresh);
    await expect(fresh.locator("#nav-saved-count")).toHaveText("0");
    await expect(fresh.locator("#agenda-list article")).toHaveCount(0);
    await expect(fresh.locator("#draft-count")).toHaveText("0 / 20 SESSIONS");
    await expect(fresh.locator("#guide-title")).toHaveValue("My Contoso Dev Days 2026 (fixture) guide");
    await expect(fresh.locator("#guide-summary")).toHaveValue("");
    expect(await fresh.evaluate(() => [
      localStorage.getItem("ms-events-guide:contoso-dev-days-2026:agenda:v1"),
      localStorage.getItem("ms-events-guide:contoso-dev-days-2026:draft:v1"),
    ])).toEqual([null, null]);
  });
});

async function tabTo(page, control, direction = "Tab") {
  await expect(control).toBeVisible();
  for (let attempt = 0; attempt < 100; attempt++) {
    if (await control.evaluate((element) => element === document.activeElement)) {
      await expect(control).toBeFocused();
      expect(await control.evaluate((element) => {
        const style = getComputedStyle(element);
        return element.matches(":focus-visible") && style.outlineStyle !== "none" &&
          parseFloat(style.outlineWidth) > 0;
      }), "Keyboard target has a visible focus outline").toBe(true);
      return;
    }
    await page.keyboard.press(direction);
  }
  throw new Error(`Control was not reachable within 100 ${direction} presses: ${control}`);
}

async function keyboardText(page, control, value) {
  await tabTo(page, control);
  await page.keyboard.press("ControlOrMeta+A");
  await page.keyboard.press("Backspace");
  await page.keyboard.type(value);
  await expect(control).toHaveValue(value);
}

async function expectModalTabContainment(page, dialog) {
  for (let index = 0; index < 12; index++) {
    await page.keyboard.press("Tab");
    // Native dialogs may traverse browser chrome (activeElement is body), not
    // background page controls. The following Tab must return into the modal.
    if (await dialog.evaluate(() => document.activeElement === document.body)) {
      await expect(dialog).toBeVisible();
      await page.keyboard.press("Tab");
    }
    expect(await dialog.evaluate((element) => element.contains(document.activeElement)),
      "Tab focus stays inside the native modal").toBe(true);
  }
  await page.keyboard.press("Shift+Tab");
  if (await dialog.evaluate(() => document.activeElement === document.body)) {
    await expect(dialog).toBeVisible();
    await page.keyboard.press("Shift+Tab");
  }
  expect(await dialog.evaluate((element) => element.contains(document.activeElement))).toBe(true);
}

test("E2E-084 keyboard-only skip, switcher, modal, Save, draft editing and sharing", async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto(eventPath());
  await ready(page);
  const skip = page.getByRole("link", { name: "Skip to content", exact: true });
  await page.keyboard.press("Tab");
  await expect(skip).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/#main$/);

  const switcher = page.locator(".event-switcher summary");
  await tabTo(page, switcher);
  await page.keyboard.press("Enter");
  await expect(page.locator(".event-switcher details")).toHaveAttribute("open", "");
  const otherEvent = page.locator(".event-switcher details").getByRole("link", { name: /Fabrikam Summit/ });
  await tabTo(page, otherEvent);
  await page.keyboard.press("Escape");
  await expect(page.locator(".event-switcher details")).not.toHaveAttribute("open");
  await expect(switcher).toBeFocused();

  await expect(page.getByRole("button", { name: "Create share link", exact: true })).toBeDisabled();

  const search = page.getByRole("searchbox", { name: "Search sessions", exact: true });
  await keyboardText(page, search, "no-such-keyboard-session");
  await expect(page.locator("#catalog-empty")).toBeVisible();
  await expect(page.locator("#results-count")).toHaveAttribute("role", "status");
  await expect(page.locator("#results-count")).toContainText("0 of 4 sessions");
  await keyboardText(page, search, "DEV200");
  await expect(page.locator("#session-grid article")).toHaveCount(1);
  const brief = card(page, "DEV200").getByRole("button", { name: "Session brief", exact: true });
  await tabTo(page, brief);
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: FACTS.C2.title, exact: true });
  await expect(dialog).toBeVisible();
  await expectModalTabContainment(page, dialog);
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(brief).toBeFocused();
  await page.keyboard.press("Enter");
  const save = dialog.getByRole("button", { name: /^Save DEV200,/ });
  await tabTo(page, save);
  await page.keyboard.press("Space");
  await waitAgenda(page, [FACTS.C2.id]);
  await expect(page.locator("#nav-saved-count")).toHaveText("1");
  await expect(page.locator("#toast")).toHaveAttribute("role", "status");
  await expect(page.locator("#toast")).toContainText("Saved to your agenda");
  await tabTo(page, page.getByRole("button", { name: "Close session details", exact: true }));
  await page.keyboard.press("Enter");
  await expect(dialog).toBeHidden();

  await tabTo(page, card(page, "DEV200").getByRole("button", { name: "Add DEV200 to custom guide", exact: true }));
  await page.keyboard.press("Space");
  await expect(page.locator("#draft-count")).toHaveText("1 / 20 SESSIONS");
  await keyboardText(page, search, "DEV300");
  await expect(page.locator("#session-grid article")).toHaveCount(1);
  await tabTo(page, card(page, "DEV300").getByRole("button", { name: "Add DEV300 to custom guide", exact: true }));
  await page.keyboard.press("Enter");
  await expect(page.locator("#draft-count")).toHaveText("2 / 20 SESSIONS");

  const title = page.getByRole("textbox", { name: "Give your guide a name", exact: true });
  await keyboardText(page, title, "");
  await tabTo(page, page.getByRole("button", { name: "Create share link", exact: true }));
  await page.keyboard.press("Enter");
  await expect(page.locator("#guide-message")).toHaveAttribute("role", "status");
  await expect(page.locator("#guide-message")).toContainText("Guide title cannot be empty");
  await keyboardText(page, title, "Keyboard authored guide");
  await keyboardText(page, page.getByRole("textbox", { name: "Who is it for, and what should they leave with?", exact: true }), "For keyboard users.");
  await keyboardText(page, page.getByRole("textbox", { name: "Why attend DEV200", exact: true }), "Compare deployment choices.");
  await keyboardText(page, page.getByRole("textbox", { name: "Why attend DEV300", exact: true }), "Discuss impact first.");
  await tabTo(page, page.getByRole("button", { name: "Move DEV300 earlier", exact: true }));
  await page.keyboard.press("Space");
  const expected = {
    version: 2, eventId: C, title: "Keyboard authored guide", summary: "For keyboard users.",
    steps: [
      { session: FACTS.C3, note: "Discuss impact first." },
      { session: FACTS.C2, note: "Compare deployment choices." },
    ],
  };
  await expectDraft(page, expected);
  await waitDraft(page, expected);
  await expect(page.locator("#toast")).toContainText("Moved to position 1");

  const clear = page.getByRole("button", { name: "Clear draft", exact: true });
  await tabTo(page, clear);
  await page.keyboard.press("Enter");
  const confirmation = page.getByRole("dialog", { name: "Clear your guide draft?", exact: true });
  await expect(confirmation).toBeVisible();
  await expectModalTabContainment(page, confirmation);
  await page.keyboard.press("Escape");
  await expect(confirmation).toBeHidden();
  await expect(clear).toBeFocused();
  await page.keyboard.press("Enter");
  await tabTo(page, confirmation.getByRole("button", { name: "Keep my sessions", exact: true }));
  await page.keyboard.press("Enter");
  await expect(confirmation).toBeHidden();
  await expectDraft(page, expected);
  await expect(page.locator("#nav-saved-count")).toHaveText("1");
  await tabTo(page, page.getByRole("button", { name: "Create share link", exact: true }));
  await page.keyboard.press("Enter");
  await expect(page.locator("#share-result")).toBeVisible();
  expect(independentSharePayload(await page.getByRole("textbox", { name: "Your guide's permalink", exact: true }).inputValue())).toEqual(expected);
});

const IGNITE = "ignite-2026";
const REAL_EVENT = `/real/events/${IGNITE}/`;
// Pinned from production catalog.json, not from an application decoder or serializer.
const KEYNOTE = {
  id: "1787856726055001EpP1-1789751960282001d6eI",
  sessionId: "1787856726055001EpP1", code: "KEY01",
  title: "Microsoft Ignite opening keynote",
  description: "Satya Nadella and Judson Althoff unveil the latest innovations driving the next wave of AI transformation.\n",
  speakers: "Satya Nadella, Judson Althoff", type: "Keynote", level: "",
  topics: ["Security", "Frontier Transformation", "Agent Platform", "Cloud & AI", "Microsoft IQ", "Copilot"],
  delivery: ["In-person", "Online"],
  audiences: ["Business Decision Maker", "Technical Decision Maker", "Technical Practitioner", "Partner Business"],
  viewing: ["Will be recorded"], start: "2026-11-17T18:00:00Z",
  end: "2026-11-17T20:00:00Z", duration: 120, location: "Chase Center",
};
const PARTNER = {
  code: "KEY02", id: "1787856726366001EV17-1789751960677001d6j0",
  title: "Microsoft Ignite Partner keynote",
};
const LEGACY_GUIDE = {
  version: 1, title: "Legacy Ignite team guide", summary: "A version-one snapshot.",
  steps: [{ session: KEYNOTE, note: "Discuss the opening keynote." }],
};
const LEGACY_TOKEN = `1.${deflateSync(Buffer.from(JSON.stringify(LEGACY_GUIDE))).toString("base64url")}`;
const LEGACY_AGENDA_KEY = "ignite-field-guide:agenda:v1";
const LEGACY_DRAFT_KEY = "ignite-field-guide:draft:v1";
const LEGACY_AGENDA = JSON.stringify({ version: 1, ids: [KEYNOTE.id] });
const LEGACY_DRAFT = JSON.stringify(LEGACY_GUIDE);

for (const variant of ["filters", "hash"]) {
  test(`E2E-079/root-${variant} real Ignite legacy root route preserves supported view state`, async ({ page }) => {
    const suffix = variant === "filters" ? "?q=KEY01&type=Keynote&day=2026-11-17&tz=UTC#catalog" : "#agenda";
    await page.goto(`/real/${suffix}`);
    await expect(page).toHaveURL(new URL(`${REAL_EVENT}${suffix}`, page.url()).href);
    await ready(page);
    await expect(page.locator("body")).toHaveAttribute("data-event-id", IGNITE);
    if (variant === "filters") {
      await expect(page.getByRole("searchbox", { name: "Search sessions" })).toHaveValue("KEY01");
      await expect(page.locator("#type")).toHaveValue("Keynote");
      await expect(page.locator("#day")).toHaveValue("2026-11-17");
      await expect(page.locator("#timezone")).toHaveValue("UTC");
      await expect(page.locator("#session-grid .session-code")).toHaveText(["KEY01"]);
      await expect(card(page, "KEY01")).toContainText(KEYNOTE.title);
    } else await expect(page.locator("#agenda-empty")).toBeVisible();
    await expect(page.locator("#nav-saved-count")).toHaveText("0");
  });
}

test("E2E-079/version1-share independently deflated legacy snapshot reaches real Ignite", async ({ page }, testInfo) => {
  await testInfo.attach("legacy-version1-token", { body: LEGACY_TOKEN, contentType: "text/plain" });
  await page.goto(`/real/?guide=${LEGACY_TOKEN}#my-guide`);
  await expect(page).toHaveURL(new URL(`${REAL_EVENT}?guide=${LEGACY_TOKEN}#my-guide`, page.url()).href);
  await ready(page);
  await expect(page.locator("body")).toHaveAttribute("data-event-id", IGNITE);
  await expectShared(page, LEGACY_GUIDE);
  await expect(page.locator("#nav-saved-count")).toHaveText("0");
  await page.locator("#shared-guide-steps").getByRole("button", { name: KEYNOTE.title, exact: true }).click();
  const dialog = page.getByRole("dialog", { name: KEYNOTE.title, exact: true });
  await expect(dialog).toContainText(KEYNOTE.description);
  await expect(dialog).toContainText(KEYNOTE.speakers);
  await expect(dialog).toContainText(KEYNOTE.location);
  await expect(dialog).toContainText("Saved snapshot");
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
});

for (const variant of ["migrate", "preserve-newer"]) {
  test(`E2E-079/storage-${variant} legacy keys survive without replacing newer event state`, async ({ page }) => {
    const modern = {
      version: 2, eventId: IGNITE, title: "Modern Ignite plan", summary: "",
      steps: [{ session: KEYNOTE, note: "Keep this newer note." }],
    };
    await page.goto(REAL_EVENT);
    await ready(page);
    if (variant === "preserve-newer") {
      await saveOccurrence(page, PARTNER);
      await waitAgenda(page, [PARTNER.id], IGNITE);
      await addSession(page, KEYNOTE);
      await page.getByRole("textbox", { name: "Give your guide a name", exact: true }).fill(modern.title);
      await page.getByRole("textbox", { name: "Why attend KEY01", exact: true }).fill(modern.steps[0].note);
      await waitDraft(page, modern, IGNITE);
    }
    // Explicit legacy migration arrangement only; positive Save/draft state above is UI-created.
    await page.evaluate(({ agendaKey, draftKey, agenda, draft }) => {
      localStorage.setItem(agendaKey, agenda);
      localStorage.setItem(draftKey, draft);
    }, { agendaKey: LEGACY_AGENDA_KEY, draftKey: LEGACY_DRAFT_KEY, agenda: LEGACY_AGENDA, draft: LEGACY_DRAFT });
    await page.reload();
    await ready(page);
    const expected = variant === "migrate" ? LEGACY_GUIDE : modern;
    const occurrence = variant === "migrate" ? KEYNOTE : PARTNER;
    await expectDraft(page, expected);
    await expect(page.locator("#nav-saved-count")).toHaveText("1");
    await expect(page.locator("#agenda-list article")).toHaveCount(1);
    await expect(page.locator("#agenda-list")).toContainText(occurrence.title);
    await waitAgenda(page, [occurrence.id], IGNITE);
    await waitDraft(page, expected, IGNITE);
    expect(await page.evaluate(() => ({
      agenda: localStorage.getItem("ignite-field-guide:agenda:v1"),
      draft: localStorage.getItem("ignite-field-guide:draft:v1"),
      agendaMarker: localStorage.getItem("ms-events-guide:ignite-2026:agenda:legacy-migrated:v1"),
      draftMarker: localStorage.getItem("ms-events-guide:ignite-2026:draft:legacy-migrated:v1"),
    }))).toEqual({ agenda: LEGACY_AGENDA, draft: LEGACY_DRAFT, agendaMarker: "1", draftMarker: "1" });
    await page.reload();
    await ready(page);
    await expectDraft(page, expected);
    await waitAgenda(page, [occurrence.id], IGNITE);
  });
}
