import { expect } from '@playwright/test';
import ICAL from 'ical.js';

const commonC = {
  speakers: 'Fixture Speaker', type: 'Breakout', level: 'Intermediate (200)',
  delivery: ['In-person'], audiences: ['Developers'], viewing: ['In-person'],
  location: 'Hall A',
};

function contoso(id, sessionId, code, title, topics, start, end, duration) {
  return {
    ...commonC, id, sessionId, code, title, description: `${title} & fixture details.\n`,
    topics, start, end, duration,
  };
}

// Pinned fixture expectations; never obtained from the application serializer or UI.
export const FACTS = {
  C1a: contoso('S100-a', 'S100', 'DEV100', 'Contoso keynote', ['Cloud'],
    '2026-11-09T14:00:00Z', '2026-11-09T15:00:00Z', 60),
  C1b: contoso('S100-b', 'S100', 'DEV100', 'Contoso keynote', ['Cloud'],
    '2026-11-10T14:00:00Z', '2026-11-10T15:00:00Z', 60),
  C2: contoso('S200-a', 'S200', 'DEV200', 'Shipping small', ['Apps'],
    '2026-11-10T15:30:00Z', '2026-11-10T16:15:00Z', 45),
  C3: contoso('S300-a', 'S300', 'DEV300', 'Grants and impact', ['Nonprofit'],
    '2026-11-13T16:00:00Z', '2026-11-13T17:00:00Z', 60),
  CU: contoso('S400-a', 'S400', 'DEV400', 'Unscheduled lab', ['Labs'], '', '', 0),
  F1: {
    id: 'S100-a', code: 'FAB100', title: 'Fabrikam opening', location: 'Room 1',
    description: 'Fabrikam opening — normalized fixture.', speakers: 'Fixture Speaker',
    start: '2027-03-13T21:00:00Z', end: '2027-03-13T22:00:00Z',
  },
  FDST: {
    id: 'S200-a', code: 'FAB200', title: 'Across the DST change', location: 'Room 1',
    description: 'Across the DST change — normalized fixture.', speakers: 'Fixture Speaker',
    start: '2027-03-14T07:30:00Z', end: '2027-03-14T08:30:00Z',
  },
};

export const EVENTS = {
  C: {
    id: 'contoso-dev-days-2026', name: 'Contoso Dev Days 2026 (fixture)',
    catalogUrl: 'https://example.com/contoso-dev-days/sessions',
  },
  F: {
    id: 'fabrikam-summit-2027', name: 'Fabrikam Summit 2027 (fixture)',
    catalogUrl: 'https://example.com/fabrikam-summit/sessions',
  },
};

export function assertCalendar(bytes, expected, { event = EVENTS.C, name, forbidden = [] } = {}) {
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  expect(text.endsWith('\r\n')).toBe(true);
  expect(text.replaceAll('\r\n', '')).not.toMatch(/[\r\n]/);
  for (const line of text.split('\r\n')) {
    expect(Buffer.byteLength(line, 'utf8'), `Physical ICS line: ${line}`).toBeLessThanOrEqual(75);
    expect(line).not.toContain('\uFFFD');
  }
  const parsed = ICAL.parse(text);
  const calendar = new ICAL.Component(parsed);
  expect(calendar.name).toBe('vcalendar');
  expect((text.match(/^BEGIN:VCALENDAR\r?$/gm) || []).length).toBe(1);
  expect(calendar.getFirstPropertyValue('version')).toBe('2.0');
  expect(calendar.getFirstPropertyValue('method')).toBe('PUBLISH');
  if (name !== undefined) expect(calendar.getFirstPropertyValue('x-wr-calname')).toBe(name);
  const actual = calendar.getAllSubcomponents('vevent');
  expect(actual).toHaveLength(expected.length);
  const chronological = [...expected].sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
  const expectedUIDs = chronological.map((fact) => `${event.id}:${fact.id}@ms-events-guide`);
  expect(actual.map((item) => item.getFirstPropertyValue('uid'))).toEqual(expectedUIDs);
  for (const [index, fact] of chronological.entries()) {
    const component = actual[index];
    const entry = new ICAL.Event(component);
    expect(entry.summary).toBe(`${fact.code}: ${fact.title}`);
    expect(entry.location).toBe(fact.location);
    expect(entry.startDate.zone.tzid).toBe('UTC');
    expect(entry.endDate.zone.tzid).toBe('UTC');
    expect(entry.startDate.toJSDate().toISOString()).toBe(new Date(fact.start).toISOString());
    expect(entry.endDate.toJSDate().toISOString()).toBe(new Date(fact.end).toISOString());
    expect(entry.endDate.toUnixTime() - entry.startDate.toUnixTime()).toBeGreaterThan(0);
    expect(entry.description).toBe(
      `${fact.description}\nSpeakers: ${fact.speakers}\nVerify times and attendance in the official ${event.name} catalog: ${event.catalogUrl}. Saving is not a reservation.`,
    );
    for (const privateText of ['E2E_NOTE_NOT_FOR_CALENDAR_42', ...forbidden]) {
      expect(entry.description).not.toContain(privateText);
    }
    expect(component.getFirstPropertyValue('dtstamp')).toBeTruthy();
  }
  return calendar;
}
