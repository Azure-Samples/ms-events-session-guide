import { test, expect, waitAgenda, observeContext, guardTelemetry } from "./helpers.mjs";

const C = "/events/contoso-dev-days-2026/";
const F = "/events/fabrikam-summit-2027/";
const codes = (page) => page.locator("#session-grid .session-code");
async function openEvent(page, path = C) {
  await page.goto(path);
  await expect(page.locator("#app-content")).toBeVisible();
  await expect(page.locator("#session-count")).toHaveText("4");
}

for (const entry of ["card", "direct", "selector"]) {
  test(`E2E-070/${entry} directory and explicit routing reach the same event`, { tag: entry === "selector" ? ["@smoke"] : [] }, async ({ page }) => {
    if (entry === "card") {
      await page.goto("/");
      await page.locator("#event-list").getByRole("link", { name: "Contoso Dev Days 2026 (fixture)" }).click();
    } else await page.goto(entry === "direct" ? C : "/?event=contoso-dev-days-2026");
    await expect(page).toHaveURL(new RegExp(`${C}$`));
    await expect(page.locator("#app-content")).toBeVisible();
    await expect(codes(page)).toHaveText(["DEV100", "DEV300", "DEV200", "DEV400"]);
    await expect(page.locator(".event-identity-name")).toHaveText("Contoso Dev Days 2026 (fixture)");
  });
}

for (const [variant, query, error] of [
  ["empty", "?event=", "exactly one nonempty"],
  ["repeated", "?event=contoso-dev-days-2026&event=fabrikam-summit-2027", "exactly one nonempty"],
  ["unknown", "?event=unknown-event", "not available"],
]) {
  test(`E2E-071/${variant} invalid selectors leave the directory usable`, async ({ page }) => {
    await page.goto(`/${query}`);
    await expect(page.locator("#route-error")).toContainText(error);
    await page.locator("#event-list").getByRole("link", { name: "Contoso Dev Days 2026 (fixture)" }).click();
    await expect(page.locator("#app-content")).toBeVisible();
    await expect(page.locator("#nav-saved-count")).toHaveText("0");
  });
}

test("E2E-071/valid a real repository-prefix build preserves assets and routing", async ({ page }) => {
  await page.goto("/repo/?event=contoso-dev-days-2026&scoutTheme=dark#catalog");
  await expect(page).toHaveURL(/\/repo\/events\/contoso-dev-days-2026\/\?scoutTheme=dark#catalog$/);
  await expect(page.locator("#app-content")).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(codes(page)).toHaveCount(4);
  const missingImages = await page.locator("img").evaluateAll((images) =>
    images.filter((image) => !image.complete || image.naturalWidth === 0).map((image) => image.src));
  expect(missingImages).toEqual([]);
  await page.getByText("Switch event", { exact: true }).click();
  await page.locator(".event-switcher").getByRole("link", { name: /Fabrikam Summit/ }).click();
  await expect(page).toHaveURL(/\/repo\/events\/fabrikam-summit-2027\/\?scoutTheme=dark$/);
  await expect(page.locator("#app-content")).toBeVisible();
});

test("E2E-072 directory search, empty state and reset", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#event-search")).toBeVisible();
  await expect(page.locator("#event-list [data-event-card]:visible")).toHaveCount(2);
  await page.getByLabel("Search events", { exact: true }).fill("FABRIKAM");
  await expect(page.locator("#event-list [data-event-card]:visible")).toHaveCount(1);
  await expect(page.locator("#event-list [data-event-card]:visible")).toContainText("Fabrikam");
  await page.getByLabel("Search events", { exact: true }).fill("no-such-event");
  await expect(page.locator("#event-empty")).toBeVisible();
  await page.getByRole("button", { name: "Show all events" }).click();
  await expect(page.locator("#event-list [data-event-card]:visible")).toHaveCount(2);
  await expect(page.locator("#event-query")).toHaveValue("");
});

test("E2E-072 event-local status transitions retain archived event access", async ({ page }) => {
  await page.clock.setFixedTime(new Date("2026-11-11T12:00:00Z"));
  await page.goto("/");
  await expect(page.locator('#event-list [data-event-id="contoso-dev-days-2026"] [data-event-status]'))
    .toHaveText("Happening now");
  await page.clock.setFixedTime(new Date("2028-01-01T12:00:00Z"));
  await page.reload();
  await expect(page.locator("#event-list [data-event-status]")).toHaveText(["Past event", "Past event"]);
  await expect(page.locator("#highlights-empty")).toBeVisible();
  await page.locator("#event-list").getByRole("link", { name: "Contoso Dev Days 2026 (fixture)" }).click();
  await expect(page.locator("#app-content")).toBeVisible();
});

