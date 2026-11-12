import assert from "node:assert/strict";
import test from "node:test";
import ICAL from "ical.js";
import {
  FILTER_DEFAULTS, calendarExport, createCatalog, filterCatalog, getConflicts,
  readViewState, restoreSaved,
} from "../assets/js/catalog.js";
import { createShareURL, decodeGuide, getGuideEventId, snapshotSession } from "../assets/js/guides.js";
import { eventStorageKeys, validateStoredAgenda, validateStoredDraft } from "../assets/js/event-state.js";

const event = (overrides = {}) => ({
  id: "builders-2026", name: "Builders 2026", summary: "A developer conference",
  startDate: "2026-03-07", endDate: "2026-11-02", timeZone: "America/Los_Angeles",
  catalogUrl: "https://example.test/builders/catalog", url: "/events/builders-2026/",
  catalogVersion: "fixture-1", ...overrides,
});

const session = (overrides = {}) => ({
  id: "agents-first", sessionId: "agents", code: "AGT101",
  title: "Agents, APIs; café 🚀", description: "Compare A+B.\nBuild, measure; repeat.",
  speakers: "Zoë Example", type: "Breakout", level: "Intermediate",
  topics: ["AI"], delivery: ["Online"], audiences: ["Developers"], viewing: ["Live"],
  start: "2026-03-07T18:00:00Z", end: "2026-03-07T18:45:00Z",
  duration: 45, location: "Hall A, room 2; east", ...overrides,
});

function catalog(instances, metadata = event()) {
  return createCatalog({
    event: metadata, instances,
    guide: {
      audiences: [{ id: "builders", label: "Builders" }],
      paths: [{ id: "start", name: "Start building", audience: "builders",
        steps: [{ code: instances[0].code }] }],
    },
  });
}

function guide(sessions, eventId = "builders-2026") {
  return {
    version: 2, eventId, title: "Our field guide", summary: "A personal plan",
    steps: sessions.map((item) => ({ session: snapshotSession(item), note: "Ask about production tradeoffs." })),
  };
}

async function shared(input) {
  const url = new URL(await createShareURL(`https://example.test/events/${input.eventId}/`, input));
  return decodeGuide(url.searchParams.get("guide"));
}

function calendar(sessions, metadata = event(), title = "Our field guide") {
  return new ICAL.Component(ICAL.parse(calendarExport(
    sessions, new Date("2026-03-01T12:00:00Z"), title, metadata,
  )));
}

function events(component) {
  return component.getAllSubcomponents("vevent").map((item) => new ICAL.Event(item));
}

test("a filtered repeat stays the shared calendar occurrence after the live catalog changes", async () => {
  const repeat = session({
    id: "agents-repeat", start: "2026-03-08T18:00:00Z", end: "2026-03-08T18:45:00Z",
    delivery: ["In person"], location: "West, room 3",
  });
  const source = catalog([session(), repeat]);
  const matches = filterCatalog(source, {
    ...FILTER_DEFAULTS, q: "AGT101", day: "2026-03-08", delivery: "In person",
  }, source.event.timeZone);
  assert.deepEqual(matches.flatMap((item) => item.instances.map((occurrence) => occurrence.id)), ["agents-repeat"]);
  const draft = guide([matches[0].instances[0]]);
  const link = await createShareURL("https://example.test/events/builders-2026/", draft);
  repeat.title = "Renamed by the organizer";
  repeat.start = "2026-03-09T18:00:00Z";
  repeat.end = "2026-03-09T18:45:00Z";
  repeat.location = "Elsewhere";
  repeat.topics.push("Changed");
  draft.steps[0].note = "Changed local note";
  const updated = catalog([session(), repeat]);
  assert.equal(filterCatalog(updated, {
    ...FILTER_DEFAULTS, day: "2026-03-08", delivery: "In person",
  }, updated.event.timeZone).length, 0);

  const decoded = await decodeGuide(new URL(link).searchParams.get("guide"));
  assert.deepEqual(decoded.steps, [{
    session: session({
      id: "agents-repeat", start: "2026-03-08T18:00:00Z", end: "2026-03-08T18:45:00Z",
      delivery: ["In person"], location: "West, room 3",
    }),
    note: "Ask about production tradeoffs.",
  }]);
  assert.ok(Object.isFrozen(decoded.steps[0].session.topics));
  const component = calendar(decoded.steps.map((step) => step.session));
  assert.equal(component.getFirstPropertyValue("x-wr-calname"), "Our field guide");
  const exported = events(component);
  assert.equal(exported.length, 1);
  assert.equal(exported[0].uid, "builders-2026:agents-repeat@ms-events-guide");
  assert.equal(exported[0].startDate.toJSDate().toISOString(), "2026-03-08T18:00:00.000Z");
  assert.equal(exported[0].endDate.toJSDate().toISOString(), "2026-03-08T18:45:00.000Z");
  assert.equal(exported[0].summary, "AGT101: Agents, APIs; café 🚀");
  assert.equal(exported[0].location, "West, room 3");
  assert.equal(exported[0].description, "Compare A+B.\nBuild, measure; repeat.\nSpeakers: Zoë Example\nVerify times and attendance in the official Builders 2026 catalog: https://example.test/builders/catalog. Saving is not a reservation.");
});

