// Copyright (c) Microsoft Corporation. Licensed under the MIT license.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cp, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import {
  eventDestination, eventLocalDate, eventStatus, legacyRouteKind, LEGACY_QUERY_PARAMETERS,
  resolveLegacyRoute, searchEvents, selectHighlights, validateManifest, wireEventLinks, preserveThemeForSiteLinks,
} from "../assets/js/events.js";
import { decodeGuide, encodeGuide, getGuideEventId } from "../assets/js/guides.js";

const root = fileURLToPath(new URL("..", import.meta.url));
const SOURCE_SHA256 = "4d8221afdf4a2846a855c479154c896f054eb046f68bfcf895c894c1f81587c3";

function event(overrides = {}) {
  return {
    id: "ignite-2026", name: "Microsoft Ignite 2026", summary: "Summary",
    startDate: "2026-11-17", endDate: "2026-11-20", timeZone: "America/Los_Angeles",
    catalogUrl: "https://ignite.microsoft.com/en-US/sessions", url: "/events/ignite-2026/",
    catalogVersion: "abc123", catalogAssetUrl: "/data/events/ignite-2026/catalog.1.json",
    keywords: [], ...overrides,
  };
}

const at = (iso) => new Date(iso);

test("event navigation preserves only an explicitly chosen theme, not private view state", () => {
  const makeLink = (href, target = "") => ({
    href, target, getAttribute: () => href, hasAttribute: () => false,
  });
  const links = [makeLink("/events/other/"), makeLink("/"), makeLink("#agenda"), makeLink("/privacy.txt"), makeLink("https://external.example/")];
  const location = new URL("https://guide.example/events/ignite-2026/?guide=PRIVATE&q=notes&scoutTheme=light");
  preserveThemeForSiteLinks({ querySelectorAll: () => links }, location);
  assert.equal(links[0].href, "https://guide.example/events/other/?scoutTheme=light");
  assert.equal(links[1].href, "https://guide.example/?scoutTheme=light");
  assert.equal(links[2].href, "#agenda");
  assert.equal(links[3].href, "/privacy.txt");
  assert.equal(links[4].href, "https://external.example/");
});

test("manifest validation accepts published metadata and rejects invalid events", () => {
  const manifest = validateManifest({ version: 1, events: [event(), event({ id: "other-2027", url: "/events/other-2027/" })] });
  assert.equal(manifest.events.length, 2);
  assert.ok(Object.isFrozen(manifest.events[0]));
  const invalid = [
    [{ version: 2, events: [] }, /unexpected shape/],
    [{ version: 1, events: [event(), event()] }, /more than once/],
    [{ version: 1, events: [event({ id: "Bad ID" })] }, /lowercase slug/],
    [{ version: 1, events: [event({ timeZone: "Mars/Olympus" })] }, /time zone/],
    [{ version: 1, events: [event({ startDate: "2026-02-30" })] }, /dates/],
    [{ version: 1, events: [event({ endDate: "2026-11-16" })] }, /chronological/],
    [{ version: 1, events: [event({ catalogUrl: "http://example.com/" })] }, /HTTPS/],
    [{ version: 1, events: [event({ url: "https://evil.example/" })] }, /site-relative/],
    [{ version: 1, events: [event({ catalogAssetUrl: "//evil.example/x.json" })] }, /site-relative/],
    [{ version: 1, events: [event({ keywords: [""] })] }, /keywords/],
  ];
  for (const [input, message] of invalid) assert.throws(() => validateManifest(input), message);
});

test("event status uses inclusive event-local calendar dates", () => {
  const ignite = event();
  assert.equal(eventStatus(ignite, at("2026-11-17T07:59:59Z")), "upcoming"); // Nov 16, 23:59 PST
  assert.equal(eventStatus(ignite, at("2026-11-17T08:00:00Z")), "ongoing");
  assert.equal(eventStatus(ignite, at("2026-11-21T07:59:59Z")), "ongoing"); // final day, 23:59 PST
  assert.equal(eventStatus(ignite, at("2026-11-21T08:00:00Z")), "past");
  const tokyo = event({ id: "tokyo", timeZone: "Asia/Tokyo", startDate: "2026-11-17", endDate: "2026-11-17" });
  assert.equal(eventStatus(tokyo, at("2026-11-16T15:00:00Z")), "ongoing"); // already Nov 17 in Tokyo
  assert.equal(eventStatus(tokyo, at("2026-11-17T15:00:00Z")), "past");
});

