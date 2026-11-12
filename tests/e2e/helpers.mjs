import { test as base, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { inflateSync } from 'node:zlib';
import { assertCalendar, EVENTS, FACTS } from './calendar-oracle.mjs';

export { expect, FACTS };
export const C = EVENTS.C.id;
export const F = EVENTS.F.id;
export const eventPath = (event = C) => `/events/${event}/`;
const effectiveOptions = new WeakMap();

export function observeContext(context) {
  const problems = [];
  const observed = new WeakSet();
  const observe = (page) => {
    if (observed.has(page)) return;
    observed.add(page);
    page.on('pageerror', (error) => problems.push(`pageerror: ${error.stack || error.message}`));
    page.on('dialog', async (dialog) => {
      problems.push(`Unexpected ${dialog.type()} dialog: ${dialog.message()}`);
      // Do not leave an unexpected beforeunload dialog hanging the entire run.
      try {
        await dialog.accept();
      } catch (error) {
        problems.push(`Could not accept unexpected ${dialog.type()} dialog: ${error.message}`);
      }
    });
  };
  context.pages().forEach(observe);
  context.on('page', observe);
  return problems;
}

export async function guardTelemetry(context, problems) {
  await context.route(/^https?:\/\//, async (route) => {
    const url = new URL(route.request().url());
    if (url.origin === 'http://127.0.0.1:1414') {
      await route.continue();
      return;
    }
    problems.push(`Unexpected external request blocked (including telemetry): ${url.href}`);
    await route.abort('blockedbyclient');
  });
}

function collectDiagnostics(context) {
  const diagnostics = { console: [], network: [] };
  const record = (kind, entry) => {
    if (diagnostics[kind].length < 200) diagnostics[kind].push(entry);
  };
  const observe = (page) => {
    page.on('console', (message) => {
      if (['error', 'warning'].includes(message.type())) {
        record('console', { type: message.type(), text: message.text(), location: message.location(), page: page.url() });
      }
    });
  };
  context.pages().forEach(observe);
  context.on('page', observe);
  context.on('requestfailed', (request) => {
    record('network', { url: request.url(), method: request.method(), failure: request.failure() });
  });
  context.on('response', (response) => {
    if (response.status() >= 400) {
      record('network', { url: response.url(), status: response.status(), method: response.request().method() });
    }
  });
  return diagnostics;
}

async function attachRuntime(context, testInfo, diagnostics, label = 'browser') {
  const prefix = testInfo.config.metadata.tier === 'smoke' ? 'e2e-smoke' : 'e2e';
  const buildBytes = await readFile(new URL(`../../test-results/${prefix}-build.json`, import.meta.url));
  const build = JSON.parse(buildBytes.toString('utf8'));
  const use = effectiveOptions.get(testInfo) || testInfo.project.use;
  const pages = context.pages();
  const metadata = {
    case: testInfo.title, project: testInfo.project.name, browser: context.browser()?.browserType().name(),
    browserVersion: context.browser()?.version(),
    viewport: pages.find((page) => !page.isClosed())?.viewportSize() || use.viewport, timezone: use.timezoneId,
    locale: use.locale, colorScheme: use.colorScheme, mobile: use.isMobile || false,
    baseURL: use.baseURL, outcome: testInfo.status, build,
    pages: pages.map((page) => page.url()),
  };
  await testInfo.attach(`${label}-e2e-build.json`, { body: buildBytes, contentType: 'application/json' });
  await testInfo.attach(`${label}-runtime-metadata`, {
    body: JSON.stringify(metadata, null, 2), contentType: 'application/json',
  });
  await testInfo.attach(`${label}-console-network`, {
    body: JSON.stringify(diagnostics, null, 2), contentType: 'application/json',
  });
}

export const test = base.extend({
  browserObservations: [async ({ context, timezoneId, viewport, colorScheme, locale, isMobile }, use, testInfo) => {
    effectiveOptions.set(testInfo, { ...testInfo.project.use, timezoneId, viewport, colorScheme, locale, isMobile });
    const problems = observeContext(context);
    const diagnostics = collectDiagnostics(context);
    await guardTelemetry(context, problems);
    await use(problems);
    await attachRuntime(context, testInfo, diagnostics);
    if (problems.length) {
      await testInfo.attach('unexpected-browser-events', {
        body: problems.join('\n'), contentType: 'text/plain',
      });
    }
    expect(problems, 'No unexpected JavaScript errors, native dialogs, or telemetry').toEqual([]);
  }, { auto: true }],
});

export async function ready(page) {
  await expect(page.locator('#app-content')).toBeVisible();
  await expect(page.locator('#loading-notice')).toBeHidden();
  await expect(page.locator('#load-error')).toBeHidden();
}

export async function gotoEvent(page, event = C) {
  await page.goto(eventPath(event));
  await ready(page);
  await page.locator('#timezone').selectOption('UTC');
  await expect(page.locator('#timezone')).toHaveValue('UTC');
}

