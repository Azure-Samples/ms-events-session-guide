import { test, expect, saveOccurrence, FACTS, waitAgenda, ready } from "./helpers.mjs";

const C = "/events/contoso-dev-days-2026/";
const agendaKey = "ms-events-guide:contoso-dev-days-2026:agenda:v1";
const draftKey = "ms-events-guide:contoso-dev-days-2026:draft:v1";

async function open(page) {
  await page.goto(C);
  await expect(page.locator("#app-content")).toBeVisible();
}

for (const variant of ["access-denied", "quota-failed"]) {
  test(`E2E-082/${variant} failed browser storage is explicitly nonpersistent`, { tag: variant === "quota-failed" ? ["@smoke"] : [] }, async ({ page }) => {
    await page.addInitScript((variant) => {
      if (variant === "access-denied") Object.defineProperty(window, "localStorage", {
        get() { throw new DOMException("Synthetic denied storage", "SecurityError"); },
      });
      else Storage.prototype.setItem = function () {
        throw new DOMException("Synthetic quota failure", "QuotaExceededError");
      };
    }, variant);
    await open(page);
    await page.getByRole("button", { name: "Save DEV200", exact: true }).click();
    await expect(page.locator("#nav-saved-count")).toHaveText("1");
    await expect(page.locator("#storage-warning")).toContainText(/unavailable|could not be saved/);
    await page.getByRole("button", { name: "Add DEV200 to custom guide", exact: true }).click();
    await page.getByLabel("Give your guide a name").fill("Volatile guide");
    await page.locator("#share-guide").click();
    await expect(page.locator("#share-url")).toHaveValue(/guide=/);
    await expect(page.locator("#storage-warning")).toContainText(/share link/i);
    // Failed writes intentionally remain pending; do not navigate and imply durability.
  });
}

for (const kind of ["agenda", "draft"]) {
  test(`E2E-083/${kind}-json corrupt data is reported and new UI actions recover`, async ({ page }) => {
    await page.addInitScript(({ key }) => {
      if (!sessionStorage.getItem("e2e-corrupt-seeded")) {
        localStorage.setItem(key, "{invalid JSON");
        sessionStorage.setItem("e2e-corrupt-seeded", "1");
      }
    }, { key: kind === "agenda" ? agendaKey : draftKey });
    await open(page);
    await expect(page.locator("#storage-warning")).toContainText(`previous ${kind === "agenda" ? "agenda" : "guide draft"} could not be read`);
    if (kind === "agenda") {
      await page.getByRole("button", { name: "Save DEV300", exact: true }).click();
      await expect.poll(() => page.evaluate((key) => JSON.parse(localStorage.getItem(key)).ids, agendaKey)).toEqual(["S300-a"]);
      await page.reload();
      await expect(page.locator("#nav-saved-count")).toHaveText("1");
      await expect(page.locator("#agenda-list")).toContainText("Grants and impact");
    } else {
      await page.getByRole("button", { name: "Add DEV300 to custom guide", exact: true }).click();
      await page.getByLabel("Give your guide a name").fill("Recovered plan");
      await expect.poll(() => page.evaluate((key) => JSON.parse(localStorage.getItem(key)).title, draftKey)).toBe("Recovered plan");
      await page.reload();
      await expect(page.getByLabel("Give your guide a name")).toHaveValue("Recovered plan");
      await expect(page.locator("#draft-steps")).toContainText("Grants and impact");
    }
    await expect(page.locator("#storage-warning")).toBeHidden();
  });
}

test("E2E-083/wrong-event a foreign draft is reported and explicit new edits recover", async ({ page }) => {
  await page.addInitScript(({ draftKey }) => {
    if (!sessionStorage.getItem("foreign-draft-seeded")) {
      localStorage.setItem(draftKey, JSON.stringify({
        version: 2, eventId: "fabrikam-summit-2027", title: "Foreign plan", summary: "", steps: [],
      }));
      sessionStorage.setItem("foreign-draft-seeded", "1");
    }
  }, { draftKey });
  await open(page);
  await expect(page.locator("#storage-warning")).toContainText("belongs to another event");
  await page.getByRole("button", { name: "Add DEV300 to custom guide", exact: true }).click();
  await page.getByLabel("Give your guide a name").fill("Recovered plan");
  await expect.poll(() => page.evaluate((key) => JSON.parse(localStorage.getItem(key)).title, draftKey)).toBe("Recovered plan");
  await page.reload();
  await ready(page);
  await expect(page.getByLabel("Give your guide a name")).toHaveValue("Recovered plan");
  await expect(page.locator("#draft-steps")).toContainText("Grants and impact");
  await expect(page.locator("#storage-warning")).toBeHidden();
});