test("event-local dates stay correct across a daylight-saving transition", () => {
  const zone = "America/Chicago"; // DST begins 2027-03-14 at 02:00 local
  assert.equal(eventLocalDate(at("2027-03-14T05:59:59Z"), zone), "2027-03-13"); // 23:59 CST
  assert.equal(eventLocalDate(at("2027-03-14T06:00:00Z"), zone), "2027-03-14");
  assert.equal(eventLocalDate(at("2027-03-15T04:59:59Z"), zone), "2027-03-14"); // 23:59 CDT
  assert.equal(eventLocalDate(at("2027-03-15T05:00:00Z"), zone), "2027-03-15");
  const summit = event({ id: "summit", timeZone: zone, startDate: "2027-03-14", endDate: "2027-03-14" });
  assert.equal(eventStatus(summit, at("2027-03-15T04:59:59Z")), "ongoing");
  assert.equal(eventStatus(summit, at("2027-03-15T05:00:00Z")), "past");
});

test("highlights show ongoing then upcoming events, deterministically, without placeholders", () => {
  const now = at("2026-11-18T12:00:00Z");
  const events = [
    event({ id: "zeta", startDate: "2026-12-01", endDate: "2026-12-02" }),
    event({ id: "alpha", startDate: "2026-12-01", endDate: "2026-12-03" }),
    event({ id: "past", startDate: "2026-01-01", endDate: "2026-01-02" }),
    event({ id: "now-late", startDate: "2026-11-18", endDate: "2026-11-19" }),
    event({ id: "now-early", startDate: "2026-11-10", endDate: "2026-11-30" }),
    event({ id: "later", startDate: "2027-05-01", endDate: "2027-05-01" }),
  ];
  assert.deepEqual(selectHighlights(events, now).map((item) => [item.event.id, item.status]), [
    ["now-early", "ongoing"], ["now-late", "ongoing"], ["alpha", "upcoming"],
  ]);
  assert.deepEqual(selectHighlights([...events].reverse(), now).map((item) => item.event.id),
    ["now-early", "now-late", "alpha"]);
  assert.deepEqual(selectHighlights([event()], now).map((item) => item.event.id), ["ignite-2026"]);
  assert.deepEqual(selectHighlights([event()], at("2026-12-01T00:00:00Z")), []);
  assert.deepEqual(selectHighlights([], now), []);
});

test("event search is accent-insensitive, matches keywords, and keeps order", () => {
  const events = [
    event({ id: "contoso", name: "Contoso Dev Days", keywords: ["Montréal"] }),
    event({ id: "fabrikam", name: "Fabrikam Summit", summary: "Public sector modernization" }),
  ];
  assert.deepEqual(searchEvents(events, "montreal").map((item) => item.id), ["contoso"]);
  assert.deepEqual(searchEvents(events, "  PUBLIC   summit ").map((item) => item.id), ["fabrikam"]);
  assert.deepEqual(searchEvents(events, "public contoso"), []);
  assert.deepEqual(searchEvents(events, "").map((item) => item.id), ["contoso", "fabrikam"]);
  assert.deepEqual(searchEvents(events, "fabrikam").map((item) => item.id), ["fabrikam"]);
});

test("legacy root links are recognized, but theme-only and plain links stay on discovery", () => {
  for (const key of LEGACY_QUERY_PARAMETERS) {
    assert.ok(legacyRouteKind(`?${key}=x`, ""), key);
    assert.ok(legacyRouteKind(`?scoutTheme=dark&${key}=`, ""), `${key} with theme`);
  }
  assert.equal(legacyRouteKind("?guide=1.abc&q=ai", "#my-guide"), "guide");
  assert.equal(legacyRouteKind("?event=ignite-2026", ""), "event");
  assert.equal(legacyRouteKind("?event=fabrikam-summit-2027&q=ai", "#catalog"), "event");
  assert.equal(legacyRouteKind("?event=ignite-2026&guide=1.abc", ""), "guide");
  assert.equal(legacyRouteKind("?q=ai&audience=digital-native&tz=UTC", ""), "view");
  for (const hash of ["#guide", "#catalog", "#my-guide", "#agenda"]) assert.equal(legacyRouteKind("", hash), "view");
  assert.equal(legacyRouteKind("?scoutTheme=dark", ""), null);
  assert.equal(legacyRouteKind("?scoutTheme=light", "#top"), null);
  assert.equal(legacyRouteKind("", ""), null);
  assert.equal(legacyRouteKind("?utm_source=mail", "#events"), null);
});