for (const variant of ["outside", "escape", "focus-away", "toggle", "navigate", "private-state"]) {
  test(`E2E-073/${variant} event switcher dismissal and safe navigation`, { tag: variant === "outside" ? ["@smoke"] : [] }, async ({ page }) => {
    await openEvent(page, `${C}?q=DEV200&day=2026-11-10&scoutTheme=dark`);
    const details = page.locator(".event-switcher details");
    const summary = page.getByText("Switch event", { exact: true });
    await summary.click();
    await expect(details).toHaveAttribute("open", "");
    if (variant === "navigate" || variant === "private-state") {
      await details.getByRole("link", { name: /Fabrikam Summit/ }).click();
      await expect(page).toHaveURL(`${new URL(F, page.url()).href}?scoutTheme=dark`);
      await expect(page.locator("#app-content")).toBeVisible();
      await expect(page.locator(".event-switcher details")).not.toHaveAttribute("open");
      if (variant === "private-state") {
        await page.locator(".event-switcher").getByRole("link", { name: /All events/ }).click();
        await expect(page).toHaveURL(/\/\?scoutTheme=dark$/);
        await expect(page.locator("#event-search")).toBeVisible();
      }
    } else {
      if (variant === "outside") await page.locator("#theme-toggle").click();
      if (variant === "escape") await page.keyboard.press("Escape");
      if (variant === "focus-away") await page.locator("#theme-toggle").focus();
      if (variant === "toggle") await summary.click();
      await expect(details).not.toHaveAttribute("open");
      if (variant === "escape") await expect(summary).toBeFocused();
    }
  });
}

test("E2E-074 audiences and learning paths are fixture-driven", async ({ page }) => {
  await openEvent(page);
  await expect(page.locator("#path-options [aria-pressed=true]")).toContainText("Launch fast");
  await expect(page.locator("#path-steps .session-code")).toHaveText(["DEV100", "DEV200", "DEV300"]);
  await page.getByRole("button", { name: "Nonprofit", exact: true }).click();
  await expect(page.locator("#path-options [aria-pressed=true]")).toContainText("Impact first");
  await expect(page.locator("#path-steps .session-code")).toHaveText(["DEV300"]);
  await page.goto(F);
  await expect(page.locator("#app-content")).toBeVisible();
  await expect(page.locator("#path-options [aria-pressed=true]")).toContainText("Modernize services");
  await expect(page.locator("#path-steps .session-code")).toHaveText(["FAB200", "FAB100"]);
});

for (const [variant, selections, expected] of [
  ["topic", { topic: "Apps" }, ["DEV200"]],
  ["day", { day: "2026-11-10" }, ["DEV100", "DEV200"]],
  ["unscheduled", { day: "unscheduled" }, ["DEV400"]],
  ["combined", { topic: "Cloud", day: "2026-11-10" }, ["DEV100"]],
  ["empty", { topic: "Cloud", day: "2026-11-13" }, []],
  ["facets", { topic: "Apps", type: "Breakout", level: "Intermediate (200)", delivery: "In-person" }, ["DEV200"]],
  ["title-sort", { sort: "title" }, ["DEV100", "DEV300", "DEV200", "DEV400"]],
]) {
  test(`E2E-075/${variant} exact catalog results and reset`, async ({ page }) => {
    await openEvent(page);
    for (const [id, value] of Object.entries(selections)) await page.locator(`#${id}`).selectOption(value);
    await expect(codes(page)).toHaveText(expected);
    await expect(page.locator("#results-count")).toContainText(`${expected.length} of 4 sessions`);
    if (!expected.length) await expect(page.locator("#catalog-empty")).toBeVisible();
    await page.locator("#reset-filters").click();
    await expect(codes(page)).toHaveText(["DEV100", "DEV300", "DEV200", "DEV400"]);
    await expect(page.locator("#nav-saved-count")).toHaveText("0");
    await expect(page.locator("#draft-count")).toHaveText("0 / 20 SESSIONS");
  });
}

