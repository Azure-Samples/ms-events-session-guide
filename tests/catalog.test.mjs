import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  FILTER_DEFAULTS, createCatalog, filterCatalog, getConflicts, isScheduled,
  dateKey, restoreSaved, calendarExport, calendarSessions,
  readFilters, readViewState, writeFilters, getAudiencePaths, audienceRecommendations,
} from "../assets/js/catalog.js";
import { LEGACY_EVENT, validateEvent, validateEventId, validateTimeZone } from "../assets/js/event-context.js";

const instance = (overrides = {}) => ({
  id: "one", sessionId: "session-one", code: "BRK01", title: "Build café agents",
  description: "Production retrieval and useful evaluations", speakers: "Ada Example",
  type: "Breakout", level: "(200) Intermediate", topics: ["Agent Platform"],
  delivery: ["Online"], audiences: [], viewing: ["Will be recorded"],
  start: "2026-11-18T00:00:00Z", end: "2026-11-18T00:45:00Z",
  duration: 45, location: "Room A", ...overrides,
});
const payload = (instances, paths = []) => ({ instances, guide: { paths }, updated: "" });
const catalog = createCatalog(payload([
  instance(),
  instance({ id: "repeat", start: "2026-11-19T18:00:00Z", end: "2026-11-19T18:45:00Z", delivery: ["In-person"], speakers: "Grace Repeat" }),
  instance({ id: "two", sessionId: "session-two", code: "BRK02", title: "SQL at scale", topics: ["Data"] }),
  instance({ id: "three", sessionId: "session-three", code: "BRK03", title: "Unknown time", start: "", end: "", duration: 0 }),
], [{ id: "ai", name: "AI builders", audience: "startup", steps: [{ code: "BRK01", why: "Ground your product", takeaway: "A plan" }] }]));
const journeyPaths = [
  { id: "launch", audience: "startup" },
  { id: "ai", audience: "startup" },
  { id: "startup-ops", audience: "startup" },
  { id: "scale", audience: "digital-native" },
  { id: "ai-scale", audience: "digital-native" },
  { id: "engineering-scale", audience: "digital-native" },
];

test("groups repeated instances without dropping individual times", () => {
  assert.equal(catalog.sessions.length, 3);
  assert.equal(catalog.instanceById.size, 4);
  assert.deepEqual(catalog.byCode.get("BRK01").instances.map((item) => item.id), ["one", "repeat"]);
  assert.equal(catalog.byCode.get("BRK01").recommendations[0].index, 0);
});

test("search is multi-term, accent-insensitive, and includes speakers and codes", () => {
  assert.equal(filterCatalog(catalog, { ...FILTER_DEFAULTS, q: "CAFE Ada" }, "UTC").length, 1);
  assert.equal(filterCatalog(catalog, { ...FILTER_DEFAULTS, q: "BRK02" }, "UTC")[0].code, "BRK02");
  assert.equal(filterCatalog(catalog, { ...FILTER_DEFAULTS, q: "Grace Repeat" }, "UTC")[0].code, "BRK01");
  assert.equal(filterCatalog(catalog, { ...FILTER_DEFAULTS, q: "café nonexistent" }, "UTC").length, 0);
});

test("day filtering uses the selected time zone and matches the same occurrence as attendance", () => {
  assert.equal(dateKey("2026-11-18T00:00:00Z", "America/Los_Angeles"), "2026-11-17");
  assert.equal(dateKey("2026-11-18T00:00:00Z", "UTC"), "2026-11-18");
  const filters = { ...FILTER_DEFAULTS, q: "BRK01", day: "2026-11-17", delivery: "In-person" };
  assert.equal(filterCatalog(catalog, filters, "America/Los_Angeles").length, 0);
  const matches = filterCatalog(catalog, { ...filters, delivery: "Online" }, "America/Los_Angeles");
  assert.deepEqual(matches[0].instances.map((item) => item.id), ["one"]);
});

test("supports unscheduled, topic, type, level, and learning-path filters", () => {
  assert.equal(filterCatalog(catalog, { ...FILTER_DEFAULTS, day: "unscheduled" }, "UTC")[0].code, "BRK03");
  assert.equal(filterCatalog(catalog, { ...FILTER_DEFAULTS, topic: "Data" }, "UTC")[0].code, "BRK02");
  assert.equal(filterCatalog(catalog, { ...FILTER_DEFAULTS, type: "Lab" }, "UTC").length, 0);
  assert.equal(filterCatalog(catalog, { ...FILTER_DEFAULTS, level: "(400) Expert" }, "UTC").length, 0);
  assert.deepEqual(filterCatalog(catalog, { ...FILTER_DEFAULTS, path: "ai" }, "UTC").map((item) => item.code), ["BRK01"]);
});