test("event destinations preserve query and hash verbatim at root and repository subpaths", () => {
  const search = "?guide=1.AbC_-x&q=caf%C3%A9+ai&scoutTheme=dark";
  assert.equal(eventDestination("/events/ignite-2026/", "https://guide.example", search, "#my-guide"),
    `https://guide.example/events/ignite-2026/${search}#my-guide`);
  assert.equal(eventDestination("/repo/events/ignite-2026/", "https://org.github.io", "?q=ai", "#catalog"),
    "https://org.github.io/repo/events/ignite-2026/?q=ai#catalog");
  assert.throws(() => eventDestination("https://evil.example/", "https://guide.example", "", ""), /site-relative/);
});

test("event destinations consume only the decoded routing key without re-encoding other parameters", () => {
  const origin = "https://guide.example";
  const path = "/repo/events/ignite-2026/";
  for (const selector of ["event=ignite-2026", "%65vent=ignite-2026"]) {
    assert.equal(eventDestination(path, origin, `?${selector}`, ""), `${origin}${path}`);
    const other = "guide=2.AbC_-x&q=caf%C3%A9+ai&topic=AI%20agents&flag&empty=&tag=one&tag=two";
    for (const query of [
      `${selector}&${other}`,
      `guide=2.AbC_-x&${selector}&q=caf%C3%A9+ai&topic=AI%20agents&flag&empty=&tag=one&tag=two`,
      `${other}&${selector}`,
    ]) {
      assert.equal(eventDestination(path, origin, `?${query}`, "#my-guide"),
        `${origin}${path}?${other}#my-guide`);
    }
  }
  assert.equal(eventDestination(path, origin, "?event=ignite-2026&event=ignite-2026", "#catalog"),
    `${origin}${path}#catalog`);
  assert.equal(eventDestination(path, origin, "?q=event%3Dignite-2026&eventual=keep", ""),
    `${origin}${path}?q=event%3Dignite-2026&eventual=keep`);
});

function snapshot(overrides = {}) {
  return {
    id: "S100-a", sessionId: "S100", code: "FAB100", title: "Fabrikam opening", description: "",
    speakers: "", type: "Workshop", level: "", topics: [], delivery: [], audiences: [], viewing: [],
    start: "2027-03-13T15:00:00-06:00", end: "2027-03-13T16:00:00-06:00", duration: 60, location: "",
    ...overrides,
  };
}

const helpers = { decodeGuide, getGuideEventId, legacyEventId: "ignite-2026" };
const manifestEvents = [
  event({ url: "/repo/events/ignite-2026/" }),
  event({ id: "fabrikam-summit-2027", url: "/repo/events/fabrikam-summit-2027/" }),
];

test("event query selects a published event, consuming the selector and preserving other parameters", async () => {
  for (const prefix of ["", "/repo"]) {
    const events = manifestEvents.map((item) => ({ ...item, url: `${prefix}/events/${item.id}/` }));
    for (const eventId of ["ignite-2026", "fabrikam-summit-2027"]) {
      const search = `?event=${eventId}&q=caf%C3%A9+ai&scoutTheme=dark&audience=nonprofit&tz=UTC`;
      const result = await resolveLegacyRoute({ origin: "https://guide.example", search, hash: "#catalog" }, events, helpers);
      assert.equal(result.type, "redirect");
      assert.equal(result.event.id, eventId);
      assert.equal(result.url, `https://guide.example${prefix}/events/${eventId}/?q=caf%C3%A9+ai&scoutTheme=dark&audience=nonprofit&tz=UTC#catalog`);
    }
  }
});