test("E2E-075 search by code, speaker and title; Enter does not reload", async ({ page }) => {
  await openEvent(page);
  for (const [query, expected] of [
    ["DEV200", ["DEV200"]],
    ["Fixture Speaker", ["DEV100", "DEV300", "DEV200", "DEV400"]],
    ["Grants and impact", ["DEV300"]],
  ]) {
    await page.getByRole("searchbox", { name: "Search sessions" }).fill(query);
    await expect(codes(page)).toHaveText(expected);
  }
  let navigated = false;
  const navigation = () => { navigated = true; };
  page.on("load", navigation);
  await page.getByRole("searchbox", { name: "Search sessions" }).press("Enter");
  await expect(codes(page)).toHaveText(["DEV300"]);
  expect(navigated).toBe(false);
  page.off("load", navigation);
});

for (const variant of ["catalog-http", "manifest-http", "invalid-catalog"]) {
  test(`E2E-080/${variant} failed boot retries without duplicated handlers`, { tag: variant === "catalog-http" ? ["@smoke"] : [] }, async ({ page }) => {
    await openEvent(page);
    await page.getByRole("button", { name: "Save DEV200", exact: true }).click();
    await page.getByRole("button", { name: "Add DEV200 to custom guide", exact: true }).click();
    await page.getByLabel("Give your guide a name").fill("Retry keeps my plan");
    await waitAgenda(page, ["S200-a"]);
    await expect.poll(() => page.evaluate(() =>
      JSON.parse(localStorage.getItem("ms-events-guide:contoso-dev-days-2026:draft:v1")).title)).toBe("Retry keeps my plan");
    const pattern = variant === "manifest-http" ? "**/data/events/manifest.*.json" : "**/data/events/contoso-dev-days-2026/catalog.*.json";
    await page.route(pattern, (route) => route.fulfill(variant === "invalid-catalog" ?
      { json: { invalid: true } } : { status: 503, body: "Synthetic fixture failure" }));
    await page.goto(C);
    await expect(page.locator("#load-error")).toBeVisible();
    await page.getByText("Switch event", { exact: true }).click();
    await expect(page.locator(".event-switcher details")).toHaveAttribute("open", "");
    await page.keyboard.press("Escape");
    await expect(page.locator(".event-switcher details")).not.toHaveAttribute("open");
    await page.unroute(pattern);
    await page.getByRole("button", { name: "Try again" }).click();
    await expect(page.locator("#app-content")).toBeVisible();
    await expect(codes(page)).toHaveCount(4);
    await expect(page.locator("#topic option")).toHaveCount(5);
    await expect(page.locator("#nav-saved-count")).toHaveText("1");
    await expect(page.getByLabel("Give your guide a name")).toHaveValue("Retry keeps my plan");
    await expect(page.locator("#draft-steps .custom-step-meta")).toContainText("DEV200");
    await page.getByRole("button", { name: "Save DEV300", exact: true }).click();
    await expect(page.locator("#nav-saved-count")).toHaveText("2");
  });
}

test("E2E-081/manifest-http static directory links survive enhancement failure", async ({ page }) => {
  await page.route("**/data/events/manifest.*.json", (route) => route.fulfill({ status: 503 }));
  await page.goto("/");
  await expect(page.locator("#route-error")).toContainText("static event links");
  await page.unroute("**/data/events/manifest.*.json");
  await page.locator("#event-list").getByRole("link", { name: "Contoso Dev Days 2026 (fixture)" }).click();
  await expect(page.locator("#app-content")).toBeVisible();
});

test("E2E-081/javascript-off directory remains navigable with an honest event fallback", async ({ browser, baseURL }) => {
  const context = await browser.newContext({ javaScriptEnabled: false, baseURL });
  const problems = observeContext(context);
  try {
    await guardTelemetry(context, problems);
    const page = await context.newPage();
    await page.goto("/");
    await page.locator("#event-list").getByRole("link", { name: "Contoso Dev Days 2026 (fixture)" }).click();
    await expect(page).toHaveURL(new RegExp(`${C}$`));
    await expect(page.locator("noscript p")).toBeVisible();
    await expect(page.locator("noscript p")).toContainText("This guide needs JavaScript");
    await expect(page.locator("noscript a"))
      .toHaveAttribute("href", "https://example.com/contoso-dev-days/sessions");
    await expect(page.locator("#app-content")).toBeHidden();
  } finally {
    await context.close();
    expect(problems).toEqual([]);
  }
});