test("sorts guide picks first, honors learning order, and puts unscheduled sessions last in time order", () => {
  assert.equal(filterCatalog(catalog, FILTER_DEFAULTS, "UTC")[0].code, "BRK01");
  assert.equal(filterCatalog(catalog, { ...FILTER_DEFAULTS, sort: "time" }, "UTC").at(-1).code, "BRK03");
  const reversed = createCatalog(payload([instance(), instance({ id: "b", sessionId: "b", code: "B" })],
    [{ id: "p", name: "Path", audience: "startup", steps: [{ code: "B" }, { code: "BRK01" }] }]));
  assert.deepEqual(filterCatalog(reversed, { ...FILTER_DEFAULTS, path: "p" }, "UTC").map((item) => item.code), ["B", "BRK01"]);
});

test("rejects malformed or duplicate catalog data and missing curated references", () => {
  assert.throws(() => createCatalog({}), /unexpected shape/);
  assert.throws(() => createCatalog(payload([instance(), instance()])), /duplicate/);
  assert.throws(() => createCatalog(payload([instance()], [{ id: "missing", name: "Missing", audience: "startup", steps: [{ code: "NOPE" }] }])), /missing session/);
});

test("rejects duplicate guide IDs and shared or missing audiences", () => {
  const path = { id: "p", name: "Path", audience: "startup", steps: [{ code: "BRK01" }] };
  assert.throws(() => createCatalog(payload([instance()], [path, path])), /unique ID/);
  assert.throws(() => createCatalog(payload([instance()], [{ ...path, audience: "both" }])), /must target/);
  assert.throws(() => createCatalog(payload([instance()], [{ ...path, audience: undefined }])), /must target/);
});

test("each audience receives only its own guides in its own order", () => {
  assert.deepEqual(getAudiencePaths(journeyPaths, "startup").map((path) => path.id), ["launch", "ai", "startup-ops"]);
  assert.deepEqual(getAudiencePaths(journeyPaths, "digital-native").map((path) => path.id), ["scale", "ai-scale", "engineering-scale"]);
  const reordered = [journeyPaths[5], ...journeyPaths.slice(0, 5)];
  assert.equal(readViewState("?audience=digital-native", reordered).activePath, "engineering-scale");
  assert.throws(() => readViewState("?audience=digital-native", journeyPaths.slice(0, 3)), /No guides are configured/);
});

test("guide picks and recommendations are ranked for the selected audience without hiding the catalog", () => {
  const scoped = createCatalog(payload([
    instance({ title: "Zulu startup session" }),
    instance({ id: "dn", sessionId: "dn", code: "DN01", title: "Alpha digital-native session" }),
    instance({ id: "neutral", sessionId: "neutral", code: "N01", title: "Neutral session" }),
  ], [
    { id: "launch", name: "Startup guide", audience: "startup", steps: [{ code: "BRK01" }] },
    { id: "scale", name: "Digital-native guide", audience: "digital-native", steps: [{ code: "DN01" }] },
  ]));
  const startups = filterCatalog(scoped, FILTER_DEFAULTS, "UTC", "startup");
  const digitalNatives = filterCatalog(scoped, FILTER_DEFAULTS, "UTC", "digital-native");
  assert.equal(startups.length, 3);
  assert.equal(digitalNatives.length, 3);
  assert.equal(startups[0].code, "BRK01");
  assert.equal(digitalNatives[0].code, "DN01");
  assert.equal(audienceRecommendations(scoped.byCode.get("BRK01"), "digital-native").length, 0);
  assert.equal(audienceRecommendations(scoped.byCode.get("DN01"), "digital-native")[0].path.id, "scale");
  assert.equal(filterCatalog(scoped, { ...FILTER_DEFAULTS, path: "scale" }, "UTC", "startup").length, 0);
  assert.deepEqual(filterCatalog(scoped, { ...FILTER_DEFAULTS, path: "scale" }, "UTC", "digital-native").map((session) => session.code), ["DN01"]);
});