test("removed occurrences disappear from a restored agenda but remain exportable from a shared snapshot", async () => {
  const original = catalog([session(), session({
    id: "data", sessionId: "data", code: "DATA101", title: "Data systems",
  })]);
  const saved = JSON.stringify({ version: 1, ids: ["agents-first", "data"] });
  const decoded = await shared(guide([
    original.instanceById.get("agents-first"), original.instanceById.get("data"),
  ]));
  const current = catalog([session({
    id: "data", sessionId: "data", code: "DATA101", title: "New data systems",
  })]);
  const restored = restoreSaved(saved, current.instanceById);
  assert.deepEqual(restored, { ids: ["data"], removed: 1 });
  const agendaEvents = events(calendar(restored.ids.map((id) => current.instanceById.get(id))));
  assert.deepEqual(agendaEvents.map((item) => item.summary), ["DATA101: New data systems"]);
  const sharedEvents = events(calendar(decoded.steps.map((step) => step.session)));
  assert.deepEqual(sharedEvents.map((item) => item.uid), [
    "builders-2026:agents-first@ms-events-guide", "builders-2026:data@ms-events-guide",
  ]);
  assert.deepEqual(sharedEvents.map((item) => item.summary), [
    "AGT101: Agents, APIs; café 🚀", "DATA101: Data systems",
  ]);
});

test("overlapping occurrence IDs stay event-scoped through stored agendas, drafts, shares and calendar UIDs", async () => {
  const other = event({
    id: "summit-2026", name: "Summit 2026", catalogUrl: "https://example.test/summit/catalog",
    url: "/events/summit-2026/", timeZone: "Asia/Tokyo",
  });
  const catalogs = [
    catalog([session()]),
    catalog([session({ title: "A different event session" })], other),
  ];
  const stored = new Map();
  for (const data of catalogs) {
    const keys = eventStorageKeys(data.event.id);
    stored.set(keys.agenda, JSON.stringify({ version: 1, ids: ["agents-first"] }));
    stored.set(keys.draft, JSON.stringify(guide([data.instanceById.get("agents-first")], data.event.id)));
  }
  assert.equal(stored.size, 4);
  const sharedEvents = [];
  for (const data of catalogs) {
    const keys = eventStorageKeys(data.event.id);
    validateStoredAgenda(stored.get(keys.agenda));
    const agenda = restoreSaved(stored.get(keys.agenda), data.instanceById);
    const draft = validateStoredDraft(stored.get(keys.draft), data.event.id);
    const decoded = await shared(draft);
    assert.equal(getGuideEventId(decoded), data.event.id);
    const foreignId = data.event.id === "builders-2026" ? "summit-2026" : "builders-2026";
    assert.throws(() => validateStoredDraft(JSON.stringify(decoded), foreignId), /another event/);
    const agendaEvent = events(calendar(agenda.ids.map((id) => data.instanceById.get(id)), data.event))[0];
    const sharedEvent = events(calendar(decoded.steps.map((step) => step.session), data.event))[0];
    assert.equal(agendaEvent.uid, sharedEvent.uid);
    assert.equal(agendaEvent.summary, sharedEvent.summary);
    sharedEvents.push(sharedEvent);
  }
  assert.deepEqual(sharedEvents.map((item) => item.uid), [
    "builders-2026:agents-first@ms-events-guide", "summit-2026:agents-first@ms-events-guide",
  ]);
  assert.deepEqual(sharedEvents.map((item) => item.summary), [
    "AGT101: Agents, APIs; café 🚀", "AGT101: A different event session",
  ]);
  assert.match(sharedEvents[1].description, /official Summit 2026 catalog: https:\/\/example.test\/summit\/catalog/);
});

