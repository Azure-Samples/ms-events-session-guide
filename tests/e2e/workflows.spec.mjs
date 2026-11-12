import {
  test, expect, C, F, FACTS, GOLDEN, EDITED, eventPath, gotoEvent, ready, card,
  findSession, saveOccurrence, addSession, closeSession, waitAgenda, waitDraft,
  goldenGuide, editGolden, expectDraft, shareGuide, independentSharePayload,
  expectShared, recipientContext, captureCalendar,
} from './helpers.mjs';

const agendaRows = (page) => page.locator('#agenda-list article');
const draftRows = (page) => page.locator('#draft-steps > li');
const emptyDraft = {
  version: 2, eventId: C, title: 'My Contoso Dev Days 2026 (fixture) guide', summary: '', steps: [],
};
const recipientDraft = {
  ...emptyDraft, title: 'Recipient plan', summary: 'Keep this local.',
  steps: [{ session: FACTS.C3, note: 'Recipient C3 note.' }],
};
const fSnapshot = {
  ...FACTS.F1, sessionId: 'S100', type: 'Workshop', level: 'Advanced (300)',
  topics: ['Government'], delivery: ['In-person', 'Online'], audiences: [], viewing: ['Live'], duration: 60,
  start: '2027-03-13T15:00:00-06:00', end: '2027-03-13T16:00:00-06:00',
};
const fDraft = {
  version: 2, eventId: F, title: 'F isolation draft', summary: 'Keep F unchanged.',
  steps: [{ session: fSnapshot, note: 'F1 sentinel note.' }],
};

async function assertAgenda(page, facts) {
  await expect(page.locator('#nav-saved-count')).toHaveText(String(facts.length));
  await expect(agendaRows(page)).toHaveCount(facts.length);
  for (const fact of facts) {
    const row = agendaRows(page).filter({
      has: page.getByRole('button', { name: fact.title, exact: true }),
    });
    // Repeats have identical titles; their independently pinned day/time is checked
    // in the dialog or downloaded calendar rather than guessing an agenda row.
    await expect(row.first()).toContainText(fact.code);
    if (!fact.start) await expect(row).toContainText('Time not listed');
  }
}

async function agendaA(page) {
  for (const fact of [FACTS.C1b, FACTS.C2, FACTS.CU]) await saveOccurrence(page, fact);
  await waitAgenda(page, ['S100-b', 'S200-a', 'S400-a']);
}

async function arrangeRecipient(page) {
  await gotoEvent(page);
  await agendaA(page);
  await addSession(page, FACTS.C3);
  await page.locator('#guide-title').fill(recipientDraft.title);
  await page.locator('#guide-summary').fill(recipientDraft.summary);
  await page.getByRole('textbox', { name: 'Why attend DEV300' }).fill(recipientDraft.steps[0].note);
  await waitDraft(page, recipientDraft);
  await page.reload();
  await ready(page);
  await expectDraft(page, recipientDraft);
  await assertAgenda(page, [FACTS.C1b, FACTS.C2, FACTS.CU]);
}

async function arrangeF(page) {
  await gotoEvent(page, F);
  await saveOccurrence(page, FACTS.F1);
  await addSession(page, FACTS.F1);
  await page.locator('#guide-title').fill(fDraft.title);
  await page.locator('#guide-summary').fill(fDraft.summary);
  await page.getByRole('textbox', { name: 'Why attend FAB100' }).fill(fDraft.steps[0].note);
  await waitAgenda(page, ['S100-a'], F);
  await waitDraft(page, fDraft, F);
  await page.reload();
  await ready(page);
  await expectDraft(page, fDraft);
  await assertAgenda(page, [FACTS.F1]);
}

async function verifyF(page) {
  await gotoEvent(page, F);
  await page.reload();
  await ready(page);
  await expectDraft(page, fDraft);
  await assertAgenda(page, [FACTS.F1]);
  await expect(agendaRows(page)).toContainText('9:00 PM - 10:00 PM UTC');
}

async function selectLaunch(page) {
  await page.locator('#guide').getByRole('button', { name: 'Startup', exact: true }).click();
  await page.locator('#path-options').getByRole('button', { name: /Launch fast/ }).click();
}

async function snapshotBriefs(page, expected = GOLDEN, shared = true) {
  const rows = page.locator(shared ? '#shared-guide-steps > li' : '#draft-steps > li');
  for (const [index, { session }] of expected.steps.entries()) {
    await rows.nth(index).getByRole('button', { name: session.title, exact: true }).click();
    const dialog = page.locator('#session-dialog');
    await expect(dialog.getByRole('heading', { name: session.title, exact: true })).toBeVisible();
    await expect(dialog).toContainText('Saved snapshot');
    await expect(dialog.locator('.dialog-description')).toHaveText(session.description);
    await expect(dialog.locator('.dialog-speakers')).toHaveText(`Speakers: ${session.speakers}`);
    await expect(dialog.locator('.dialog-badges')).toContainText(session.code);
    await expect(dialog.locator('.dialog-badges')).toContainText(session.type);
    await expect(dialog.locator('.dialog-badges')).toContainText(session.level);
    await expect(dialog.locator('.topic-tag')).toHaveText(session.topics);
    await expect(dialog.locator('.occurrence')).toHaveCount(1);
    await expect(dialog.locator('.occurrence')).toContainText(session.location);
    await expect(dialog.locator('.occurrence')).toContainText('In-person');
    await expect(dialog.locator('[data-save-instance]')).toHaveCount(0);
    if (session.start) {
      await expect(dialog.locator('.occurrence')).toContainText('Tuesday, Nov 10');
      await expect(dialog.locator('.occurrence')).toContainText(
        session.code === 'DEV100' ? '2:00 PM - 3:00 PM UTC' : '3:30 PM - 4:15 PM UTC',
      );
      await expect(dialog.locator('.occurrence')).toContainText(`${session.duration} min`);
    } else {
      await expect(dialog.locator('.occurrence')).toContainText('Time not listed');
      await expect(dialog.locator('.occurrence')).toContainText('Calendar unavailable: time not listed');
      await expect(dialog.locator('.occurrence').getByRole('button')).toHaveCount(0);
    }
    await closeSession(page);
  }
}