test("conflicts include nested overlaps but not back-to-back or unscheduled sessions", () => {
  const a = instance({ id: "a", start: "2026-11-18T18:00:00Z", end: "2026-11-18T20:00:00Z" });
  const b = instance({ id: "b", start: "2026-11-18T18:15:00Z", end: "2026-11-18T18:30:00Z" });
  const c = instance({ id: "c", start: "2026-11-18T18:30:00Z", end: "2026-11-18T19:00:00Z" });
  const d = instance({ id: "d", start: "2026-11-18T20:00:00Z", end: "2026-11-18T21:00:00Z" });
  const e = instance({ id: "e", start: "", end: "" });
  const conflicts = getConflicts([e, c, d, b, a]);
  assert.deepEqual(conflicts.get("a"), ["b", "c"]);
  assert.deepEqual(conflicts.get("b"), ["a"]);
  assert.equal(conflicts.has("d"), false);
  assert.equal(conflicts.has("e"), false);
});

test("invalid or inverted times are not scheduled", () => {
  assert.equal(isScheduled(instance()), true);
  assert.equal(isScheduled(instance({ start: "not-a-date" })), false);
  assert.equal(isScheduled(instance({ end: "" })), false);
  assert.equal(isScheduled(instance({ end: "2026-11-17T00:00:00Z" })), false);
});

test("URL filters preserve repository subpaths and unrelated theme/shared-guide parameters", () => {
  const filters = { ...FILTER_DEFAULTS, q: "AI & data", topic: "Agent Platform", sort: "time" };
  const url = writeFilters("https://example.github.io/ignite/?scoutTheme=dark&guide=snapshot#catalog", filters);
  assert.equal(url.pathname, "/ignite/");
  assert.equal(url.searchParams.get("guide"), "snapshot");
  assert.equal(url.searchParams.get("scoutTheme"), "dark");
  assert.equal(url.hash, "#catalog");
  assert.deepEqual(readFilters(url.search), filters);
  assert.equal(readFilters("?sort=unexpected").sort, "recommended");
  assert.equal(writeFilters(url, FILTER_DEFAULTS).searchParams.has("q"), false);
});

test("URL state restores journey, audience, time zone, and filters and resets absent parameters", () => {
  const paths = journeyPaths;
  const scale = readViewState("?route=scale&audience=digital-native&tz=UTC&q=postgres", paths);
  assert.equal(scale.activePath, "scale");
  assert.equal(scale.audience, "digital-native");
  assert.equal(scale.zoneChoice, "UTC");
  assert.equal(scale.filters.q, "postgres");
  const defaults = readViewState("", paths);
  assert.deepEqual(defaults, {
    filters: { ...FILTER_DEFAULTS }, audience: "startup", activePath: "launch", zoneChoice: "America/Los_Angeles",
  });
  assert.equal(readViewState("?audience=digital-native", paths).activePath, "scale");
  assert.equal(readViewState("?route=ai&tz=local", paths).activePath, "ai");
  assert.equal(readViewState("?route=missing&audience=unknown&tz=invalid", paths).activePath, "launch");
  assert.equal(readViewState("?tz=invalid", paths).zoneChoice, "America/Los_Angeles");
});

test("guide deep links infer the audience and cannot select a foreign audience's guide", () => {
  for (const path of journeyPaths) {
    const state = readViewState(`?route=${path.id}`, journeyPaths);
    assert.equal(state.activePath, path.id);
    assert.equal(state.audience, path.audience);
  }
  const mismatch = readViewState("?audience=digital-native&route=launch&path=ai", journeyPaths);
  assert.equal(mismatch.activePath, "scale");
  assert.equal(mismatch.filters.path, "");
  const startupMismatch = readViewState("?audience=startup&route=scale&path=ai-scale", journeyPaths);
  assert.equal(startupMismatch.activePath, "launch");
  assert.equal(startupMismatch.filters.path, "");
  const catalogLink = readViewState("?path=ai-scale", journeyPaths);
  assert.equal(catalogLink.audience, "digital-native");
  assert.equal(catalogLink.activePath, "ai-scale");
  assert.equal(catalogLink.filters.path, "ai-scale");
  assert.equal(readViewState("?audience=digital-native&route=missing", journeyPaths).activePath, "scale");
});