test("invalid event selectors show an error instead of falling back to Ignite", async () => {
  for (const search of [
    "?event=unknown-event", "?event=", "?event", "?event=IGNITE-2026",
    "?event=https%3A%2F%2Fevil.example", "?event=..%2Fignite-2026",
    "?event=ignite-2026&event=fabrikam-summit-2027", "?event=ignite-2026&event=ignite-2026",
    "?event=unknown-event&q=ai", "?event=&q=ai",
  ]) {
    const result = await resolveLegacyRoute({ origin: "https://guide.example", search, hash: "#catalog" }, manifestEvents, helpers);
    assert.equal(result.type, "error", search);
    assert.ok(result.message);
    assert.equal(result.url, undefined);
  }
});

test("event selectors must agree with validated shared-guide identities", async () => {
  for (const version of [1, 2]) {
    const eventId = version === 1 ? "ignite-2026" : "fabrikam-summit-2027";
    const token = await encodeGuide({
      version, ...(version === 2 ? { eventId } : {}), title: "Shared guide", summary: "",
      steps: [{ session: snapshot(), note: "Preserved" }],
    });
    const search = `?event=${eventId}&guide=${token}&scoutTheme=light`;
    const result = await resolveLegacyRoute({ origin: "https://org.github.io", search, hash: "#my-guide" }, manifestEvents, helpers);
    assert.equal(result.type, "redirect");
    assert.equal(result.url, `https://org.github.io/repo/events/${eventId}/?guide=${token}&scoutTheme=light#my-guide`);
    const otherEvent = version === 1 ? "fabrikam-summit-2027" : "ignite-2026";
    const mismatch = await resolveLegacyRoute({
      origin: "https://org.github.io", search: `?event=${otherEvent}&guide=${token}`, hash: "",
    }, manifestEvents, helpers);
    assert.equal(mismatch.type, "error");
    assert.match(mismatch.message, /does not match/);
  }
  const invalid = await resolveLegacyRoute({
    origin: "https://org.github.io", search: "?event=ignite-2026&guide=2.invalid", hash: "",
  }, manifestEvents, helpers);
  assert.equal(invalid.type, "error");
  assert.match(invalid.message, /^This guide link is not valid/);
});

test("legacy bridge validates version-1 tokens, routes them to Ignite and keeps them verbatim", async () => {
  const token = await encodeGuide({
    version: 1, title: "Legacy guide", summary: "",
    steps: [{ session: snapshot(), note: "Kept as sent" }],
  });
  assert.match(token, /^1\./);
  const location = { origin: "https://org.github.io", search: `?guide=${token}&tz=UTC`, hash: "#my-guide" };
  const result = await resolveLegacyRoute(location, manifestEvents, helpers);
  assert.equal(result.type, "redirect");
  assert.equal(result.event.id, "ignite-2026");
  assert.equal(result.url, `https://org.github.io/repo/events/ignite-2026/?guide=${token}&tz=UTC#my-guide`);

  for (const bad of [`1.${"A".repeat(40)}`, "1.", `1.${"A".repeat(7600)}`]) {
    const invalid = await resolveLegacyRoute({ ...location, search: `?guide=${bad}` }, manifestEvents, helpers);
    assert.equal(invalid.type, "error", bad.slice(0, 12));
    assert.match(invalid.message, /^This guide link is not valid/);
  }

  const view = await resolveLegacyRoute({ origin: "https://org.github.io", search: "?route=ai&audience=startup", hash: "" },
    manifestEvents, helpers);
  assert.equal(view.url, "https://org.github.io/repo/events/ignite-2026/?route=ai&audience=startup");
  assert.deepEqual(await resolveLegacyRoute({ origin: "https://x", search: "?scoutTheme=dark", hash: "" },
    manifestEvents, helpers), { type: "none" });
});

