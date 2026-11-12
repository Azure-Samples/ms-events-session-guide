import { createHash } from "node:crypto";
import { test, expect, ready, addSession, waitDraft, C, FACTS } from "./helpers.mjs";
import { LIMIT_FACTS, EXTENDED_PATH } from "./extended-fixtures.mjs";
import { LONG_PREFIX } from "./site-paths.mjs";

test("E2E-041/oversize-token high-entropy valid notes fail explicitly then recover", async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  await page.goto(EXTENDED_PATH);
  await ready(page);
  for (const fact of LIMIT_FACTS.slice(0, 20)) await addSession(page, fact);
  const steps = [];
  for (const [index, fact] of LIMIT_FACTS.slice(0, 20).entries()) {
    const note = Array.from({ length: 10 }, (_, block) =>
      createHash("sha512").update(`E2E deterministic entropy ${index}:${block}`).digest("base64")).join("").slice(0, 600);
    steps.push({ session: fact, note });
    await page.getByRole("textbox", { name: `Why attend ${fact.code}` }).fill(note);
  }
  const expected = {
    version: 2, eventId: C, title: "My Contoso Dev Days 2026 (fixture) guide", summary: "", steps,
  };
  await waitDraft(page, expected);
  await page.locator("#share-guide").click();
  await expect(page.locator("#guide-message")).toContainText("too long to share");
  await expect(page.locator("#share-result")).toBeHidden();
  await expect(page.locator("#share-guide")).toBeEnabled();
  await expect(page.locator("#draft-count")).toHaveText("20 / 20 SESSIONS");
  for (const fact of LIMIT_FACTS.slice(0, 20)) {
    await page.getByRole("textbox", { name: `Why attend ${fact.code}` }).fill("Shortened.");
  }
  await page.locator("#share-guide").click();
  await expect(page.locator("#share-url")).toHaveValue(/guide=2\./);
  await testInfo.attach("recovered-share-url", {
    body: await page.locator("#share-url").inputValue(), contentType: "text/plain",
  });
});

test("E2E-041/oversize-full-url a real long-prefix deployment rejects its otherwise valid token", async ({ page }, testInfo) => {
  await page.goto(`${LONG_PREFIX}events/${C}/`);
  await ready(page);
  await addSession(page, FACTS.C2);
  await page.locator("#share-guide").click();
  await expect(page.locator("#guide-message")).toContainText("too long");
  await expect(page.locator("#share-result")).toBeHidden();
  await expect(page.locator("#draft-count")).toHaveText("1 / 20 SESSIONS");
  await testInfo.attach("long-base-url", { body: page.url(), contentType: "text/plain" });
  expect(page.url().length).toBeGreaterThan(7300);
});