test("event audiences and time zones are data-driven, including cross-audience links", () => {
  const event = { ...LEGACY_EVENT, id: "build-2027", name: "Build 2027",
    timeZone: "Asia/Tokyo", catalogUrl: "https://example.com/catalog", url: "/repo/events/build-2027/" };
  const paths = [
    { id: "alpha", name: "Alpha", audience: "educators", steps: [{ code: "BRK01" }] },
    { id: "beta", name: "Beta", audience: "students", steps: [{ code: "BRK02" }] },
  ];
  const audiences = [{ id: "educators", label: "Educators" }, { id: "students", label: "Students" }];
  const data = createCatalog({ event, instances: [instance(), instance({ id: "two", sessionId: "two", code: "BRK02" })],
    guide: { audiences, paths }, updated: "" });
  assert.deepEqual(data.event, event);
  assert.deepEqual(data.audiences, audiences);
  assert.deepEqual(getAudiencePaths(data.paths, "students"), [paths[1]]);
  assert.equal(filterCatalog(data, FILTER_DEFAULTS, event.timeZone, "students")[0].code, "BRK02");
  assert.deepEqual(readViewState("?path=beta&tz=Asia%2FTokyo", paths, event, audiences), {
    filters: { ...FILTER_DEFAULTS, path: "beta" }, audience: "students", activePath: "beta", zoneChoice: "Asia/Tokyo",
  });
  const mismatch = readViewState("?audience=educators&route=beta&path=beta&tz=America%2FLos_Angeles",
    paths, event, audiences);
  assert.equal(mismatch.audience, "educators");
  assert.equal(mismatch.activePath, "alpha");
  assert.equal(mismatch.filters.path, "");
  assert.equal(mismatch.zoneChoice, "Asia/Tokyo");
  assert.equal(readViewState("?audience=bad", paths, event, audiences).audience, "educators");
  assert.equal(readViewState("?tz=invalid", paths,
    { eventTimeZone: event.timeZone, audiences }).zoneChoice, "Asia/Tokyo");
});

test("event and generated catalog guards reject malformed metadata and audience definitions", () => {
  for (const id of ["Bad", "x:y", "../x", "x".repeat(81)]) assert.throws(() => validateEventId(id), /slug/);
  assert.throws(() => validateTimeZone("Mars/Olympus"), /time zone/i);
  assert.throws(() => validateTimeZone("+02:00"), /time zone/i);
  for (const change of [
    { startDate: "2026-02-29" }, { startDate: "2027-01-01" }, { timeZone: "bad" },
    { catalogUrl: "http://example.test/" }, { url: "//evil.test/" }, { summary: "" },
  ]) assert.throws(() => validateEvent({ ...LEGACY_EVENT, ...change }));
  const valid = { event: LEGACY_EVENT, instances: [instance()],
    guide: { audiences: [{ id: "teachers", label: "Teachers" }],
      paths: [{ id: "teach", name: "Teach", audience: "teachers", steps: [{ code: "BRK01" }] }] } };
  assert.throws(() => createCatalog({ ...valid, guide: { ...valid.guide, audiences: undefined } }), /audiences/);
  assert.throws(() => createCatalog({ ...valid, guide: { ...valid.guide, audiences: [{ id: "teachers", label: "" }] } }), /label/);
  assert.throws(() => createCatalog({ ...valid, guide: { ...valid.guide, audiences: [{ id: "custom", label: "Custom" }] } }), /reserved/);
  assert.throws(() => createCatalog({ ...valid, guide: { ...valid.guide, audiences: [valid.guide.audiences[0], valid.guide.audiences[0]] } }), /unique/);
  assert.throws(() => createCatalog({ ...valid, instances: [{ ...instance(), topics: null }] }), /invalid/);
  assert.throws(() => createCatalog({ ...valid, instances: [{ ...instance(), topics: new Array(1) }] }), /invalid/);
  assert.throws(() => createCatalog({ ...valid, instances: [{ ...instance(), duration: -1 }] }), /invalid/);
  assert.throws(() => createCatalog({ ...valid, guide: { ...valid.guide, paths: [] } }), /nonempty/);
});
test("restores only known saved IDs, deduplicates, and rejects corrupt data", () => {
  assert.deepEqual(restoreSaved(null, catalog.instanceById), { ids: [], removed: 0 });
  assert.deepEqual(restoreSaved(JSON.stringify({ version: 1, ids: ["one", "one", "gone"] }), catalog.instanceById),
    { ids: ["one"], removed: 1 });
  assert.throws(() => restoreSaved("{bad", catalog.instanceById), SyntaxError);
  assert.throws(() => restoreSaved('{"version":2,"ids":[]}', catalog.instanceById), /expected format/);
});