test("legacy bridge validates version-2 tokens before routing to their own event", async () => {
  const token = await encodeGuide({
    version: 2, eventId: "fabrikam-summit-2027", title: "Ünïcode guide", summary: "",
    steps: [{ session: snapshot(), note: "Notes stay in the token" }],
  });
  assert.match(token, /^2\./);
  const search = `?guide=${token}`;
  const result = await resolveLegacyRoute({ origin: "https://org.github.io", search, hash: "#my-guide" }, manifestEvents, helpers);
  assert.equal(result.type, "redirect");
  assert.equal(result.event.id, "fabrikam-summit-2027");
  assert.equal(result.url, `https://org.github.io/repo/events/fabrikam-summit-2027/${search}#my-guide`);

  const foreign = await encodeGuide({
    version: 2, eventId: "unknown-event", title: "Elsewhere", summary: "",
    steps: [{ session: snapshot(), note: "" }],
  });
  const unknown = await resolveLegacyRoute({ origin: "https://x", search: `?guide=${foreign}`, hash: "" }, manifestEvents, helpers);
  assert.equal(unknown.type, "error");
  assert.match(unknown.message, /not available on this site/);

  for (const bad of ["", "2.", "2.not*base64", "9.abc", `2.${"A".repeat(7600)}`]) {
    const malformed = await resolveLegacyRoute({ origin: "https://x", search: `?guide=${bad}`, hash: "" }, manifestEvents, helpers);
    assert.equal(malformed.type, "error", bad.slice(0, 12));
    assert.match(malformed.message, /^This guide link is not valid: /);
  }
  const missingLegacy = await resolveLegacyRoute({ origin: "https://x", search: "?q=ai", hash: "" }, manifestEvents.slice(1), helpers);
  assert.equal(missingLegacy.type, "error");
});

function fakeRoot() {
  const handlers = {};
  return {
    handlers,
    addEventListener: (type, handler) => { handlers[type] = handler; },
    removeEventListener: (type) => { delete handlers[type]; },
    contains: () => true,
  };
}

function fakeClick(link, { type = "click", button = 0 } = {}) {
  return {
    type, button, defaultPrevented: false,
    target: { closest: () => link },
    preventDefault() { this.defaultPrevented = true; },
  };
}

test("event links report observed selections without blocking navigation", () => {
  const root = fakeRoot();
  const calls = [];
  const dispose = wireEventLinks(root, () => ({ track: (...args) => calls.push(args) }));
  const link = { dataset: { eventId: "ignite-2026", eventSource: "directory" } };
  const click = fakeClick(link);
  root.handlers.click(click);
  assert.equal(click.defaultPrevented, false);
  root.handlers.auxclick(fakeClick({ dataset: { eventId: "x", eventSource: "switcher" } }, { type: "auxclick", button: 1 }));
  root.handlers.auxclick(fakeClick(link, { type: "auxclick", button: 2 }));
  root.handlers.click(fakeClick({ dataset: { eventId: "x", eventSource: "hero" } }));
  root.handlers.click(fakeClick(null));
  assert.deepEqual(calls, [
    ["event_selected", { eventId: "ignite-2026", source: "directory" }],
    ["event_selected", { eventId: "x", source: "switcher" }],
  ]);
  const throwing = fakeRoot();
  wireEventLinks(throwing, () => ({ track: () => { throw new Error("blocked"); } }));
  assert.doesNotThrow(() => throwing.handlers.click(fakeClick(link)));
  const unready = fakeRoot();
  wireEventLinks(unready, () => undefined);
  assert.doesNotThrow(() => unready.handlers.click(fakeClick(link)));
  dispose();
  assert.deepEqual(Object.keys(root.handlers), []);
});

// ---- Hugo build checks (skipped when Hugo is not installed) ----

const hugoAvailable = spawnSync("hugo", ["version"], { encoding: "utf8" }).status === 0;
const buildRoot = `${root}test-results/events-test`;

function hugo(args, env = {}) {
  return spawnSync("hugo", args, {
    cwd: root, encoding: "utf8", env: { ...process.env, HUGO_TELEMETRY_ENABLED: "false", ...env },
  });
}

async function files(dir, prefix = "") {
  const result = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = `${prefix}${entry.name}`;
    if (entry.isDirectory()) result.push(...await files(`${dir}/${entry.name}`, `${path}/`));
    else result.push(path);
  }
  return result;
}

function assertNoRawResources(list) {
  const leaked = list.filter((file) => /(^|\/)(catalog|guides)\.json$|\.md$/.test(file) ||
    (file.endsWith(".json") && !/^data\/events\/([a-z0-9-]+\/catalog|manifest)\.[a-f0-9]{64}\.json$/.test(file)));
  assert.deepEqual(leaked, [], "raw event bundle resources must never be published");
}

async function readJSON(dir, pattern) {
  const match = (await files(dir)).find((file) => pattern.test(file));
  assert.ok(match, `missing ${pattern}`);
  return JSON.parse(await readFile(`${dir}/${match}`, "utf8"));
}