export function card(page, code) {
  return page.locator('#session-grid article').filter({
    has: page.locator('.session-code', { hasText: new RegExp(`^${code}$`) }),
  });
}

export async function findSession(page, code, day = '') {
  await page.locator('#reset-filters').click();
  if (day) await page.locator('#day').selectOption(day);
  await page.getByRole('searchbox', { name: 'Search sessions' }).fill(code);
  // The URL is committed by the debounced input handler, before cards are rendered.
  await expect.poll(() => new URL(page.url()).searchParams.get('q')).toBe(code);
  await expect(page.locator('#session-grid article')).toHaveCount(1);
  await expect(card(page, code)).toBeVisible();
  return card(page, code);
}

export async function closeSession(page) {
  await page.getByRole('button', { name: 'Close session details' }).click();
  await expect(page.locator('#session-dialog')).toBeHidden();
}

export async function saveOccurrence(page, fact) {
  const session = await findSession(page, fact.code);
  await session.getByRole('button', { name: 'Session brief', exact: true }).click();
  const control = page.locator(`#session-dialog [data-save-instance="${fact.id}"]`);
  await expect(control).toHaveAttribute('aria-pressed', 'false');
  await control.click();
  await expect(control).toHaveAttribute('aria-pressed', 'true');
  await closeSession(page);
}

export async function addSession(page, fact, { day = '', dialog = false } = {}) {
  const session = await findSession(page, fact.code, day);
  if (dialog) {
    await session.getByRole('button', { name: 'Session brief', exact: true }).click();
    await page.locator('#session-dialog').getByRole('button', { name: 'Add to my custom guide', exact: true }).click();
    await closeSession(page);
  } else {
    await session.getByRole('button', { name: `Add ${fact.code} to custom guide`, exact: true }).click();
  }
}

async function stored(page, event, kind) {
  return page.evaluate(({ key }) => {
    const raw = localStorage.getItem(key);
    return raw === null ? null : JSON.parse(raw);
  }, { key: `ms-events-guide:${event}:${kind}:v1` });
}

export async function waitAgenda(page, ids, event = C) {
  await expect.poll(async () => (await stored(page, event, 'agenda'))?.ids?.slice().sort(), {
    timeout: 10_000, message: 'UI agenda write must complete before navigation',
  }).toEqual([...ids].sort());
}

export async function waitDraft(page, expected, event = C) {
  await expect.poll(() => stored(page, event, 'draft'), {
    timeout: 10_000, message: 'UI draft write must complete before navigation',
  }).toEqual(expected);
}

export const GOLDEN = {
  version: 2, eventId: C, title: 'E2E team: cloud & cafe', summary: 'Three stops, one shared plan.',
  steps: [
    { session: FACTS.C2, note: 'Compare deployment choices.' },
    { session: FACTS.C1b, note: 'E2E_NOTE_NOT_FOR_CALENDAR_42' },
    { session: FACTS.CU, note: 'Ask about the lab schedule.' },
  ],
};

export const EDITED = {
  ...GOLDEN, title: 'Edited E2E plan', summary: 'Updated plan.',
  steps: [
    { session: FACTS.C1b, note: 'Prioritize this keynote.' },
    GOLDEN.steps[0],
  ],
};

export async function expectDraft(page, expected) {
  await expect(page.locator('#guide-editor')).toBeVisible();
  await expect(page.locator('#guide-title')).toHaveValue(expected.title);
  await expect(page.locator('#guide-summary')).toHaveValue(expected.summary);
  await expect(page.locator('#draft-count')).toHaveText(`${expected.steps.length} / 20 SESSIONS`);
  const steps = page.locator('#draft-steps > li');
  await expect(steps).toHaveCount(expected.steps.length);
  for (const [index, step] of expected.steps.entries()) {
    const row = steps.nth(index);
    await expect(row.locator('.custom-step-number')).toHaveText(String(index + 1).padStart(2, '0'));
    await expect(row.getByRole('button', { name: step.session.title, exact: true })).toBeVisible();
    await expect(row.locator('.custom-step-meta')).toContainText(step.session.code);
    await expect(row.getByRole('textbox', { name: `Why attend ${step.session.code}` })).toHaveValue(step.note);
  }
}

export async function goldenGuide(page) {
  await gotoEvent(page);
  await addSession(page, FACTS.C1b, { day: '2026-11-10' });
  await addSession(page, FACTS.C2);
  await addSession(page, FACTS.CU, { day: 'unscheduled' });
  await page.locator('#draft-steps').getByRole('button', { name: 'Move DEV200 earlier', exact: true }).click();
  await page.locator('#guide-title').fill(GOLDEN.title);
  await page.locator('#guide-summary').fill(GOLDEN.summary);
  for (const step of GOLDEN.steps) {
    await page.getByRole('textbox', { name: `Why attend ${step.session.code}` }).fill(step.note);
  }
  await waitDraft(page, GOLDEN);
  await page.reload();
  await ready(page);
  await expectDraft(page, GOLDEN);
  await expect(page.locator('#nav-saved-count')).toHaveText('0');
  return GOLDEN;
}

