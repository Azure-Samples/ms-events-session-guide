import { deflateSync } from "node:zlib";
import {
  test, expect, gotoEvent, addSession, FACTS, GOLDEN, goldenGuide, editGolden,
  shareGuide, expectDraft, recipientContext, independentSharePayload,
} from "./helpers.mjs";

const C = "/events/contoso-dev-days-2026/";
// Only negative cases use independently serialized tokens; positive links come from UI.
const negativeToken = (payload) => `2.${deflateSync(JSON.stringify(payload)).toString("base64url")}`;
const badTokens = [
  ["truncated", "2.eJ", /invalid|compressed/i],
  ["base64", "2.A", /base64/i],
  ["version", "9.eJw", /unsupported version/i],
  ["unknown-event", negativeToken({ ...GOLDEN, eventId: "unknown-event" }), /not available/i],
  ["duplicate-session", negativeToken({ ...GOLDEN, steps: [GOLDEN.steps[0], GOLDEN.steps[0]] }), /same session/i],
  ["invalid-time", negativeToken({ ...GOLDEN, steps: [{
    ...GOLDEN.steps[0], session: { ...FACTS.C2, end: "2026-11-10T14:00:00Z" },
  }] }), /positive time range/i],
  ["expanded-limit", `2.${deflateSync(Buffer.alloc(256 * 1024 + 1, 65)).toString("base64url")}`, /256 KB safety limit/i],
];

test("E2E-033/clipboard-denied exposes the real selectable URL as fallback", async ({ page }, testInfo) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", { value: {
      writeText: async () => { throw new DOMException("Synthetic clipboard denial", "NotAllowedError"); },
    } });
  });
  await gotoEvent(page);
  await addSession(page, FACTS.C2);
  const url = await shareGuide(page, testInfo);
  await page.getByRole("button", { name: "Copy link", exact: true }).click();
  await expect(page.locator("#toast")).toContainText("Clipboard access is unavailable");
  await expect(page.locator("#share-url")).toHaveValue(url);
  await expect(page.locator("#share-url")).toBeVisible();
  await expect(page.locator("#share-url")).toBeFocused();
  expect(await page.locator("#share-url").evaluate((input) =>
    input.selectionStart === 0 && input.selectionEnd === input.value.length)).toBe(true);
});

for (const [variant, token, message] of badTokens) {
  test(`E2E-040/${variant} bad shares preserve the existing local draft`, async ({ page }) => {
    await goldenGuide(page);
    await page.goto(`${C}?guide=${token}#my-guide`);
    await expect(page.locator("#guide-message")).toContainText(message);
    await expect(page.locator("#guide-message")).toContainText("local draft has not been changed");
    await expectDraft(page, GOLDEN);
    await expect(page.locator("#nav-saved-count")).toHaveText("0");
  });
}

test("E2E-040/selector-mismatch root routing refuses conflicting share identity", async ({ page }, testInfo) => {
  await goldenGuide(page);
  const url = new URL(await shareGuide(page, testInfo));
  url.pathname = "/";
  url.searchParams.set("event", "fabrikam-summit-2027");
  await page.goto(url.href);
  await expect(page.locator("#route-error")).toContainText("does not match");
  await page.goto(C);
  await expectDraft(page, GOLDEN);
});

for (const variant of ["no-compression", "no-decompression"]) {
  test(`E2E-041/${variant} unsupported capability gives an actionable error`, async ({ page, browser }, testInfo) => {
    await goldenGuide(page);
    if (variant === "no-compression") {
      await page.evaluate(() => { window.CompressionStream = undefined; });
      await page.locator("#share-guide").click();
      await expect(page.locator("#guide-message")).toContainText("native compression is unavailable");
      await expectDraft(page, GOLDEN);
    } else {
      const url = await shareGuide(page, testInfo);
      await recipientContext(browser, testInfo, async (recipient) => {
        await recipient.addInitScript(() => { window.DecompressionStream = undefined; });
        await recipient.goto(url);
        await expect(recipient.locator("#guide-message")).toContainText("native decompression is unavailable");
        await expect(recipient.locator("#draft-count")).toHaveText("0 / 20 SESSIONS");
      });
    }
  });
}