test("production build publishes Ignite only, unchanged, with no raw resources", { skip: !hugoAvailable }, async () => {
  const out = `${buildRoot}/production`;
  await rm(out, { recursive: true, force: true });
  for (const pass of ["clean", "incremental"]) {
    const result = hugo(["--minify", "-d", out]);
    assert.equal(result.status, 0, `${pass} build failed:\n${result.stderr}`);
    const list = await files(out);
    assertNoRawResources(list);
    assert.ok(!list.some((file) => /fixture|contoso|fabrikam/.test(file)), "fixtures must not reach production");
  }
  const raw = await readFile(`${root}content/events/ignite-2026/catalog.json`);
  assert.equal(createHash("sha256").update(raw).digest("hex"), SOURCE_SHA256);
  const manifest = validateManifest(await readJSON(out, /^data\/events\/manifest\./));
  assert.deepEqual(manifest.events.map((item) => item.id), ["ignite-2026"]);
  const catalog = await readJSON(out, /^data\/events\/ignite-2026\/catalog\./);
  assert.equal(catalog.instances.length, 1500);
  assert.equal(new Set(catalog.instances.map((item) => item.sessionId)).size, 1343);
  assert.deepEqual(catalog.guide.audiences.map((item) => item.id), ["startup", "digital-native"]);
  assert.equal(catalog.guide.paths.length, 6);
  assert.equal(catalog.event.catalogVersion, manifest.events[0].catalogVersion);
  assert.match(catalog.event.catalogVersion, /^[a-f0-9]{16}$/);
  assert.deepEqual({ ...catalog.event, catalogVersion: undefined }, {
    id: "ignite-2026", name: "Microsoft Ignite 2026", summary: manifest.events[0].summary,
    startDate: "2026-11-17", endDate: "2026-11-20", timeZone: "America/Los_Angeles",
    catalogUrl: "https://ignite.microsoft.com/en-US/sessions", url: "/events/ignite-2026/", catalogVersion: undefined,
  });
  const home = await readFile(`${out}/index.html`, "utf8");
  assert.equal(home.match(/data-event-card/g)?.length, 1);
  assert.match(home, /<meta name=referrer content="no-referrer">/);
  assert.doesNotMatch(home, /telemetry-config|cookie-banner|privacy-settings/);
  assert.doesNotMatch(home, /data\/events\/ignite-2026\/catalog/, "discovery must not reference session catalogs");
  const page = await readFile(`${out}/events/ignite-2026/index.html`, "utf8");
  for (const id of ["guide", "catalog", "my-guide", "agenda", "timezone", "path-options", "session-dialog",
    "share-guide", "export-calendar", "load-error", "app-content"]) {
    assert.match(page, new RegExp(`id=${id}[ >]`), `event page keeps #${id}`);
  }
  assert.match(page, /data-audience=startup aria-pressed=true>Startup</);
  assert.match(page, /data-audience=digital-native aria-pressed=false>/);
  assert.match(page, /<option value=America\/Los_Angeles>/);
});