test("calendar export uses UTC, excludes unknown schedules, and escapes text safely", () => {
  const output = calendarExport([
    instance({ title: "Agents, APIs; the \\ path", description: "First\nSecond", location: "Room, A" }),
    instance({ id: "unscheduled", start: "", end: "" }),
  ], new Date("2026-11-09T12:00:00Z"));
  assert.equal((output.match(/BEGIN:VEVENT/g) || []).length, 1);
  assert.match(output, /DTSTART:20261118T000000Z\r\n/);
  assert.match(output, /DTSTAMP:20261109T120000Z\r\n/);
  assert.match(output, /SUMMARY:BRK01: Agents\\, APIs\\; the \\\\ path/);
  assert.match(output, /DESCRIPTION:First\\nSecond/);
  assert.match(output, /LOCATION:Room\\, A/);
  assert.equal(output.endsWith("END:VCALENDAR\r\n"), true);
});

test("calendar lines fold at 75 UTF-8 bytes without breaking Unicode", () => {
  const description = "Production café 🚀 ".repeat(30);
  const output = calendarExport([instance({ description })]);
  for (const line of output.split("\r\n")) assert.ok(Buffer.byteLength(line) <= 75);
  const unfolded = output.replace(/\r\n /g, "");
  assert.ok(unfolded.includes(description));
  assert.ok(!output.includes("\uFFFD"));
});

test("calendar selections exclude unknown times, deduplicate instances, and retain distinct repeat times", () => {
  const first = instance();
  const repeat = instance({ id: "repeat", start: "2026-11-19T18:00:00Z", end: "2026-11-19T18:45:00Z" });
  const source = [repeat, first, first, instance({ id: "unknown", start: "", end: "" })];
  assert.deepEqual(calendarSessions(source).map((event) => event.id), ["one", "repeat"]);
  assert.equal(source[0], repeat);
  const output = calendarExport(source);
  assert.equal((output.match(/BEGIN:VEVENT/g) || []).length, 2);
  assert.equal((output.match(/UID:one@ignite-field-guide/g) || []).length, 1);
});

test("calendar UIDs preserve Ignite exactly and namespace overlapping foreign event occurrences", () => {
  const other = { ...LEGACY_EVENT, id: "build-2027", name: "Build 2027",
    catalogUrl: "https://example.com/build", timeZone: "Asia/Tokyo" };
  const third = { ...other, id: "summit-2027", name: "Summit 2027" };
  const sessions = [instance(), instance({ id: "repeat" })];
  const legacy = calendarExport(sessions).replace(/\r\n /g, "");
  const build = calendarExport(sessions, new Date("2026-11-09T12:00:00Z"), undefined, other).replace(/\r\n /g, "");
  const summit = calendarExport(sessions, new Date("2026-11-09T12:00:00Z"), undefined, third).replace(/\r\n /g, "");
  for (const id of ["one", "repeat"]) {
    assert.ok(legacy.includes(`UID:${id}@ignite-field-guide\r\n`));
    assert.ok(build.includes(`UID:build-2027:${id}@ms-events-guide\r\n`));
    assert.ok(summit.includes(`UID:summit-2027:${id}@ms-events-guide\r\n`));
  }
  assert.ok(build.includes("X-WR-CALNAME:Build 2027 - My guide"));
  assert.ok(build.includes("https://example.com/build"));
  assert.throws(() => calendarExport(sessions, new Date(), "Bad", { ...other, id: "a:b" }), /slug/);
});

test("guide calendar names are preserved and escaped without allowing injected properties", () => {
  const output = calendarExport([instance()], new Date("2026-11-09T12:00:00Z"),
    "Our café guide, launch; plan\r\nX-UNTRUSTED:value");
  assert.match(output, /X-WR-CALNAME:Our café guide\\, launch\\; plan\\nX-UNTRUSTED:value\r\n/);
  assert.ok(!output.includes("\r\nX-UNTRUSTED:"));
  assert.match(output, /METHOD:PUBLISH\r\n/);
  assert.ok(!output.includes("METHOD:REQUEST"));
  assert.ok(!output.includes("ORGANIZER:"));
});