async function installStreamGate(page, kind) {
  await page.addInitScript((kind) => {
    const Native = window[kind];
    window.e2eGate = { armed: false, started: false, released: false };
    window[kind] = class {
      constructor(format) {
        const native = new Native(format);
        if (!window.e2eGate.armed) return native;
        window.e2eGate.armed = false;
        return {
          writable: native.writable,
          readable: native.readable.pipeThrough(new TransformStream({
            async flush() {
              window.e2eGate.started = true;
              await new Promise((resolve) => {
                window.e2eGate.release = () => {
                  window.e2eGate.released = true;
                  resolve();
                };
              });
            },
          })),
        };
      }
    };
  }, kind);
}

test("E2E-042 edit during actual compression rejects a stale share result", async ({ page }, testInfo) => {
  await installStreamGate(page, "CompressionStream");
  await gotoEvent(page);
  await addSession(page, FACTS.C2);
  await page.getByLabel("Give your guide a name").fill("Earlier title");
  await page.evaluate(() => { window.e2eGate.armed = true; });
  await page.locator("#share-guide").click();
  await expect.poll(() => page.evaluate(() => window.e2eGate.started)).toBe(true);
  await page.getByLabel("Give your guide a name").fill("Latest title");
  await page.evaluate(() => window.e2eGate.release());
  await expect(page.locator("#guide-message")).toContainText("draft changed");
  await expect(page.locator("#share-result")).toBeHidden();
  await expect(page.locator("#share-guide")).toBeEnabled();
  const latest = independentSharePayload(await shareGuide(page, testInfo));
  expect(latest.title).toBe("Latest title");
});

for (const variant of ["leave-share", "newer-share", "stale-error"]) {
  test(`E2E-043/${variant} late native decode cannot replace a newer view`, async ({ page, browser }, testInfo) => {
    await goldenGuide(page);
    const first = await shareGuide(page, testInfo);
    await editGolden(page);
    const second = await shareGuide(page, testInfo);
    await recipientContext(browser, testInfo, async (recipient) => {
      await installStreamGate(recipient, "DecompressionStream");
      await gotoEvent(recipient);
      let earlier = first;
      if (variant === "stale-error") earlier = `${new URL(C, first)}?guide=${negativeToken({ ...GOLDEN, steps: [GOLDEN.steps[0], GOLDEN.steps[0]] })}`;
      await recipient.evaluate(({ earlier, second }) => {
        history.pushState(null, "", earlier);
        history.pushState(null, "", second);
        window.e2eGate.armed = true;
      }, { earlier, second });
      await recipient.goBack();
      await expect.poll(() => recipient.evaluate(() => window.e2eGate.started)).toBe(true);
      if (variant === "leave-share") {
        await recipient.locator('[data-entry="custom"]').click();
        await expect(recipient).not.toHaveURL(/guide=/);
      } else {
        await recipient.goForward();
        await expect(recipient.locator("#shared-guide-title")).toHaveText("Edited E2E plan");
      }
      await recipient.evaluate(() => window.e2eGate.release());
      await expect.poll(() => recipient.evaluate(() => window.e2eGate.released)).toBe(true);
      if (variant === "leave-share") {
        await expect(recipient.locator("#shared-guide")).toBeHidden();
        await expect(recipient.locator("#guide-editor")).toBeVisible();
      } else {
        await expect(recipient.locator("#shared-guide-title")).toHaveText("Edited E2E plan");
        await expect(recipient).toHaveURL(second);
      }
      await expect(recipient.locator("#guide-message")).toBeHidden();
      await expect(recipient.locator("#draft-count")).toHaveText("0 / 20 SESSIONS");
    });
  });
}
