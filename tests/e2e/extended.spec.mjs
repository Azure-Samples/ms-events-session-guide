import { readFile } from 'node:fs/promises';
import ICAL from 'ical.js';
import {
  test, expect, C, FACTS, ready, card, findSession, saveOccurrence, closeSession,
  addSession, waitAgenda, waitDraft, captureCalendar, recipientContext,
  expectShared, independentSharePayload,
} from './helpers.mjs';
import { assertCalendar } from './calendar-oracle.mjs';
import {
  EXTENDED_PATH, EXTENDED_TOPIC, EXTENDED_FACTS, LIMIT_CODES, LIMIT_FACTS,
} from './extended-fixtures.mjs';

const agendaRows = (page) => page.locator('#agenda-list article');
const draftRows = (page) => page.locator('#draft-steps > li');

async function gotoExtended(page) {
  await page.goto('/extended/events/contoso-dev-days-2026/');
  await ready(page);
  await page.locator('#timezone').selectOption('UTC');
  await expect(page.locator('#timezone')).toHaveValue('UTC');
  expect(new URL(page.url()).pathname).toBe(EXTENDED_PATH);
}

async function expectDraftCodes(page, codes) {
  await expect(page.locator('#draft-count')).toHaveText(`${codes.length} / 20 SESSIONS`);
  await expect(draftRows(page)).toHaveCount(codes.length);
  await expect(draftRows(page).locator('.custom-step-meta')).toHaveText(
    codes.map((code) => new RegExp(`^${code}\\b`)),
  );
}

async function expectPageCodes(page, codes, total) {
  await expect(page.locator('#session-grid .session-code')).toHaveText(codes);
  await expect(page.locator('#shown-count')).toHaveText(`Showing ${codes.length} of ${total}`);
  await expect(page.locator('#results-count')).toHaveText(`${total} of 31 sessions · repeat times grouped`);
  expect(new Set(await page.locator('#session-grid .session-code').allTextContents()).size).toBe(codes.length);
}

test('E2E-017 overlap is flagged, removal clears it, touching boundaries do not conflict', async ({ page }, testInfo) => {
  await gotoExtended(page);
  await saveOccurrence(page, FACTS.C1b);
  await saveOccurrence(page, EXTENDED_FACTS.overlap);
  await waitAgenda(page, ['S100-b', 'S500-a']);
  await expect(page.locator('#toast')).toContainText(/overlap/i);
  await expect(page.locator('#agenda-summary')).toContainText('2 sessions overlap');
  await expect(page.locator('#agenda-list article.has-conflict')).toHaveCount(2);
  await expect(agendaRows(page).filter({ hasText: 'Overlap control' }).locator('.conflict-label')).toHaveText('Overlaps DEV100');
  await expect(agendaRows(page).filter({ hasText: 'Contoso keynote' }).locator('.conflict-label')).toHaveText('Overlaps DEV500');
  await captureCalendar(page, page.locator('#export-calendar'), [FACTS.C1b, EXTENDED_FACTS.overlap], testInfo, {
    artifact: 'overlapping-selection',
  });
  await expect(page.locator('#toast')).toContainText('2 overlapping sessions included');

  await page.getByRole('button', { name: 'Remove DEV500 from agenda', exact: true }).click();
  await waitAgenda(page, ['S100-b']);
  await expect(page.locator('#agenda-summary')).toContainText('No overlapping times.');
  await expect(page.locator('#agenda-list .conflict-label')).toHaveCount(0);
  await saveOccurrence(page, EXTENDED_FACTS.boundary);
  await waitAgenda(page, ['S100-b', 'S600-a']);
  await expect(page.locator('#agenda-summary')).toContainText('No overlapping times.');
  await expect(page.locator('#agenda-list article.has-conflict')).toHaveCount(0);
  await captureCalendar(page, page.locator('#export-calendar'), [FACTS.C1b, EXTENDED_FACTS.boundary], testInfo, {
    artifact: 'touching-selection',
  });
  await expect(page.locator('#toast')).not.toContainText('overlapping sessions included');
  await page.reload();
  await ready(page);
  await expect(agendaRows(page)).toHaveCount(2);
  await expect(page.locator('#agenda-summary')).toContainText('No overlapping times.');
});