test("fixture build supports two events, reused IDs, novel audiences, and repository subpaths",
  { skip: !hugoAvailable }, async () => {
    const out = `${buildRoot}/fixtures`;
    await rm(out, { recursive: true, force: true });
    const result = hugo(["--config", "hugo.toml,tests/fixtures/hugo.toml", "--minify", "-d", out,
      "--baseURL", "https://org.github.io/repo/"]);
    assert.equal(result.status, 0, result.stderr);
    assertNoRawResources(await files(out));
    const manifest = validateManifest(await readJSON(out, /^data\/events\/manifest\./));
    assert.deepEqual(manifest.events.map((item) => [item.id, item.url]), [
      ["contoso-dev-days-2026", "/repo/events/contoso-dev-days-2026/"],
      ["fabrikam-summit-2027", "/repo/events/fabrikam-summit-2027/"],
    ]);
    for (const item of manifest.events) {
      assert.match(item.catalogAssetUrl, new RegExp(`^/repo/data/events/${item.id}/catalog\\.`));
      const search = `?event=${item.id}`;
      const route = await resolveLegacyRoute({ origin: "https://org.github.io", search, hash: "" }, manifest.events, helpers);
      assert.equal(route.type, "redirect");
      assert.equal(route.url, `https://org.github.io${item.url}`);
    }
    const contoso = await readJSON(out, /^data\/events\/contoso-dev-days-2026\/catalog\./);
    const fabrikam = await readJSON(out, /^data\/events\/fabrikam-summit-2027\/catalog\./);
    assert.ok(contoso.instances.some((item) => item.id === "S100-a" && item.code === "DEV100"));
    assert.ok(fabrikam.instances.some((item) => item.id === "S100-a" && item.code === "FAB100"));
    assert.deepEqual(contoso.guide.audiences.map((item) => item.id), ["startup", "nonprofit"]);
    assert.deepEqual(fabrikam.guide.audiences, [{ id: "public-sector", label: "Public sector" }]);
    assert.equal(contoso.instances.find((item) => item.id === "S400-a").start, "");
    assert.match(contoso.instances[0].description, /Contoso keynote & fixture details\./);

    const home = await readFile(`${out}/index.html`, "utf8");
    assert.equal(home.match(/data-event-card/g)?.length, 2);
    assert.match(home, /href=\/repo\/events\/contoso-dev-days-2026\/ data-event-id=contoso-dev-days-2026 data-event-source=directory/);
    assert.match(home, /<ul id=highlights-list class=event-grid role=list><\/ul>/, "highlights are computed at runtime only");
    assert.match(home, /Fixture preview/);
    assert.doesNotMatch(home, /<\/script><b>/);
    const page = await readFile(`${out}/events/fabrikam-summit-2027/index.html`, "utf8");
    assert.match(page, /data-audience=public-sector aria-pressed=true>Public sector</);
    assert.match(page, /class=audience-control hidden/);
    assert.match(page, /href=\/repo\/events\/contoso-dev-days-2026\/ data-event-id=contoso-dev-days-2026 data-event-source=switcher/);
    assert.match(page, /aria-current=page><strong>Fabrikam Summit 2027/);
    assert.match(page, /data-catalog=\/repo\/data\/events\/fabrikam-summit-2027\/catalog\./);
    assert.match(page, /<option value=America\/Chicago>Event time &#183; CST \(America\/Chicago\)/);
    const metadata = /<script type=application\/json id=event-metadata>([^<]*)<\/script>/.exec(page);
    assert.ok(metadata, "event metadata is inert JSON without raw markup");
    assert.match(JSON.parse(metadata[1]).summary, /<\/script><b>bold<\/b> & "quotes"/);
    assert.doesNotMatch(page, /data\/events\/contoso-dev-days-2026\/catalog/, "event pages load only their own catalog");
  });

test("draft event bundles stay out of the published directory", { skip: !hugoAvailable }, async () => {
  const dir = `${buildRoot}/draft`;
  await rm(dir, { recursive: true, force: true });
  await cp(`${root}tests/fixtures/content`, `${dir}/content`, { recursive: true });
  const index = `${dir}/content/events/fabrikam-summit-2027/index.md`;
  await writeFile(index, (await readFile(index, "utf8")).replace("build:", "draft: true\nbuild:"));
  await writeFile(`${dir}/hugo.toml`, `contentDir = ${JSON.stringify(`${dir}/content`)}\n`);
  const result = hugo(["--config", `hugo.toml,${dir}/hugo.toml`, "-d", `${dir}/public`]);
  assert.equal(result.status, 0, result.stderr);
  const list = await files(`${dir}/public`);
  assert.ok(!list.some((file) => file.includes("fabrikam")), "draft output must not be published");
  const manifest = await readJSON(`${dir}/public`, /^data\/events\/manifest\./);
  assert.deepEqual(manifest.events.map((item) => item.id), ["contoso-dev-days-2026"]);
});

const invalidCases = [
  ["eventId must match its directory", "contoso-dev-days-2026/index.md", (s) => s.replace("eventId: contoso-dev-days-2026", "eventId: contoso-2026"), /must equal the bundle directory name/],
  ["invalid time zone", "contoso-dev-days-2026/index.md", (s) => s.replace("America/New_York", "Mars/Olympus_Mons"), /timeZone must be an IANA time zone/],
  ["impossible date", "contoso-dev-days-2026/index.md", (s) => s.replace('"2026-11-09"', '"2026-02-30"'), /startDate must be a quoted calendar date/],
  ["end before start", "contoso-dev-days-2026/index.md", (s) => s.replace('"2026-11-13"', '"2026-11-01"'), /endDate must not be before/],
  ["non-HTTPS catalog", "contoso-dev-days-2026/index.md", (s) => s.replace("https://example.com", "http://example.com"), /catalogUrl must be an absolute HTTPS URL/],
  ["unknown format", "contoso-dev-days-2026/index.md", (s) => s.replace("catalogFormat: ignite", "catalogFormat: csv"), /catalogFormat must be/],
  ["URL override", "contoso-dev-days-2026/index.md", (s) => s.replace("build:", "url: /elsewhere/\nbuild:"), /URLs are fixed/],
  ["unknown curated session", "contoso-dev-days-2026/guides.json", (s) => s.replace('"code": "DEV200"', '"code": "NOPE1"'), /references unknown session code "NOPE1"/],
  ["duplicate guide ID", "contoso-dev-days-2026/guides.json", (s) => s.replace('"id": "impact"', '"id": "launch"'), /duplicate guide ID "launch"/],
  ["unknown audience", "contoso-dev-days-2026/guides.json", (s) => s.replace('"audience": "nonprofit"', '"audience": "enterprise"'), /unknown audience "enterprise"/],
  ["reserved audience ID", "fabrikam-summit-2027/guides.json", (s) => s.replaceAll('"public-sector"', '"custom"'), /audience ID "custom" is reserved/],
  ["audience without guides", "fabrikam-summit-2027/guides.json", (s) => s.replace('"audiences": [', '"audiences": [{"id": "orphan", "label": "Orphan"}, '), /audience "orphan" has no curated guides/],
  ["empty path", "fabrikam-summit-2027/guides.json", (s) => JSON.stringify({ ...JSON.parse(s), paths: [{ ...JSON.parse(s).paths[0], steps: [] }] }), /must have at least one step/],
  ["duplicate instance within an event", "fabrikam-summit-2027/catalog.json", (s) => s.replace('"id": "S200-b"', '"id": "S200-a"'), /duplicate session instance ID "S200-a"/],
  ["inconsistent session code", "fabrikam-summit-2027/catalog.json", (s) => {
    const catalog = JSON.parse(s);
    catalog.instances[2].code = "FAB201";
    return JSON.stringify(catalog);
  }, /appears with codes/],
  ["normalized time order", "fabrikam-summit-2027/catalog.json", (s) => s.replace('"2027-03-13T16:00:00-06:00"', '"2027-03-13T14:00:00-06:00"'), /end must be after start/],
  ["normalized missing field", "fabrikam-summit-2027/catalog.json", (s) => s.replace('"location": "Room 1"', '"place": "Room 1"'), /\.location must be text/],
  ["invalid JSON", "fabrikam-summit-2027/guides.json", (s) => s.slice(0, -3), /guides\.json is not valid JSON/],
];

test("invalid event bundles fail the build with specific messages", { skip: !hugoAvailable }, async (t) => {
  for (const [name, file, mutate, message] of invalidCases) {
    await t.test(name, async () => {
      const slug = name.replace(/[^a-z0-9]+/gi, "-").toLowerCase();
      const dir = `${buildRoot}/invalid/${slug}`;
      await rm(dir, { recursive: true, force: true });
      await mkdir(dir, { recursive: true });
      await cp(`${root}tests/fixtures/content`, `${dir}/content`, { recursive: true });
      const target = `${dir}/content/events/${file}`;
      const original = await readFile(target, "utf8");
      const changed = mutate(original);
      assert.notEqual(changed, original, "mutation must change the fixture");
      await writeFile(target, changed);
      const config = `${dir}/hugo.toml`;
      await writeFile(config, `contentDir = ${JSON.stringify(`${dir}/content`)}\n`);
      const result = hugo(["--config", `hugo.toml,${config}`, "-d", `${dir}/public`]);
      assert.notEqual(result.status, 0, "invalid content must fail the build");
      assert.match(result.stderr + result.stdout, message);
    });
  }
});

test("Hugo version supports the template features used for validation", { skip: !hugoAvailable }, () => {
  const version = /v(\d+)\.(\d+)/.exec(execFileSync("hugo", ["version"], { encoding: "utf8" }));
  assert.ok(Number(version[1]) > 0 || Number(version[2]) >= 141, "Hugo 0.141+ is required for try");
});