test("E2E-083/removed-occurrence obsolete saved times warn without substituting a repeat", async ({ page }) => {
  await open(page);
  await saveOccurrence(page, FACTS.C1b);
  await saveOccurrence(page, FACTS.C2);
  await waitAgenda(page, ["S100-b", "S200-a"]);
  await page.route("**/data/events/contoso-dev-days-2026/catalog.*.json", async (route) => {
    const response = await route.fetch();
    const payload = await response.json();
    payload.instances = payload.instances.filter((instance) => instance.id !== "S100-b");
    await route.fulfill({ response, json: payload });
  });
  await page.reload();
  await ready(page);
  await expect(page.locator("#storage-warning")).toContainText("1 previously saved session times");
  await expect(page.locator("#nav-saved-count")).toHaveText("1");
  await expect(page.locator("#agenda-list")).toContainText("Shipping small");
  await expect(page.locator("#agenda-list")).not.toContainText("Contoso keynote");
  await page.locator("#reset-filters").click();
  await page.getByRole("button", { name: "Save DEV300", exact: true }).click();
  await waitAgenda(page, ["S200-a", "S300-a"]);
  await page.reload();
  await ready(page);
  await expect(page.locator("#nav-saved-count")).toHaveText("2");
  await expect(page.locator("#agenda-list")).not.toContainText("Contoso keynote");
});

test("E2E-089 held real storage lock preserves the final rapid edits and saves", async ({ page, context }) => {
  await open(page);
  await page.getByRole("button", { name: "Add DEV200 to custom guide", exact: true }).click();
  await page.getByLabel("Give your guide a name").fill("Initial title");
  await expect.poll(() => page.evaluate((key) => JSON.parse(localStorage.getItem(key)).title, draftKey)).toBe("Initial title");
  const lockPage = await context.newPage();
  try {
    await lockPage.goto("/");
    await lockPage.evaluate(() => {
      window.e2eLockStarted = false;
      window.e2eLockPromise = navigator.locks.request("ms-events-guide:contoso-dev-days-2026:storage", () => {
        window.e2eLockStarted = true;
        return new Promise((release) => { window.e2eReleaseLock = release; });
      });
    });
    await expect.poll(() => lockPage.evaluate(() => window.e2eLockStarted)).toBe(true);
    await page.getByRole("button", { name: "Save DEV200", exact: true }).click();
    await page.getByRole("button", { name: "Manage saved times for DEV200", exact: true }).click();
    await page.getByRole("button", { name: "Save DEV200", exact: true }).click();
    await page.getByLabel("Give your guide a name").fill("Earlier locked title");
    await page.getByLabel("Give your guide a name").fill("Latest locked title");
    const note = page.locator("#draft-steps textarea");
    await note.fill("Earlier locked note");
    await note.fill("Latest locked note");
    await lockPage.evaluate(() => { window.e2eReleaseLock(); return window.e2eLockPromise; });
    await expect.poll(() => page.evaluate(({ agendaKey, draftKey }) => ({
      ids: JSON.parse(localStorage.getItem(agendaKey)).ids,
      title: JSON.parse(localStorage.getItem(draftKey)).title,
      note: JSON.parse(localStorage.getItem(draftKey)).steps[0].note,
    }), { agendaKey, draftKey })).toEqual({
      ids: ["S200-a"], title: "Latest locked title", note: "Latest locked note",
    });
    await page.reload();
    await expect(page.locator("#nav-saved-count")).toHaveText("1");
    await expect(page.locator("#agenda-list")).toContainText("Shipping small");
    await expect(page.getByLabel("Give your guide a name")).toHaveValue("Latest locked title");
    await expect(page.locator("#draft-steps textarea")).toHaveValue("Latest locked note");
  } finally {
    await lockPage.evaluate(() => window.e2eReleaseLock?.());
    await lockPage.close();
  }
});

test("E2E-087 telemetry-free local flows never attempt analytics requests", async ({ page, context }) => {
  const requests = [];
  context.on("request", (request) => {
    if (/applicationinsights|visualstudio\.com|monitor\.azure\.com|dc\.services|in\.applicationinsights/i.test(request.url())) requests.push(request.url());
  });
  await open(page);
  await page.getByRole("searchbox", { name: "Search sessions" }).fill("DEV200");
  await expect(page.locator("#session-grid .session-code")).toHaveText(["DEV200"]);
  await page.getByRole("button", { name: "Save DEV200", exact: true }).click();
  await page.getByRole("button", { name: "Add DEV200 to custom guide", exact: true }).click();
  await page.getByLabel("Give your guide a name").fill("Telemetry-free guide");
  await page.locator("#share-guide").click();
  await expect(page.locator("#share-url")).toHaveValue(/guide=/);
  await expect.poll(() => page.evaluate((key) => JSON.parse(localStorage.getItem(key)).title, draftKey)).toBe("Telemetry-free guide");
  await page.goto("/");
  await expect(page.locator("#event-search")).toBeVisible();
  await page.close();
  expect(requests).toEqual([]);
});