test("unscheduled filtered snapshots survive sharing without becoming calendar appointments", async () => {
  const source = catalog([session(), session({
    id: "on-demand", sessionId: "on-demand", code: "OD101", title: "Watch later",
    start: "", end: "", duration: 0, location: "", viewing: ["On demand"],
  })]);
  const matches = filterCatalog(source, { ...FILTER_DEFAULTS, day: "unscheduled" }, source.event.timeZone);
  const decoded = await shared(guide([matches[0].instances[0], source.instanceById.get("agents-first")]));
  assert.deepEqual(decoded.steps.map((step) => [step.session.id, step.session.start, step.session.duration]), [
    ["on-demand", "", 0], ["agents-first", "2026-03-07T18:00:00Z", 45],
  ]);
  assert.deepEqual(events(calendar(decoded.steps.map((step) => step.session))).map((item) => item.uid), [
    "builders-2026:agents-first@ms-events-guide",
  ]);
  assert.equal(events(calendar([decoded.steps[0].session])).length, 0);
});

test("spring DST day filters use the selected zone while shared calendars preserve the original instants", async () => {
  const source = catalog([
    session({ id: "before", start: "2026-03-08T07:30:00Z", end: "2026-03-08T08:15:00Z" }),
    session({ id: "after", start: "2026-03-09T07:30:00Z", end: "2026-03-09T08:15:00Z" }),
  ]);
  const state = readViewState("?day=2026-03-08&tz=America%2FLos_Angeles",
    source.paths, source.event, source.audiences);
  assert.deepEqual(filterCatalog(source, state.filters, state.zoneChoice).flatMap((item) =>
    item.instances.map((occurrence) => occurrence.id)), []);
  const utc = readViewState("?day=2026-03-08&tz=UTC", source.paths, source.event, source.audiences);
  const match = filterCatalog(source, utc.filters, utc.zoneChoice);
  assert.deepEqual(match[0].instances.map((item) => item.id), ["before"]);
  const after = filterCatalog(source, { ...state.filters, day: "2026-03-09" }, state.zoneChoice);
  assert.deepEqual(after[0].instances.map((item) => item.id), ["after"]);
  const decoded = await shared(guide([after[0].instances[0]]));
  const exported = events(calendar(decoded.steps.map((step) => step.session)));
  assert.equal(exported[0].startDate.toJSDate().toISOString(), "2026-03-09T07:30:00.000Z");
  assert.equal(exported[0].endDate.toJSDate().toISOString(), "2026-03-09T08:15:00.000Z");
});

test("fall DST repeated wall-clock hours remain distinct, ordered, nonconflicting shared appointments", async () => {
  const source = catalog([
    session({
      id: "standard", sessionId: "standard", code: "STD101",
      start: "2026-11-01T01:15:00-08:00", end: "2026-11-01T02:00:00-08:00",
    }),
    session({
      id: "daylight", sessionId: "daylight", code: "DST101",
      start: "2026-11-01T01:15:00-07:00", end: "2026-11-01T01:45:00-07:00", duration: 30,
    }),
    session({
      id: "previous-day", sessionId: "previous", code: "PRE101",
      start: "2026-11-01T06:30:00Z", end: "2026-11-01T07:15:00Z",
    }),
  ]);
  const matches = filterCatalog(source, {
    ...FILTER_DEFAULTS, day: "2026-11-01", sort: "time",
  }, source.event.timeZone);
  const selected = matches.flatMap((item) => item.instances);
  assert.deepEqual(selected.map((item) => item.id), ["daylight", "standard"]);
  const decoded = await shared(guide(selected));
  const snapshots = decoded.steps.map((step) => step.session);
  assert.deepEqual([...getConflicts(snapshots)], []);
  const exported = events(calendar([...snapshots].reverse()));
  assert.deepEqual(exported.map((item) => item.startDate.toJSDate().toISOString()), [
    "2026-11-01T08:15:00.000Z", "2026-11-01T09:15:00.000Z",
  ]);
  assert.deepEqual(exported.map((item) => item.endDate.toJSDate().toISOString()), [
    "2026-11-01T08:45:00.000Z", "2026-11-01T10:00:00.000Z",
  ]);
  assert.deepEqual(exported.map((item) => item.uid), [
    "builders-2026:daylight@ms-events-guide", "builders-2026:standard@ms-events-guide",
  ]);
});