test('E2E-026 twentieth unique session is accepted, twenty-first rejected, removal recovers', async ({ page }) => {
  test.setTimeout(120_000);
  await gotoExtended(page);
  for (const [index, fact] of LIMIT_FACTS.slice(0, 20).entries()) {
    await addSession(page, fact);
    await expectDraftCodes(page, LIMIT_CODES.slice(0, index + 1));
  }
  const initialDraft = {
    version: 2, eventId: C, title: 'My Contoso Dev Days 2026 (fixture) guide', summary: '',
    steps: LIMIT_FACTS.slice(0, 20).map((session) => ({ session, note: '' })),
  };
  await waitDraft(page, initialDraft);
  await addSession(page, LIMIT_FACTS[20]);
  await expect(page.locator('#toast')).toHaveText('Your guide can contain up to 20 sessions. Remove one before adding another.');
  await expectDraftCodes(page, LIMIT_CODES.slice(0, 20));
  await waitDraft(page, initialDraft);
  await expect(card(page, 'X021').getByRole('button', { name: 'Add X021 to custom guide', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Remove X005 from custom guide', exact: true }).click();
  const recoveredCodes = LIMIT_CODES.slice(0, 20).filter((code) => code !== 'X005');
  await expectDraftCodes(page, recoveredCodes);
  await addSession(page, LIMIT_FACTS[20]);
  recoveredCodes.push('X021');
  await expectDraftCodes(page, recoveredCodes);
  await waitDraft(page, {
    ...initialDraft,
    steps: [...LIMIT_FACTS.slice(0, 20).filter((fact) => fact.code !== 'X005'), LIMIT_FACTS[20]]
      .map((session) => ({ session, note: '' })),
  });
  await expect(page.locator('#nav-saved-count')).toHaveText('0');
  await page.reload();
  await ready(page);
  await expectDraftCodes(page, recoveredCodes);
});

test('E2E-027/lengths native text insertion enforces 100/600/600 UTF-16 limits before sharing', async ({ page, browser }, testInfo) => {
  await gotoExtended(page);
  await addSession(page, LIMIT_FACTS[0]);
  const boundary = (prefix, length) => prefix + 'x'.repeat(length - prefix.length);
  const title = boundary('Café 東京 🚀,;\\ "', 100);
  const summary = boundary('Summary café 東京 🚀,;\\ "\nSecond line: ', 600);
  const note = boundary('Note café 東京 🚀,;\\ "\nSecond line: ', 600);
  const inputs = [
    { control: page.locator('#guide-title'), value: title, limit: 100 },
    { control: page.locator('#guide-summary'), value: summary, limit: 600 },
    { control: page.getByRole('textbox', { name: 'Why attend X001' }), value: note, limit: 600 },
  ];
  for (const { control, value, limit } of inputs) {
    expect(value.length).toBe(limit);
    await expect(control).toHaveAttribute('maxlength', String(limit));
    await control.fill('');
    await control.focus();
    // Native insertion exercises maxlength; a scripted fill alone is not evidence.
    await page.keyboard.insertText(value);
    await expect(control).toHaveValue(value);
    await page.keyboard.insertText('Z');
    await expect(control).toHaveValue(value);
  }
  const expected = {
    version: 2, eventId: C, title, summary,
    steps: [{ session: LIMIT_FACTS[0], note }],
  };
  await waitDraft(page, expected);
  await page.locator('#share-guide').click();
  await expect(page.locator('#share-result')).toBeVisible();
  const url = await page.locator('#share-url').inputValue();
  expect(new URL(url).pathname).toBe(EXTENDED_PATH);
  expect(independentSharePayload(url)).toEqual(expected);
  await testInfo.attach('boundary-length-share-url', { body: url, contentType: 'text/plain' });
  await recipientContext(browser, testInfo, async (recipient) => {
    await recipient.goto(url);
    await ready(recipient);
    await expectShared(recipient, expected);
    await expect(recipient.locator('#nav-saved-count')).toHaveText('0');
  });
  await page.reload();
  await ready(page);
  await expect(page.locator('#guide-title')).toHaveValue(title);
  await expect(page.locator('#guide-summary')).toHaveValue(summary);
  await expect(page.getByRole('textbox', { name: 'Why attend X001' })).toHaveValue(note);
});

test('E2E-076 exact show-more pages reset on filtering and repeat actions select matching occurrence', async ({ page }, testInfo) => {
  await gotoExtended(page);
  await page.locator('#topic').selectOption(EXTENDED_TOPIC);
  await page.locator('#sort').selectOption('time');
  await expectPageCodes(page, LIMIT_CODES.slice(0, 9), 24);
  await page.locator('#load-more').click();
  await expectPageCodes(page, LIMIT_CODES.slice(0, 18), 24);
  await page.locator('#load-more').click();
  await expectPageCodes(page, LIMIT_CODES, 24);
  await expect(page.locator('#load-more')).toBeHidden();

  await page.locator('#day').selectOption('2026-11-11');
  await expectPageCodes(page, LIMIT_CODES.slice(0, 9), 24);
  await expect(page.locator('#load-more')).toBeVisible();
  await page.locator('#load-more').click();
  await expectPageCodes(page, LIMIT_CODES.slice(0, 18), 24);
  await page.getByRole('searchbox', { name: 'Search sessions' }).fill('X0');
  await expect.poll(() => new URL(page.url()).searchParams.get('q')).toBe('X0');
  await expectPageCodes(page, LIMIT_CODES.slice(0, 9), 24);
  await page.locator('#reset-filters').click();
  await expect(page.locator('#shown-count')).toHaveText('Showing 9 of 31');
  await expect(page.locator('#session-grid article')).toHaveCount(9);

  const repeated = await findSession(page, 'DEV100', '2026-11-10');
  await expect(page.locator('#results-count')).toHaveText('1 of 31 sessions · repeat times grouped');
  await repeated.getByRole('button', { name: 'Session brief', exact: true }).click();
  const dialog = page.locator('#session-dialog');
  await expect(dialog.locator('.occurrence')).toHaveCount(2);
  await expect(dialog).toContainText('1 of these 2 occurrences match your current catalog filters.');
  await expect(dialog.locator('.occurrence.is-matching')).toHaveCount(1);
  const matching = dialog.locator('.occurrence.is-matching');
  await expect(matching).toContainText('Tuesday, Nov 10');
  await expect(matching.locator('[data-save-instance]')).toHaveAttribute('data-save-instance', 'S100-b');
  await matching.locator('[data-save-instance="S100-b"]').click();
  await expect(dialog.locator('[data-save-instance="S100-b"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(dialog.locator('[data-save-instance="S100-a"]')).toHaveAttribute('aria-pressed', 'false');
  await captureCalendar(page, matching.getByRole('button', { name: /^Download calendar event for DEV100,/ }), [FACTS.C1b], testInfo, {
    artifact: 'filtered-repeat-selected-time',
  });
  await closeSession(page);
  await waitAgenda(page, ['S100-b']);
  await expect(agendaRows(page)).toHaveCount(1);
  await expect(agendaRows(page)).toContainText('2:00 PM - 3:00 PM UTC');
});

for (const variant of ['conflicting selection', 'both repeated occurrences']) {
  test(`E2E-058 ${variant} retains all events and stable distinct UIDs across two exports`, async ({ page }, testInfo) => {
    await gotoExtended(page);
    const selected = variant === 'conflicting selection' ?
      [FACTS.C1b, EXTENDED_FACTS.overlap] : [FACTS.C1a, FACTS.C1b];
    for (const fact of selected) await saveOccurrence(page, fact);
    await waitAgenda(page, selected.map((fact) => fact.id));
    await expect(agendaRows(page)).toHaveCount(2);
    if (variant === 'conflicting selection') {
      await expect(page.locator('#agenda-summary')).toContainText('2 sessions overlap');
      await expect(page.locator('#agenda-list article.has-conflict')).toHaveCount(2);
    } else {
      await expect(page.locator('#agenda-summary')).toContainText('No overlapping times.');
    }
    const expectedUIDs = variant === 'conflicting selection' ? [
      'contoso-dev-days-2026:S100-b@ms-events-guide',
      'contoso-dev-days-2026:S500-a@ms-events-guide',
    ] : [
      'contoso-dev-days-2026:S100-a@ms-events-guide',
      'contoso-dev-days-2026:S100-b@ms-events-guide',
    ];
    for (const attempt of [1, 2]) {
      const calendar = await captureCalendar(page, page.locator('#export-calendar'), selected, testInfo, {
        artifact: `export-${attempt}`,
      });
      const uids = calendar.getAllSubcomponents('vevent').map((entry) => entry.getFirstPropertyValue('uid'));
      expect(uids).toEqual(expectedUIDs);
      expect(new Set(uids).size).toBe(2);
      if (variant === 'conflicting selection') {
        await expect(page.locator('#toast')).toContainText('2 overlapping sessions included');
      }
    }
  });
}

test('E2E-060 BROWSER DOWNLOAD only: escaped Unicode text and octet folding round-trip via ical.js', async ({ page }, testInfo) => {
  await gotoExtended(page);
  await addSession(page, EXTENDED_FACTS.text);
  const privateNote = 'E2E_NOTE_NOT_FOR_CALENDAR_42 personal note, café; \\ 東京 🚀\nNever export me.';
  await page.getByRole('textbox', { name: 'Why attend TXT900' }).fill(privateNote);
  await waitDraft(page, {
    version: 2, eventId: C, title: 'My Contoso Dev Days 2026 (fixture) guide', summary: '',
    steps: [{ session: EXTENDED_FACTS.text, note: privateNote }],
  });
  const pending = page.waitForEvent('download');
  await page.locator('#export-draft-guide').click();
  const download = await pending;
  expect(await download.failure()).toBeNull();
  expect(download.suggestedFilename()).toMatch(/^contoso-dev-days-2026-.*\.ics$/);
  const path = testInfo.outputPath('E2E-060-browser-download.ics');
  await download.saveAs(path);
  await testInfo.attach('E2E-060-actual-browser-download-NOT-client-import', { path, contentType: 'text/calendar' });
  const bytes = await readFile(path);
  const calendar = assertCalendar(bytes, [EXTENDED_FACTS.text], { forbidden: [privateNote] });
  const raw = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  expect(raw).toContain('\r\n ');
  expect(raw).not.toContain(privateNote);
  const unfolded = raw.replace(/\r\n[ \t]/g, '');
  expect(unfolded).toContain('SUMMARY:TXT900: Café\\, code\\; paths \\\\ 東京 🚀\r\n');
  expect(unfolded).toContain('LOCATION:Room\\, Nord\\; aile \\\\ 東京 🚀\r\n');
  expect(unfolded).toContain('\\nEND:VEVENT\\nBEGIN:VEVENT\\nSUMMARY:This must stay description text.');
  expect((raw.match(/^BEGIN:VEVENT\r$/gm) || [])).toHaveLength(1);
  expect((raw.match(/^END:VEVENT\r$/gm) || [])).toHaveLength(1);
  expect(raw).not.toContain('\uFFFD');
  for (const line of raw.split('\r\n')) expect(Buffer.byteLength(line, 'utf8')).toBeLessThanOrEqual(75);
  const event = new ICAL.Event(calendar.getFirstSubcomponent('vevent'));
  expect(event.summary).toBe('TXT900: Café, code; paths \\ 東京 🚀');
  expect(event.location).toBe('Room, Nord; aile \\ 東京 🚀');
  expect(event.description).toContain(EXTENDED_FACTS.text.description);
  expect(event.description).toContain('Speakers: Zoë, 李雷; Renée \\ Dev');
  await testInfo.attach('E2E-060-scope', {
    body: 'Browser download and independent ical.js parsing verified. Actual calendar-client import remains a separate blocked/manual case; it is not exercised or claimed by this test.',
    contentType: 'text/plain',
  });
});
