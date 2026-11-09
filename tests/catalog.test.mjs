import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  FILTER_DEFAULTS, createCatalog, filterCatalog, getConflicts, isScheduled,
  dateKey, restoreSaved, calendarExport, readFilters, readViewState, writeFilters,
} from "../assets/js/catalog.js";

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
], [{ id: "ai", name: "AI builders", steps: [{ code: "BRK01", why: "Ground your product", takeaway: "A plan" }] }]));

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
    [{ id: "p", name: "Path", steps: [{ code: "B" }, { code: "BRK01" }] }]));
  assert.deepEqual(filterCatalog(reversed, { ...FILTER_DEFAULTS, path: "p" }, "UTC").map((item) => item.code), ["B", "BRK01"]);
});

test("rejects malformed or duplicate catalog data and missing curated references", () => {
  assert.throws(() => createCatalog({}), /unexpected shape/);
  assert.throws(() => createCatalog(payload([instance(), instance()])), /duplicate/);
  assert.throws(() => createCatalog(payload([instance()], [{ name: "Missing", steps: [{ code: "NOPE" }] }])), /missing session/);
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
  const paths = [{ id: "launch" }, { id: "scale" }, { id: "ai" }];
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

test("every curated path references real source sessions and all source instances survive grouping", async () => {
  const source = JSON.parse(await readFile(new URL("../2026_ignite_session_catalog.json", import.meta.url), "utf8"));
  const guide = JSON.parse(await readFile(new URL("../data/guide.json", import.meta.url), "utf8"));
  const normalized = source.map((record) => instance({
    id: record.sessionInstanceId, sessionId: record.sessionId, code: record.sessionCode,
    title: record.title, description: record.description, speakers: record.speakerNames || "",
    type: record.sessionType.displayValue, level: record.sessionLevel[0]?.displayValue || "",
    topics: record.topic.map((item) => item.displayValue),
    start: record.startDateTime || "", end: record.endDateTime || "",
  }));
  const actual = createCatalog({ instances: normalized, guide });
  assert.equal(actual.instanceById.size, source.length);
  assert.equal(actual.sessions.length, new Set(source.map((record) => record.sessionId)).size);
  assert.equal(actual.paths.length, 3);
  for (const path of actual.paths) {
    assert.equal(path.steps.length, 6);
    assert.equal(new Set(path.steps.map((step) => step.code)).size, path.steps.length);
    for (const step of path.steps) {
      assert.ok(actual.byCode.has(step.code));
      assert.ok(step.why.length > 40);
      assert.ok(step.takeaway.length > 20);
    }
  }
});