test('E2E-009 filtered-out saved repeat opens management without toggling either time', async ({ page }) => {
  await gotoEvent(page);
  await saveOccurrence(page, FACTS.C1b);
  await waitAgenda(page, ['S100-b']);
  const session = await findSession(page, 'DEV100', '2026-11-09');
  await session.getByRole('button', { name: 'Manage saved times for DEV100' }).click();
  await expect(page.locator('[data-save-instance="S100-b"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('[data-save-instance="S100-a"]')).toHaveAttribute('aria-pressed', 'false');
  await assertAgenda(page, [FACTS.C1b]);
  await expect(draftRows(page)).toHaveCount(0);
  await page.locator('[data-save-instance="S100-b"]').click();
  await closeSession(page);
  await waitAgenda(page, []);
  await page.reload();
  await ready(page);
  await assertAgenda(page, []);
  await card(page, 'DEV100').getByRole('button', { name: 'Session brief', exact: true }).click();
  await expect(page.locator('#session-dialog [aria-pressed="true"]')).toHaveCount(0);
});

test('E2E-010 single Save restores across reload and directory navigation', { tag: '@smoke' }, async ({ page }) => {
  await gotoEvent(page);
  const session = await findSession(page, 'DEV200');
  await session.getByRole('button', { name: 'Save DEV200', exact: true }).click();
  await waitAgenda(page, ['S200-a']);
  await page.locator('.main-nav').getByRole('link', { name: /My agenda/ }).click();
  await assertAgenda(page, [FACTS.C2]);
  await expect(agendaRows(page)).toContainText('3:30 PM - 4:15 PM UTC');
  await page.reload();
  await ready(page);
  await assertAgenda(page, [FACTS.C2]);
  await page.goto('/');
  await page.getByRole('link', { name: /Contoso Dev Days 2026/ }).first().click();
  await ready(page);
  await page.locator('#timezone').selectOption('UTC');
  await assertAgenda(page, [FACTS.C2]);
  await expect(agendaRows(page)).toContainText('3:30 PM - 4:15 PM UTC');
  await expect(card(page, 'DEV200').getByRole('button', { name: 'Manage saved times for DEV200' })).toHaveAttribute('aria-pressed', 'true');
  await expect(draftRows(page)).toHaveCount(0);
});

test('E2E-011/unfiltered repeated Save requires choosing the second occurrence', { tag: '@smoke' }, async ({ page }) => {
  await gotoEvent(page);
  const session = await findSession(page, 'DEV100');
  await session.getByRole('button', { name: 'Save DEV100', exact: true }).click();
  await expect(page.locator('#session-dialog')).toBeVisible();
  await expect(page.locator('#session-dialog [aria-pressed="true"]')).toHaveCount(0);
  await assertAgenda(page, []);
  await page.locator('[data-save-instance="S100-b"]').click();
  await expect(page.locator('[data-save-instance="S100-b"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('[data-save-instance="S100-a"]')).toHaveAttribute('aria-pressed', 'false');
  await closeSession(page);
  await waitAgenda(page, ['S100-b']);
  await page.reload();
  await ready(page);
  await assertAgenda(page, [FACTS.C1b]);
  await expect(card(page, 'DEV100').getByRole('button', { name: 'Manage saved times for DEV100' })).toHaveAttribute('aria-pressed', 'true');
  await card(page, 'DEV100').getByRole('button', { name: 'Session brief', exact: true }).click();
  await expect(page.locator('[data-save-instance="S100-b"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('[data-save-instance="S100-a"]')).toHaveAttribute('aria-pressed', 'false');
});

for (const variant of ['agenda-remove', 'dialog-toggle']) {
  test(`E2E-012/${variant} removal synchronizes and permits one resave`, { tag: variant === 'agenda-remove' ? ['@smoke'] : [] }, async ({ page }) => {
    await gotoEvent(page);
    await saveOccurrence(page, FACTS.C2);
    await waitAgenda(page, ['S200-a']);
    if (variant === 'agenda-remove') {
      await page.locator('#agenda-list').getByRole('button', { name: 'Remove DEV200 from agenda' }).click();
    } else {
      await card(page, 'DEV200').getByRole('button', { name: 'Session brief', exact: true }).click();
      await page.locator('[data-save-instance="S200-a"]').click();
      await expect(page.locator('[data-save-instance="S200-a"]')).toHaveAttribute('aria-pressed', 'false');
      await closeSession(page);
    }
    await waitAgenda(page, []);
    await page.reload();
    await ready(page);
    await assertAgenda(page, []);
    await expect(card(page, 'DEV200').getByRole('button', { name: 'Save DEV200', exact: true })).toHaveAttribute('aria-pressed', 'false');
    await card(page, 'DEV200').getByRole('button', { name: 'Session brief', exact: true }).click();
    await expect(page.locator('[data-save-instance="S200-a"]')).toHaveAttribute('aria-pressed', 'false');
    await page.locator('[data-save-instance="S200-a"]').click();
    await closeSession(page);
    await waitAgenda(page, ['S200-a']);
    await page.reload();
    await ready(page);
    await assertAgenda(page, [FACTS.C2]);
  });
}

test('E2E-013 saving a path twice preserves the chosen repeat', async ({ page }) => {
  await gotoEvent(page);
  await saveOccurrence(page, FACTS.C1b);
  await selectLaunch(page);
  await page.locator('#save-path').click();
  await page.locator('#save-path').click();
  await waitAgenda(page, ['S100-b', 'S200-a', 'S300-a']);
  await page.reload();
  await ready(page);
  await assertAgenda(page, [FACTS.C1b, FACTS.C2, FACTS.C3]);
  await (await findSession(page, 'DEV100')).getByRole('button', { name: 'Session brief', exact: true }).click();
  await expect(page.locator('[data-save-instance="S100-a"]')).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('[data-save-instance="S100-b"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(draftRows(page)).toHaveCount(0);
});

test('E2E-015 saving an unscheduled session persists without a calendar time', async ({ page }) => {
  await gotoEvent(page);
  await saveOccurrence(page, FACTS.CU);
  await waitAgenda(page, ['S400-a']);
  await page.reload();
  await ready(page);
  await assertAgenda(page, [FACTS.CU]);
  await expect(page.locator('#agenda-list .agenda-day')).toHaveText('Time not listed');
  await expect(page.locator('#export-calendar')).toBeDisabled();
  await expect(card(page, 'DEV400')).toContainText('Calendar unavailable: time not listed');
  await expect(card(page, 'DEV400').getByRole('button', { name: /Download calendar/ })).toHaveCount(0);
});

test('E2E-016 clear agenda cancellation and confirmation preserve draft, share, and other event', async ({ page, browser }, testInfo) => {
  await goldenGuide(page);
  const url = await shareGuide(page, testInfo);
  await agendaA(page);
  await arrangeF(page);
  await gotoEvent(page);
  await page.locator('#clear-agenda').click();
  await page.locator('#cancel-clear').click();
  await assertAgenda(page, [FACTS.C1b, FACTS.C2, FACTS.CU]);
  await page.locator('#clear-agenda').click();
  await page.locator('#confirm-clear').click();
  await waitAgenda(page, []);
  await page.reload();
  await ready(page);
  await assertAgenda(page, []);
  await expectDraft(page, GOLDEN);
  await page.locator('#reset-filters').click();
  await expect(page.locator('#session-grid .save-button[aria-label^="Save "]')).toHaveCount(4);
  await verifyF(page);
  await recipientContext(browser, testInfo, async (recipient) => {
    await recipient.goto(new URL(url).pathname + new URL(url).search + new URL(url).hash);
    await ready(recipient);
    await expectShared(recipient);
    await assertAgenda(recipient, []);
  });
});

test('E2E-018 colliding occurrence IDs do not mix agenda or custom drafts', { tag: '@smoke' }, async ({ page }) => {
  await gotoEvent(page);
  await saveOccurrence(page, FACTS.C1a);
  await addSession(page, FACTS.C2);
  const cDraft = { ...emptyDraft, steps: [{ session: FACTS.C2, note: '' }] };
  await waitAgenda(page, ['S100-a']);
  await waitDraft(page, cDraft);
  await arrangeF(page);
  await gotoEvent(page);
  await page.reload();
  await ready(page);
  await expectDraft(page, cDraft);
  await assertAgenda(page, [FACTS.C1a]);
  await expect(agendaRows(page)).toContainText('2:00 PM - 3:00 PM UTC');
  await expect(agendaRows(page)).not.toContainText('FAB100');
  await verifyF(page);
});

test('E2E-020 Add is independent of Save and duplicates have visible feedback', async ({ page }) => {
  await gotoEvent(page);
  await addSession(page, FACTS.C2);
  const already = card(page, 'DEV200').getByRole('button', { name: 'DEV200 is already in custom guide' });
  await expect(already).toHaveAttribute('aria-pressed', 'true');
  await already.click();
  await expect(page.locator('#toast')).toContainText('already in your custom guide');
  const expected = { ...emptyDraft, steps: [{ session: FACTS.C2, note: '' }] };
  await waitDraft(page, expected);
  await page.reload();
  await ready(page);
  await expectDraft(page, expected);
  await assertAgenda(page, []);
  await expect(card(page, 'DEV200').getByRole('button', { name: 'Save DEV200', exact: true })).toHaveAttribute('aria-pressed', 'false');
});

for (const variant of ['filtered-card', 'filtered-dialog', 'saved-time-independent-card', 'saved-time-independent-dialog']) {
  test(`E2E-021/${variant} Add chooses filter time rather than saved agenda time`, async ({ page }, testInfo) => {
    await gotoEvent(page);
    const independent = variant.startsWith('saved-time');
    if (independent) {
      await saveOccurrence(page, FACTS.C1b);
      await waitAgenda(page, ['S100-b']);
    }
    const fact = independent ? FACTS.C1a : FACTS.C1b;
    await addSession(page, fact, {
      day: independent ? '' : '2026-11-10', dialog: variant.endsWith('dialog'),
    });
    const expected = { ...emptyDraft, steps: [{ session: fact, note: '' }] };
    await waitDraft(page, expected);
    await page.reload();
    await ready(page);
    await expectDraft(page, expected);
    await draftRows(page).getByRole('button', { name: fact.title, exact: true }).click();
    await expect(page.locator('#session-dialog')).toContainText('Saved snapshot');
    await expect(page.locator('#session-dialog .occurrence')).toContainText(independent ? 'Monday, Nov 9' : 'Tuesday, Nov 10');
    await captureCalendar(page, page.locator('#session-dialog').getByRole('button', { name: /Download calendar event/ }), [fact], testInfo);
    await closeSession(page);
    await assertAgenda(page, independent ? [FACTS.C1b] : []);
  });
}

test('E2E-021/duplicate-repeat a second occurrence never replaces the existing snapshot or note', async ({ page }) => {
  await gotoEvent(page);
  await addSession(page, FACTS.C1a);
  await page.getByRole('textbox', { name: 'Why attend DEV100' }).fill('Keep first occurrence.');
  const expected = { ...emptyDraft, steps: [{ session: FACTS.C1a, note: 'Keep first occurrence.' }] };
  await waitDraft(page, expected);
  const session = await findSession(page, 'DEV100', '2026-11-10');
  await session.getByRole('button', { name: 'DEV100 is already in custom guide' }).click();
  await expect(page.locator('#toast')).toContainText('already in your custom guide');
  await page.reload();
  await ready(page);
  await expectDraft(page, expected);
  await draftRows(page).getByRole('button', { name: 'Contoso keynote', exact: true }).click();
  await expect(page.locator('#session-dialog .occurrence')).toContainText('Monday, Nov 9');
  await closeSession(page);
  await assertAgenda(page, []);
});

test('E2E-022 edit golden fields, reorder, remove, and restore exact persisted draft', { tag: '@smoke' }, async ({ page }) => {
  await goldenGuide(page);
  await editGolden(page);
  await page.reload();
  await ready(page);
  await expectDraft(page, EDITED);
  await expect(page.getByRole('button', { name: 'Move DEV100 earlier', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Move DEV200 later', exact: true })).toBeDisabled();
  await findSession(page, 'DEV400', 'unscheduled');
  await expect(card(page, 'DEV400').getByRole('button', { name: 'Add DEV400 to custom guide' })).toHaveAttribute('aria-pressed', 'false');
  await assertAgenda(page, []);
});

test('E2E-023 curated copy preserves editorial notes and replacement requires confirmation', async ({ page, browser }, testInfo) => {
  await gotoEvent(page);
  await selectLaunch(page);
  await page.locator('#customize-path').click();
  const launch = {
    ...emptyDraft, title: 'Launch fast', summary: 'Fixture description.',
    steps: [FACTS.C1a, FACTS.C2, FACTS.C3].map((session) => ({
      session, note: `Fixture reason for ${session.code}.\n\nTake this home: Fixture takeaway for ${session.code}.`,
    })),
  };
  await waitDraft(page, launch);
  await expectDraft(page, launch);
  const url = await shareGuide(page, testInfo);
  await page.locator('#guide-title').fill('Do not replace yet.');
  await page.getByRole('textbox', { name: 'Why attend DEV100' }).fill('Keep this edit until confirmed.');
  const modified = {
    ...launch, title: 'Do not replace yet.',
    steps: [{ ...launch.steps[0], note: 'Keep this edit until confirmed.' }, ...launch.steps.slice(1)],
  };
  await waitDraft(page, modified);
  await page.locator('#guide').getByRole('button', { name: 'Nonprofit', exact: true }).click();
  await page.locator('#path-options').getByRole('button', { name: /Impact first/ }).click();
  await page.locator('#customize-path').click();
  await page.locator('#cancel-clear').click();
  await expectDraft(page, modified);
  await page.locator('#customize-path').click();
  await page.locator('#confirm-clear').click();
  const impact = { ...launch, title: 'Impact first', steps: [launch.steps[2]] };
  await waitDraft(page, impact);
  await page.reload();
  await ready(page);
  await expectDraft(page, impact);
  await assertAgenda(page, []);
  await recipientContext(browser, testInfo, async (recipient) => {
    await recipient.goto(relative(url));
    await ready(recipient);
    await expectShared(recipient, launch);
  });
});

for (const title of ['', '   ']) {
  test(`E2E-024/${title ? 'whitespace' : 'empty'} unfinished title persists and can recover sharing`, async ({ page }) => {
    await goldenGuide(page);
    await page.locator('#guide-title').fill(title);
    const unfinished = { ...GOLDEN, title };
    await waitDraft(page, unfinished);
    await page.reload();
    await ready(page);
    await expectDraft(page, unfinished);
    await page.locator('#share-guide').click();
    await expect(page.locator('#guide-message')).toContainText('Guide title cannot be empty');
    await expect(page.locator('#share-result')).toBeHidden();
    await page.locator('#guide-title').fill(GOLDEN.title);
    await waitDraft(page, GOLDEN);
    expect(independentSharePayload(await shareGuide(page))).toEqual(GOLDEN);
  });
}

test('E2E-025/empty no draft steps means no sharing or export', async ({ page }) => {
  await gotoEvent(page);
  await expectDraft(page, emptyDraft);
  await expect(page.locator('#share-guide')).toBeDisabled();
  await expect(page.locator('#export-draft-guide')).toBeDisabled();
  await expect(page.locator('#draft-calendar-help')).toContainText('listed start and end time');
});

test('E2E-025/clear draft confirmation preserves agenda, old snapshot, and other event', async ({ page, browser }, testInfo) => {
  await goldenGuide(page);
  const url = await shareGuide(page, testInfo);
  await agendaA(page);
  await arrangeF(page);
  await gotoEvent(page);
  await page.locator('#clear-draft').click();
  await page.locator('#cancel-clear').click();
  await expectDraft(page, GOLDEN);
  await page.locator('#clear-draft').click();
  await page.locator('#confirm-clear').click();
  await waitDraft(page, emptyDraft);
  await page.reload();
  await ready(page);
  await expectDraft(page, emptyDraft);
  await assertAgenda(page, [FACTS.C1b, FACTS.C2, FACTS.CU]);
  await expect(page.locator('#share-guide')).toBeDisabled();
  await page.locator('#reset-filters').click();
  await expect(page.locator('#session-grid .card-guide-button[aria-pressed="false"]')).toHaveCount(4);
  await verifyF(page);
  await recipientContext(browser, testInfo, async (recipient) => {
    await recipient.goto(relative(url));
    await ready(recipient);
    await expectShared(recipient);
  });
});

test('E2E-027/unicode-markup notes round-trip as inert text in independent recipient', async ({ page, browser }, testInfo) => {
  await gotoEvent(page);
  await addSession(page, FACTS.C2);
  const text = 'Café 🚀, "quotes", backslash \\\n<img src=x onerror=alert(1)>';
  const expected = {
    ...emptyDraft, title: 'Café 🚀 & team', summary: text,
    steps: [{ session: FACTS.C2, note: text }],
  };
  await page.locator('#guide-title').fill(expected.title);
  await page.locator('#guide-summary').fill(text);
  await page.getByRole('textbox', { name: 'Why attend DEV200' }).fill(text);
  await waitDraft(page, expected);
  await page.reload();
  await ready(page);
  await expectDraft(page, expected);
  const url = await shareGuide(page, testInfo);
  expect(independentSharePayload(url)).toEqual(expected);
  await recipientContext(browser, testInfo, async (recipient) => {
    const requests = [];
    recipient.on('request', (request) => {
      if (new URL(request.url()).pathname.endsWith('/x')) requests.push(request.url());
    });
    await recipient.goto(relative(url));
    await ready(recipient);
    await expectShared(recipient, expected);
    await expect(recipient.locator('#shared-guide img')).toHaveCount(0);
    expect(requests).toEqual([]);
  });
});

test('E2E-027/title-trim local whitespace survives but shared title is trimmed', async ({ page, browser }, testInfo) => {
  await gotoEvent(page);
  await addSession(page, FACTS.C2);
  const local = { ...emptyDraft, title: '  E2E trimmed title  ', steps: [{ session: FACTS.C2, note: '' }] };
  await page.locator('#guide-title').fill(local.title);
  await waitDraft(page, local);
  await page.reload();
  await ready(page);
  await expectDraft(page, local);
  const url = await shareGuide(page, testInfo);
  const expected = { ...local, title: 'E2E trimmed title' };
  expect(independentSharePayload(url)).toEqual(expected);
  await recipientContext(browser, testInfo, async (recipient) => {
    await recipient.goto(relative(url));
    await ready(recipient);
    await expectShared(recipient, expected);
  });
});

function relative(url) {
  const parsed = new URL(url);
  return parsed.pathname + parsed.search + parsed.hash;
}

test('E2E-030 independent recipient reconstructs every golden snapshot field', async ({ page, browser }, testInfo) => {
  await goldenGuide(page);
  await page.locator('#theme-toggle').click();
  const url = await shareGuide(page, testInfo);
  expect(independentSharePayload(url)).toEqual(GOLDEN);
  await recipientContext(browser, testInfo, async (recipient) => {
    await recipient.goto(relative(url));
    await ready(recipient);
    await expectShared(recipient);
    await assertAgenda(recipient, []);
    await recipient.locator('#timezone').selectOption('UTC');
    await snapshotBriefs(recipient);
    await recipient.locator('#show-draft').click();
    await expectDraft(recipient, emptyDraft);
    await expect(recipient.locator('#share-result')).toBeHidden();
  });
  await expectDraft(page, GOLDEN);
  await assertAgenda(page, []);
});

test('E2E-031 Open shared view opens the exact returned permalink in a popup', async ({ page }, testInfo) => {
  await goldenGuide(page);
  const url = await shareGuide(page, testInfo);
  const pending = page.waitForEvent('popup');
  await page.locator('#open-guide-link').click();
  const popup = await pending;
  await ready(popup);
  await expect(popup).toHaveURL(url);
  await expectShared(popup);
  await expectDraft(page, GOLDEN);
  await popup.close();
});

test('E2E-032 old and new links remain immutable independent snapshots', async ({ page, browser }, testInfo) => {
  await goldenGuide(page);
  const first = await shareGuide(page, testInfo);
  await editGolden(page);
  await expect(page.locator('#share-result')).toBeHidden();
  const second = await shareGuide(page, testInfo);
  expect(second).not.toBe(first);
  expect(independentSharePayload(first)).toEqual(GOLDEN);
  expect(independentSharePayload(second)).toEqual(EDITED);
  await recipientContext(browser, testInfo, async (recipient) => {
    await recipient.goto(relative(first));
    await ready(recipient);
    await expectShared(recipient);
    await recipient.goto(relative(second));
    await ready(recipient);
    await expectShared(recipient, EDITED);
    await assertAgenda(recipient, []);
  });
});

test('E2E-034 viewing and leaving a share preserve recipient local draft and agenda', async ({ page, browser }, testInfo) => {
  await goldenGuide(page);
  const url = await shareGuide(page, testInfo);
  await recipientContext(browser, testInfo, async (recipient) => {
    await arrangeRecipient(recipient);
    await recipient.goto(relative(url));
    await ready(recipient);
    await expectShared(recipient);
    await assertAgenda(recipient, [FACTS.C1b, FACTS.C2, FACTS.CU]);
    await recipient.locator('#show-draft').click();
    expect(new URL(recipient.url()).searchParams.has('guide')).toBe(false);
    await recipient.reload();
    await ready(recipient);
    await expectDraft(recipient, recipientDraft);
    await assertAgenda(recipient, [FACTS.C1b, FACTS.C2, FACTS.CU]);
    await recipient.goto(relative(url));
    await ready(recipient);
    await expectShared(recipient);
  });
  await expectDraft(page, GOLDEN);
  await assertAgenda(page, []);
});

test('E2E-035 Edit a copy confirms replacement without changing author snapshot or agendas', async ({ page, browser }, testInfo) => {
  await goldenGuide(page);
  const url = await shareGuide(page, testInfo);
  await recipientContext(browser, testInfo, async (recipient) => {
    await arrangeRecipient(recipient);
    await recipient.goto(relative(url));
    await ready(recipient);
    await recipient.locator('#edit-shared').click();
    await recipient.locator('#cancel-clear').click();
    await expectShared(recipient);
    await recipient.locator('#show-draft').click();
    await expectDraft(recipient, recipientDraft);
    await assertAgenda(recipient, [FACTS.C1b, FACTS.C2, FACTS.CU]);
    await recipient.goto(relative(url));
    await ready(recipient);
    await recipient.locator('#edit-shared').click();
    await recipient.locator('#confirm-clear').click();
    await waitDraft(recipient, GOLDEN);
    await recipient.reload();
    await ready(recipient);
    await expectDraft(recipient, GOLDEN);
    await recipient.locator('#guide-title').fill('Recipient edited copy');
    const copy = { ...GOLDEN, title: 'Recipient edited copy' };
    await waitDraft(recipient, copy);
    const copyUrl = await shareGuide(recipient, testInfo);
    expect(independentSharePayload(copyUrl)).toEqual(copy);
    await assertAgenda(recipient, [FACTS.C1b, FACTS.C2, FACTS.CU]);
    await recipient.goto(relative(copyUrl));
    await ready(recipient);
    await expectShared(recipient, copy);
    await recipient.goto(relative(url));
    await ready(recipient);
    await expectShared(recipient);
  });
  await expectDraft(page, GOLDEN);
  await assertAgenda(page, []);
});

for (const variant of ['empty', 'already-saved-repeat']) {
  test(`E2E-036/${variant} shared Save is explicit and idempotent`, async ({ page, browser }, testInfo) => {
    await goldenGuide(page);
    const url = await shareGuide(page, testInfo);
    await recipientContext(browser, testInfo, async (recipient) => {
      await gotoEvent(recipient);
      const alreadySaved = variant === 'already-saved-repeat';
      if (alreadySaved) {
        await saveOccurrence(recipient, FACTS.C1a);
        await waitAgenda(recipient, ['S100-a']);
      }
      await recipient.goto(relative(url));
      await ready(recipient);
      await expectShared(recipient);
      await assertAgenda(recipient, alreadySaved ? [FACTS.C1a] : []);
      await recipient.locator('#save-shared-agenda').click();
      await recipient.locator('#save-shared-agenda').click();
      const repeat = alreadySaved ? FACTS.C1a : FACTS.C1b;
      await waitAgenda(recipient, [repeat.id, 'S200-a', 'S400-a']);
      await recipient.reload();
      await ready(recipient);
      await expectShared(recipient);
      await assertAgenda(recipient, [repeat, FACTS.C2, FACTS.CU]);
      await (await findSession(recipient, 'DEV100')).getByRole('button', { name: 'Session brief', exact: true }).click();
      await expect(recipient.locator(`[data-save-instance="${repeat.id}"]`)).toHaveAttribute('aria-pressed', 'true');
      await expect(recipient.locator(`[data-save-instance="${alreadySaved ? 'S100-b' : 'S100-a'}"]`)).toHaveAttribute('aria-pressed', 'false');
      await closeSession(recipient);
      await recipient.locator('#show-draft').click();
      await expectDraft(recipient, emptyDraft);
    });
    await assertAgenda(page, []);
    await expectDraft(page, GOLDEN);
  });
}

const changedKeynote = {
  ...FACTS.C1b, title: 'Contoso keynote — revised catalog', location: 'Hall Z',
  start: '2026-11-10T18:00:00Z', end: '2026-11-10T19:00:00Z',
};

async function interceptCatalog(page, variant, testInfo) {
  let intercepted = 0;
  testInfo.annotations.push({
    type: 'fault-injection',
    description: `${variant}: intercept the real Contoso catalog response; ${
      variant === 'changed' ? 'change only S100-b title/time/room' : 'remove only S100-b, retaining S100-a'
    }. All draft/share/agenda setup and downloads remain real UI actions.`,
  });
  await page.route(/\/data\/events\/contoso-dev-days-2026\/catalog(?:\.[a-z0-9]+)?\.json(?:\?.*)?$/, async (route) => {
    const response = await route.fetch();
    expect(response.ok(), 'Original catalog prerequisite').toBe(true);
    const payload = await response.json();
    expect(payload.instances.filter((instance) => instance.id === 'S100-b')).toHaveLength(1);
    if (variant === 'changed') {
      payload.instances = payload.instances.map((instance) => instance.id === 'S100-b'
        ? { ...instance, title: changedKeynote.title, location: changedKeynote.location,
          start: changedKeynote.start, end: changedKeynote.end }
        : instance);
    } else {
      payload.instances = payload.instances.filter((instance) => instance.id !== 'S100-b');
    }
    intercepted++;
    await route.fulfill({ response, json: payload });
  });
  return () => expect(intercepted, 'Prepared changed catalog must actually reach the browser').toBeGreaterThan(0);
}

for (const variant of ['shared', 'persisted-draft', 'edit-copy']) {
  test(`E2E-037/${variant} changed current catalog never rewrites golden snapshot facts`, async ({ page, browser }, testInfo) => {
    await goldenGuide(page);
    const url = await shareGuide(page, testInfo);
    if (variant === 'persisted-draft') {
      const assertIntercepted = await interceptCatalog(page, 'changed', testInfo);
      await page.reload();
      await ready(page);
      assertIntercepted();
      await expectDraft(page, GOLDEN);
      await snapshotBriefs(page, GOLDEN, false);
      await captureCalendar(page, page.locator('#export-draft-guide'), [FACTS.C1b, FACTS.C2], testInfo, {
        name: GOLDEN.title, forbidden: [GOLDEN.summary, ...GOLDEN.steps.map((step) => step.note)],
      });
      await assertAgenda(page, []);
      return;
    }
    await recipientContext(browser, testInfo, async (recipient) => {
      const assertIntercepted = await interceptCatalog(recipient, 'changed', testInfo);
      await recipient.goto(relative(url));
      await ready(recipient);
      assertIntercepted();
      await expectShared(recipient);
      await recipient.locator('#timezone').selectOption('UTC');
      if (variant === 'edit-copy') {
        // A nonempty local draft makes this an actual confirmed replacement.
        await recipient.locator('#show-draft').click();
        await addSession(recipient, FACTS.C3);
        const existing = { ...emptyDraft, steps: [{ session: FACTS.C3, note: '' }] };
        await waitDraft(recipient, existing);
        await recipient.goto(relative(url));
        await ready(recipient);
        await recipient.locator('#edit-shared').click();
        await recipient.locator('#confirm-clear').click();
        await waitDraft(recipient, GOLDEN);
        await recipient.reload();
        await ready(recipient);
        await recipient.locator('#timezone').selectOption('UTC');
        await expectDraft(recipient, GOLDEN);
        await snapshotBriefs(recipient, GOLDEN, false);
        await captureCalendar(recipient, recipient.locator('#export-draft-guide'), [FACTS.C1b, FACTS.C2], testInfo, {
          name: GOLDEN.title, forbidden: [GOLDEN.summary, ...GOLDEN.steps.map((step) => step.note)],
        });
        await assertAgenda(recipient, []);
        return;
      }
      await snapshotBriefs(recipient);
      await captureCalendar(recipient, recipient.locator('#export-shared-guide'), [FACTS.C1b, FACTS.C2], testInfo, {
        artifact: 'original-shared-snapshot', name: GOLDEN.title,
        forbidden: [GOLDEN.summary, ...GOLDEN.steps.map((step) => step.note)],
      });
      await recipient.locator('#save-shared-agenda').click();
      await waitAgenda(recipient, ['S100-b', 'S200-a', 'S400-a']);
      await expect(recipient.locator('#guide-message')).toContainText('current catalog times');
      await expect(recipient.locator('#guide-message')).toContainText('snapshot above is unchanged');
      await recipient.reload();
      await ready(recipient);
      await recipient.locator('#timezone').selectOption('UTC');
      await expectShared(recipient);
      await assertAgenda(recipient, [changedKeynote, FACTS.C2, FACTS.CU]);
      const changedRow = agendaRows(recipient).filter({
        has: recipient.getByRole('button', { name: changedKeynote.title, exact: true }),
      });
      await expect(changedRow).toContainText('6:00 PM - 7:00 PM UTC');
      await expect(changedRow).toContainText('Hall Z');
      await captureCalendar(recipient, recipient.locator('#export-calendar'), [changedKeynote, FACTS.C2], testInfo, {
        artifact: 'current-agenda', forbidden: [GOLDEN.summary, ...GOLDEN.steps.map((step) => step.note)],
      });
      await expectShared(recipient);
      await recipient.locator('#show-draft').click();
      await expectDraft(recipient, emptyDraft);
    });
    await expectDraft(page, GOLDEN);
    await assertAgenda(page, []);
  });
}

for (const variant of ['shared', 'persisted-draft']) {
  test(`E2E-038/${variant} removed occurrence retains snapshot without substituting a repeat`, async ({ page, browser }, testInfo) => {
    await goldenGuide(page);
    const url = await shareGuide(page, testInfo);
    if (variant === 'persisted-draft') {
      const assertIntercepted = await interceptCatalog(page, 'removed', testInfo);
      await page.reload();
      await ready(page);
      assertIntercepted();
      await expectDraft(page, GOLDEN);
      await snapshotBriefs(page, GOLDEN, false);
      await captureCalendar(page, page.locator('#export-draft-guide'), [FACTS.C1b, FACTS.C2], testInfo, {
        name: GOLDEN.title, forbidden: [GOLDEN.summary, ...GOLDEN.steps.map((step) => step.note)],
      });
      await assertAgenda(page, []);
      return;
    }
    await recipientContext(browser, testInfo, async (recipient) => {
      const assertIntercepted = await interceptCatalog(recipient, 'removed', testInfo);
      await recipient.goto(relative(url));
      await ready(recipient);
      assertIntercepted();
      await recipient.locator('#timezone').selectOption('UTC');
      await expectShared(recipient);
      await snapshotBriefs(recipient);
      await captureCalendar(recipient, recipient.locator('#export-shared-guide'), [FACTS.C1b, FACTS.C2], testInfo, {
        artifact: 'removed-occurrence-snapshot', name: GOLDEN.title,
        forbidden: [GOLDEN.summary, ...GOLDEN.steps.map((step) => step.note)],
      });
      await recipient.locator('#save-shared-agenda').click();
      await expect(recipient.locator('#guide-message')).toContainText('1 shared session is no longer in the current catalog');
      await waitAgenda(recipient, ['S200-a', 'S400-a']);
      await recipient.reload();
      await ready(recipient);
      await expectShared(recipient);
      await assertAgenda(recipient, [FACTS.C2, FACTS.CU]);
      await expect(recipient.locator('#agenda-list')).not.toContainText('DEV100');
      const session = await findSession(recipient, 'DEV100');
      await expect(session.getByRole('button', { name: 'Save DEV100', exact: true })).toHaveAttribute('aria-pressed', 'false');
      await recipient.locator('#show-draft').click();
      await expectDraft(recipient, emptyDraft);
    });
    await expectDraft(page, GOLDEN);
    await assertAgenda(page, []);
  });
}

for (const variant of ['card', 'dialog', 'agenda']) {
  test(`E2E-050/${variant} actual single-occurrence download has exact independent calendar facts`, { tag: variant === 'card' ? ['@smoke'] : [] }, async ({ page }, testInfo) => {
    await gotoEvent(page);
    const session = await findSession(page, 'DEV200');
    let control = session.getByRole('button', { name: /Download calendar event for DEV200/ });
    if (variant === 'dialog') {
      await session.getByRole('button', { name: 'Session brief', exact: true }).click();
      control = page.locator('#session-dialog').getByRole('button', { name: /Download calendar event for DEV200/ });
    } else if (variant === 'agenda') {
      await session.getByRole('button', { name: 'Save DEV200', exact: true }).click();
      await waitAgenda(page, ['S200-a']);
      control = page.locator('#agenda-list').getByRole('button', { name: /Download calendar event for DEV200/ });
    }
    await captureCalendar(page, control, [FACTS.C2], testInfo);
    if (variant === 'dialog') await closeSession(page);
    await assertAgenda(page, variant === 'agenda' ? [FACTS.C2] : []);
    await expect(draftRows(page)).toHaveCount(0);
  });
}

test('E2E-051 calendar time chooser exports only the explicitly selected repeat', async ({ page }, testInfo) => {
  await gotoEvent(page);
  const session = await findSession(page, 'DEV100');
  await session.getByRole('button', { name: 'Choose a calendar time for DEV100' }).click();
  const second = page.locator('#session-dialog .occurrence').filter({ hasText: 'Tuesday, Nov 10' });
  await captureCalendar(page, second.getByRole('button', { name: /Download calendar event/ }), [FACTS.C1b], testInfo);
  await closeSession(page);
  await assertAgenda(page, []);
  await expect(draftRows(page)).toHaveCount(0);
});

test('E2E-052 path calendar exports earliest occurrences without saving or creating a draft', async ({ page }, testInfo) => {
  await gotoEvent(page);
  await selectLaunch(page);
  await expect(page.locator('#export-path')).toHaveText('Add all 3 sessions to calendar (.ics)');
  await captureCalendar(page, page.locator('#export-path'), [FACTS.C1a, FACTS.C2, FACTS.C3], testInfo, { name: 'Launch fast' });
  await assertAgenda(page, []);
  await expectDraft(page, emptyDraft);
});

test('E2E-053 golden draft exports chronological snapshots without unscheduled step or private notes', async ({ page }, testInfo) => {
  await goldenGuide(page);
  await expect(page.locator('#draft-calendar-help')).toContainText('1 without times excluded');
  await captureCalendar(page, page.locator('#export-draft-guide'), [FACTS.C1b, FACTS.C2], testInfo, {
    name: GOLDEN.title, forbidden: [GOLDEN.summary, ...GOLDEN.steps.map((step) => step.note)],
  });
  await assertAgenda(page, []);
  await expectDraft(page, GOLDEN);
});

test('E2E-054 independent recipient exports complete shared guide without author storage', async ({ page, browser }, testInfo) => {
  await goldenGuide(page);
  const url = await shareGuide(page, testInfo);
  await recipientContext(browser, testInfo, async (recipient) => {
    await recipient.goto(relative(url));
    await ready(recipient);
    await expectShared(recipient);
    await expect(recipient.locator('#shared-calendar-help')).toContainText('1 without times excluded');
    await captureCalendar(recipient, recipient.locator('#export-shared-guide'), [FACTS.C1b, FACTS.C2], testInfo, {
      name: GOLDEN.title, forbidden: [GOLDEN.summary, new URL(url).searchParams.get('guide'), ...GOLDEN.steps.map((step) => step.note)],
    });
    await assertAgenda(recipient, []);
    await recipient.locator('#show-draft').click();
    await expectDraft(recipient, emptyDraft);
  });
  await expectDraft(page, GOLDEN);
  await assertAgenda(page, []);
});

test('E2E-055 agenda export excludes unscheduled and unsaved draft-only sessions and updates after removal', async ({ page }, testInfo) => {
  await gotoEvent(page);
  await agendaA(page);
  await addSession(page, FACTS.C3);
  const draft = { ...emptyDraft, steps: [{ session: FACTS.C3, note: '' }] };
  await waitDraft(page, draft);
  await page.reload();
  await ready(page);
  await expectDraft(page, draft);
  await assertAgenda(page, [FACTS.C1b, FACTS.C2, FACTS.CU]);
  await expect(page.locator('#agenda-summary')).toContainText('1 not included in calendar export');
  await captureCalendar(page, page.locator('#export-calendar'), [FACTS.C1b, FACTS.C2], testInfo, {
    artifact: 'before-removal', filename: 'my-contoso-dev-days-2026-agenda.ics',
  });
  await expect(page.locator('#toast')).toContainText('1 without times excluded');
  await assertAgenda(page, [FACTS.C1b, FACTS.C2, FACTS.CU]);
  await page.locator('#agenda-list').getByRole('button', { name: 'Remove DEV200 from agenda' }).click();
  await waitAgenda(page, ['S100-b', 'S400-a']);
  await page.reload();
  await ready(page);
  await assertAgenda(page, [FACTS.C1b, FACTS.CU]);
  await captureCalendar(page, page.locator('#export-calendar'), [FACTS.C1b], testInfo, { artifact: 'after-removal' });
  await expectDraft(page, draft);
});

test('E2E-056 empty and all-unscheduled selections cannot invent a calendar event', async ({ page }) => {
  await gotoEvent(page);
  await expect(page.locator('#export-calendar')).toBeDisabled();
  await expect(page.locator('#export-draft-guide')).toBeDisabled();
  await expect(page.locator('#draft-calendar-help')).toContainText('listed start and end time');
  await addSession(page, FACTS.CU, { day: 'unscheduled' });
  await saveOccurrence(page, FACTS.CU);
  await waitAgenda(page, ['S400-a']);
  const expected = { ...emptyDraft, steps: [{ session: FACTS.CU, note: '' }] };
  await waitDraft(page, expected);
  await page.reload();
  await ready(page);
  await expectDraft(page, expected);
  await assertAgenda(page, [FACTS.CU]);
  await expect(page.locator('#export-calendar')).toBeDisabled();
  await expect(page.locator('#export-draft-guide')).toBeDisabled();
  await expect(page.locator('#draft-calendar-help')).toContainText('listed start and end time');
  for (const area of [card(page, 'DEV400'), draftRows(page), agendaRows(page)]) {
    await expect(area).toContainText('Calendar unavailable: time not listed');
    await expect(area.getByRole('button', { name: /Download calendar event/ })).toHaveCount(0);
  }
});