export async function editGolden(page) {
  await page.locator('#guide-title').fill(EDITED.title);
  await page.locator('#guide-summary').fill(EDITED.summary);
  await page.getByRole('textbox', { name: 'Why attend DEV100' }).fill(EDITED.steps[0].note);
  await page.getByRole('button', { name: 'Move DEV100 earlier', exact: true }).click();
  await page.getByRole('button', { name: 'Remove DEV400 from custom guide', exact: true }).click();
  await waitDraft(page, EDITED);
}

export async function shareGuide(page, testInfo) {
  await page.locator('#share-guide').click();
  await expect(page.locator('#share-result')).toBeVisible();
  const url = await page.locator('#share-url').inputValue();
  expect(new URL(url).pathname).toBe(eventPath());
  expect(new URL(url).searchParams.get('guide')).toMatch(/^2\./);
  expect(new URL(url).hash).toBe('#my-guide');
  expect([...new URL(url).searchParams.keys()]).toEqual(['guide']);
  if (testInfo) await testInfo.attach('actual-share-url', { body: url, contentType: 'text/plain' });
  return url;
}

export function independentSharePayload(url) {
  const token = new URL(url).searchParams.get('guide');
  expect(token).toMatch(/^2\./);
  return JSON.parse(inflateSync(Buffer.from(token.slice(2), 'base64url')).toString('utf8'));
}

export async function expectShared(page, expected = GOLDEN) {
  await expect(page.locator('#shared-guide')).toBeVisible();
  await expect(page.locator('#guide-editor')).toBeHidden();
  await expect(page.locator('#shared-guide-title')).toHaveText(expected.title);
  await expect(page.locator('#shared-guide-summary')).toHaveText(expected.summary);
  const rows = page.locator('#shared-guide-steps > li');
  await expect(rows).toHaveCount(expected.steps.length);
  for (const [index, step] of expected.steps.entries()) {
    const row = rows.nth(index);
    await expect(row.locator('.custom-step-number')).toHaveText(String(index + 1).padStart(2, '0'));
    await expect(row.getByRole('button', { name: step.session.title, exact: true })).toBeVisible();
    await expect(row.locator('.custom-step-meta')).toContainText(step.session.code);
    await expect(row.locator('.custom-step-note')).toHaveText(step.note || 'No additional attendance note from the author.');
  }
}

export async function recipientContext(browser, testInfo, run) {
  const use = effectiveOptions.get(testInfo) || testInfo.project.use;
  const options = { acceptDownloads: true };
  for (const key of ['baseURL', 'viewport', 'screen', 'isMobile', 'hasTouch', 'userAgent',
    'deviceScaleFactor', 'locale', 'timezoneId', 'colorScheme']) {
    if (use[key] !== undefined) options[key] = use[key];
  }
  const context = await browser.newContext(options);
  const problems = observeContext(context);
  const diagnostics = collectDiagnostics(context);
  await guardTelemetry(context, problems);
  const page = await context.newPage();
  try {
    await run(page, context);
  } catch (error) {
    try {
      await page.screenshot({ path: testInfo.outputPath('recipient-failure.png'), fullPage: true });
    } catch (evidenceError) {
      problems.push(`Recipient failure screenshot could not be captured: ${evidenceError.message}`);
    }
    throw error;
  } finally {
    await attachRuntime(context, testInfo, diagnostics, 'recipient');
    await context.close();
    expect(problems, 'Independent recipient browser errors/dialogs').toEqual([]);
  }
}

export async function captureCalendar(page, control, expected, testInfo, options = {}) {
  const downloads = [];
  const collect = (download) => downloads.push(download);
  page.on('download', collect);
  try {
    const pending = page.waitForEvent('download');
    await control.click();
    const download = await pending;
    expect(await download.failure()).toBeNull();
    expect(download.suggestedFilename()).toMatch(/\.ics$/);
    expect(download.suggestedFilename()).toContain((options.event || EVENTS.C).id);
    if (options.filename) expect(download.suggestedFilename()).toBe(options.filename);
    const path = testInfo.outputPath(`${options.artifact || 'calendar'}-${download.suggestedFilename()}`);
    await download.saveAs(path);
    await testInfo.attach(options.artifact || 'actual-calendar', { path, contentType: 'text/calendar' });
    const calendar = assertCalendar(await readFile(path), expected, options);
    expect(downloads, 'One click must produce exactly one real download').toHaveLength(1);
    return calendar;
  } finally {
    page.off('download', collect);
  }
}