test("calendar events retain the exact room and UTC instants from frozen guide snapshots", () => {
  const snapshot = Object.freeze(instance({
    start: "2026-11-17T15:15:00-08:00", end: "2026-11-17T16:00:00-08:00",
    location: "Moscone West | Level 2, Room 2006",
  }));
  const output = calendarExport([snapshot]);
  assert.match(output, /DTSTART:20261117T231500Z\r\n/);
  assert.match(output, /DTEND:20261118T000000Z\r\n/);
  assert.match(output, /LOCATION:Moscone West \| Level 2\\, Room 2006\r\n/);
  assert.match(output, /UID:one@ignite-field-guide\r\n/);
  assert.equal(snapshot.start, "2026-11-17T15:15:00-08:00");
});

test("calendar events include session facts without personal attendance notes", () => {
  const event = instance({
    title: "Agents & APIs: café + 🚀",
    start: "2026-11-17T15:15:00-08:00", end: "2026-11-17T16:00:00-08:00",
    location: "Moscone West | Level 2, Room 2006",
    description: "Design & build\nCompare A+B to C?",
    note: "PRIVATE_NOTE_MUST_NOT_BE_SENT",
  });
  const output = calendarExport([event]).replace(/\r\n /g, "");
  assert.ok(output.includes(`SUMMARY:${event.code}: ${event.title}`));
  assert.ok(output.includes("DESCRIPTION:Design & build\\nCompare A+B to C?"));
  assert.ok(output.includes("Speakers: Ada Example"));
  assert.ok(output.includes("not a reservation"));
  assert.ok(!output.includes("PRIVATE_NOTE"));
});

test("every curated path references real source sessions and all source instances survive grouping", async () => {
  const source = JSON.parse(await readFile(new URL("../content/events/ignite-2026/catalog.json", import.meta.url), "utf8"));
  const guide = JSON.parse(await readFile(new URL("../content/events/ignite-2026/guides.json", import.meta.url), "utf8"));
  const normalized = source.map((record) => instance({
    id: record.sessionInstanceId, sessionId: record.sessionId, code: record.sessionCode,
    title: record.title, description: record.description, speakers: record.speakerNames || "",
    type: record.sessionType.displayValue, level: record.sessionLevel[0]?.displayValue || "",
    topics: record.topic.map((item) => item.displayValue),
    start: record.startDateTime || "", end: record.endDateTime || "",
    location: record.location?.displayValue || "", duration: record.durationInMinutes,
  }));
  const actual = createCatalog({ instances: normalized, guide });
  assert.equal(actual.instanceById.size, source.length);
  assert.equal(actual.sessions.length, new Set(source.map((record) => record.sessionId)).size);
  assert.equal(actual.paths.length, 6);
  assert.equal(new Set(actual.paths.map((path) => path.id)).size, 6);
  const signatures = actual.paths.map((path) => path.steps.map((step) => step.code).sort().join(","));
  assert.equal(new Set(signatures).size, 6, "Guides must differ in actual sessions, not only labels or ordering");
  for (const audience of ["startup", "digital-native"]) {
    const paths = getAudiencePaths(actual.paths, audience);
    assert.equal(paths.length, 3);
    assert.equal(readViewState(`?audience=${audience}`, actual.paths).activePath, paths[0].id);
  }
  for (const path of actual.paths) {
    assert.equal(path.steps.length, 6);
    assert.equal(new Set(path.steps.map((step) => step.code)).size, path.steps.length);
    for (const step of path.steps) {
      assert.ok(actual.byCode.has(step.code));
      assert.ok(step.why.length > 40);
      assert.ok(step.takeaway.length > 20);
    }
    const instances = path.steps.map((step) => actual.byCode.get(step.code).instances[0]);
    const output = calendarExport(instances, new Date("2026-11-09T12:00:00Z"), path.name);
    assert.equal((output.match(/BEGIN:VEVENT/g) || []).length, 6, `${path.name} must export six separate calendar events`);
    const unfolded = output.replace(/\r\n /g, "");
    for (const event of instances) {
      assert.ok(unfolded.includes(`SUMMARY:${event.code}:`));
      assert.ok(unfolded.includes(`LOCATION:${event.location.replace(/,/g, "\\,")}`));
    }
  }
});
