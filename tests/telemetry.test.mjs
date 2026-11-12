// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT license.

import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, mkdir, writeFile, copyFile, symlink, rm } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  initializeTelemetry, splitTelemetryComposition, validateTelemetryConfig,
  parseTelemetryConnectionString, COMPOSITION_BYTES, STARTUP_LIMITS,
} from "../assets/js/telemetry.js";
import { createTelemetrySDK, createTelemetryTransport, sanitizeTelemetryEnvelope } from "../assets/js/telemetry-sdk.js";
import { createWcpConsentProvider } from "../assets/js/telemetry-consent.js";
import { createTestConsentProvider } from "../assets/js/telemetry-test-consent.js";

const KEY = "11111111-2222-4333-8444-555555555555";
const ORIGIN = "https://guide.example";
const CONNECTION = `InstrumentationKey=${KEY};IngestionEndpoint=https://westus2-1.in.applicationinsights.azure.com/;LiveEndpoint=https://westus2.livediagnostics.monitor.azure.com/;ApplicationId=${KEY}`;
const config = (overrides = {}) => ({ enabled: true, connectionString: CONNECTION, origin: ORIGIN,
  environment: "test", buildId: "test-build", consentMode: "test", ...overrides });
const events = [{ id: "ignite-2026" }, { id: "build-2026" }];
const settle = async () => { for (let index = 0; index < 8; index += 1) await Promise.resolve(); };
const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
function catalogOf(length = 1, width = 8, eventId = events[0].id) {
  const instances = Array.from({ length }, (_, index) => ({
    id: `occ-${String(index).padStart(width, "x")}`,
    sessionId: `session-${String(index).padStart(width, "x")}`,
    title: "DO NOT COLLECT title", description: "DO NOT COLLECT summary",
  }));
  return { event: { id: eventId }, byId: new Map(instances.map((item) => [item.sessionId, item])),
    instanceById: new Map(instances.map((item) => [item.id, item])), instances };
}
class Target {
  listeners = new Map();
  addEventListener(name, callback) {
    if (!this.listeners.has(name)) this.listeners.set(name, new Set());
    this.listeners.get(name).add(callback);
  }
  removeEventListener(name, callback) { this.listeners.get(name)?.delete(callback); }
  emit(name, event = {}) { this.listeners.get(name)?.forEach((callback) => callback(event)); }
}
class Element extends Target {
  constructor(tag = "div") { super(); this.tagName = tag.toUpperCase(); this.children = []; this.textContent = ""; }
  append(item) { this.children.push(item); item.parent = this; }
  remove() { if (this.parent) this.parent.children = this.parent.children.filter((item) => item !== this); }
  focus() { this.focused = true; }
}
function clock() {
  let time = 0;
  let id = 0;
  const timers = new Map();
  return {
    now: () => time,
    setTimeout(callback, delay) { timers.set(++id, { callback, at: time + delay }); return id; },
    clearTimeout(id) { timers.delete(id); },
    tick(delay) {
      time += delay;
      for (const [id, timer] of [...timers]) {
        if (timer.at <= time) { timers.delete(id); timer.callback(); }
      }
    },
    get pending() { return timers.size; },
  };
}
function consent(initial = null) {
  let value = initial;
  const subscribers = new Set();
  return {
    getConsent: () => value,
    subscribe(callback) { subscribers.add(callback); return () => subscribers.delete(callback); },
    choose(next) { value = next; subscribers.forEach((callback) => callback(next)); },
    setSilently(next) { value = next; },
    openPrivacySettings: () => true,
  };
}
function browser() {
  const document = new Target();
  const elements = new Map(["cookie-banner", "privacy-settings", "telemetry-status"].map((id) => [id, new Element()]));
  document.getElementById = (id) => elements.get(id);
  document.createElement = (tag) => new Element(tag);
  document.head = new Element("head");
  document.visibilityState = "visible";
  const storage = new Map();
  const window = new Target();
  window.document = document;
  window.location = { origin: ORIGIN };
  window.localStorage = { getItem: (key) => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, value), removeItem: (key) => storage.delete(key) };
  return { window, document, storage, elements };
}
function harness(t, { initial = true, catalog = catalogOf(), factory, settings, channel, consentStart } = {}) {
  const dom = browser();
  const time = clock();
  const provider = consent(initial);
  if (consentStart) provider.start = consentStart;
  const diagnostics = [];
  const instances = [];
  function fakeFactory(context) {
    const sdk = { rows: [], disposals: 0, flushes: 0, context,
      track(name, properties) { this.rows.push({ name, properties }); },
      flushNavigation() { this.flushes += 1; }, dispose() { this.disposals += 1; } };
    instances.push(sdk);
    return factory ? factory(sdk, context) : sdk;
  }
  const runtime = initializeTelemetry({ events, catalog, config: config(settings),
    consentProvider: provider, sdkFactory: fakeFactory,
    platform: { ...dom, ...time, now: time.now, setTimeout: time.setTimeout, clearTimeout: time.clearTimeout,
      randomUUID, console: { warn: (code) => diagnostics.push(code) }, BroadcastChannel: channel } });
  t.after(() => runtime.dispose());
  return { ...dom, runtime, provider, instances, catalog, time, diagnostics };
}
function selection(runtime, eventId = events[0].id) {
  return runtime.track("event_selected", { eventId, source: "directory", title: "NEVER title" });
}
function exportAction(runtime, instances, overrides = {}) {
  return runtime.trackComposition("calendar_export_requested", instances, {
    eventId: events[0].id, source: "agenda", exportedCount: instances.length, skippedCount: 0, conflictCount: 0, ...overrides,
  });
}

test("strict configuration validates resource endpoints, keys, environment and exact approved origin", () => {
  assert.equal(validateTelemetryConfig(config(), ORIGIN).enabled, true);
  assert.deepEqual(validateTelemetryConfig({ enabled: false, connectionString: CONNECTION }, ORIGIN), { enabled: false });
  assert.equal(parseTelemetryConnectionString(CONNECTION).endpointUrl, "https://westus2-1.in.applicationinsights.azure.com/v2/track");
  const bad = [
    { environment: "prod" }, { buildId: "has space" }, { origin: "https://other.example" },
    { origin: `${ORIGIN}/path` }, { origin: "http://guide.example" },
    { environment: "production", consentMode: "test" }, { connectionString: "" },
    { connectionString: CONNECTION.replace(KEY, "not-a-guid") },
    { connectionString: CONNECTION.replace("westus2-1.in.applicationinsights.azure.com", "collector.example") },
    { connectionString: `${CONNECTION};InstrumentationKey=${KEY}` },
    { connectionString: `${CONNECTION};Authorization=secret` },
    { connectionString: CONNECTION.replace("https://westus2-1", "http://westus2-1") },
    { connectionString: CONNECTION.replace(".com/;", ".com/path?secret=1;") },
  ];
  for (const item of bad) assert.throws(() => validateTelemetryConfig(config(item), ORIGIN), JSON.stringify(item));
  assert.equal(validateTelemetryConfig(config({ origin: "http://localhost:1313" }), "http://localhost:1313").enabled, true);
  assert.throws(() => validateTelemetryConfig(config({ origin: "http://localhost:1313", environment: "production", consentMode: "wcp" }), "http://localhost:1313"));
});

for (const length of [1, 20, 300, 1500]) {
  test(`multipart ${length} maximum-width identifiers preserve exact known order and UTF-8 property bounds`, () => {
    const catalog = catalogOf(length, 185);
    const result = splitTelemetryComposition(catalog.instances, catalog, events[0].id);
    assert.equal(result.totalItemCount, length);
    assert.equal(result.knownItemCount, length);
    assert.equal(result.unknownItemCount, 0);
    result.parts.forEach((part) => assert.ok(new TextEncoder().encode(part).length <= COMPOSITION_BYTES));
    assert.deepEqual(result.parts.flatMap(JSON.parse), catalog.instances.map((item, position) => ({
      sessionId: item.sessionId, occurrenceId: item.id, position,
    })));
    if (length >= 20) assert.ok(result.parts.length > 1, "custom20 must also split");
  });
}

test("unknown, forged and foreign-event snapshot membership is counted without leaking arbitrary identifiers", () => {
  const catalog = catalogOf(2);
  const result = splitTelemetryComposition([catalog.instances[0], { id: "UNKNOWN secret", sessionId: "SECRET" },
    { ...catalog.instances[1], sessionId: "forged" }, catalog.instances[1]], catalog, events[0].id);
  assert.deepEqual([result.totalItemCount, result.knownItemCount, result.unknownItemCount], [4, 2, 2]);
  assert.deepEqual(result.parts.flatMap(JSON.parse).map((item) => item.position), [0, 3]);
  assert.doesNotMatch(JSON.stringify(result), /secret|SECRET|forged|UNKNOWN/);
  assert.throws(() => splitTelemetryComposition(catalog.instances, catalog, events[1].id), /catalog-unavailable/);
  const huge = catalogOf(1, 7000);
  assert.throws(() => splitTelemetryComposition(huge.instances, huge, events[0].id), /composition-item-too-large/);
  const unicode = catalogOf();
  unicode.instances[0].id += "é".repeat(3000);
  unicode.instanceById = new Map([[unicode.instances[0].id, unicode.instances[0]]]);
  assert.throws(() => splitTelemetryComposition(unicode.instances, unicode, events[0].id), /composition-item-too-large/);
});

test("disabled and invalid-config facades never start consent or SDK", async () => {
  let started = 0;
  for (const settings of [{ enabled: false }, config({ origin: "https://wrong.example" })]) {
    const runtime = initializeTelemetry({ config: settings, consentProvider: { start() { started += 1; } },
      sdkFactory() { started += 1; }, platform: browser() });
    assert.equal(selection(runtime).state, "dropped");
    assert.equal(exportAction(runtime, []).state, "dropped");
    assert.equal(runtime.openPrivacySettings(), false);
    runtime.setCatalog(null);
    runtime.dispose();
  }
  assert.equal(started, 0);
});

test("production telemetry needs enabled configuration and consent, not a separate release flag", async (t) => {
  const h = harness(t, { initial: null, settings: { environment: "production", consentMode: "wcp" } });
  await settle();
  assert.equal(h.runtime.status, "waiting-for-consent");
  assert.equal(selection(h.runtime).state, "dropped");
  assert.equal(h.instances.length, 0);
  h.provider.choose(true);
  await settle();
  assert.equal(h.runtime.status, "ready");
  assert.equal(selection(h.runtime).state, "submitted");
  assert.equal(h.instances[0].rows.length, 1);
  h.provider.choose(false);
  assert.equal(selection(h.runtime).state, "dropped");
  assert.equal(h.instances[0].rows.length, 1);
});

test("unconsented actions never queue or replay; consent allows only later explicit actions", async (t) => {
  const h = harness(t, { initial: null });
  assert.equal(selection(h.runtime).state, "dropped");
  assert.equal(exportAction(h.runtime, h.catalog.instances).state, "dropped");
  await settle();
  assert.equal(h.runtime.status, "waiting-for-consent");
  assert.equal(h.elements.get("telemetry-status").textContent, "Optional analytics off until consent is available.");
  assert.equal(h.instances.length, 0);
  h.provider.choose(false);
  h.provider.choose(true);
  await settle();
  assert.equal(h.runtime.status, "ready");
  assert.equal(h.instances[0].rows.length, 0);
  assert.equal(selection(h.runtime).state, "submitted");
  assert.equal(h.instances[0].rows.length, 1);
});

test("normal unselected consent stays waiting while actual consent startup failure is unavailable", async (t) => {
  const waiting = harness(t, { initial: null, consentStart: async () => {} });
  const failed = harness(t, { initial: null, consentStart: async () => { throw new Error("blocked provider"); } });
  await settle();
  assert.equal(waiting.runtime.status, "waiting-for-consent");
  assert.equal(failed.runtime.status, "unavailable");
  assert.match(failed.elements.get("telemetry-status").textContent, /unavailable/);
  for (const h of [waiting, failed]) {
    assert.equal(selection(h.runtime).state, "dropped");
    assert.equal(exportAction(h.runtime, h.catalog.instances).state, "dropped");
    assert.equal(h.instances.length, 0);
  }
});

test("consent reset waits for choice and invalidates pending/ready generations without replay", async (t) => {
  const pending = deferred();
  let first = true;
  const h = harness(t, { factory(sdk) { if (first) { first = false; return pending.promise; } return sdk; } });
  await settle();
  assert.equal(exportAction(h.runtime, h.catalog.instances).state, "queued");
  h.provider.choose(null);
  assert.equal(h.runtime.status, "waiting-for-consent");
  assert.equal(h.time.pending, 0);
  assert.equal(exportAction(h.runtime, h.catalog.instances).state, "dropped");
  pending.resolve(h.instances[0]);
  await settle();
  assert.equal(h.instances[0].disposals, 1);
  assert.equal(h.instances[0].rows.length, 0);
  h.provider.choose(true);
  await settle();
  assert.equal(h.runtime.status, "ready");
  assert.equal(h.instances[1].rows.length, 0);
  assert.equal(exportAction(h.runtime, h.catalog.instances).state, "submitted");
  assert.equal(h.instances[1].rows.length, 1);
  h.provider.choose(null);
  assert.equal(h.runtime.status, "waiting-for-consent");
  assert.equal(h.instances[1].disposals, 1);
  assert.equal(selection(h.runtime).state, "dropped");
  h.provider.choose(true);
  await settle();
  assert.equal(h.instances[2].rows.length, 0);
});

test("named events and property allowlists omit titles, notes, URLs, searches, identities and extra keys", async (t) => {
  const h = harness(t);
  await settle();
  const input = { eventId: events[0].id, source: "catalog", sessionId: h.catalog.instances[0].sessionId,
    title: "SECRET title", summary: "SECRET summary", notes: "SECRET notes", url: "https://host/?secret=1",
    query: "SECRET query", referrer: "SECRET referrer", userId: "SECRET user", actionId: "malicious" };
  assert.equal(h.runtime.track("session_opened", input).state, "submitted");
  assert.equal(h.runtime.track("catalog_zero_results", { ...input, facetNames: ["search", "topic", "topic"] }).state, "submitted");
  assert.equal(h.runtime.track("shared_guide_opened", { ...input, source: "shared", shareVersion: 2, sessionCount: 2 }).state, "submitted");
  const rows = h.instances[0].rows;
  assert.doesNotMatch(JSON.stringify(rows), /SECRET|https:|malicious/);
  assert.deepEqual(Object.keys(rows[0].properties).sort(), [
    "schemaVersion", "buildId", "environment", "eventId", "source", "actionId", "sessionId",
  ].sort());
  assert.equal(rows[1].properties.facetNames, '["search","topic"]');
  assert.equal(rows[1].properties.facetCount, 2);
  assert.equal(new Set(rows.map((item) => item.properties.actionId)).size, 3);
  for (const [name, props] of [["made_up", input], ["session_opened", { ...input, sessionId: "SECRET id" }],
    ["session_opened", { ...input, eventId: events[1].id }], ["event_selected", { ...input, source: "url" }],
    ["event_selected", { ...input, eventId: "untrusted", source: "directory" }],
    ["catalog_zero_results", { ...input, facetNames: ["SECRET raw text"] }],
    ["shared_guide_opened", { ...input, source: "shared", sessionCount: -1, shareVersion: 2 }]]) {
    assert.equal(h.runtime.track(name, props).state, "dropped");
  }
  assert.equal(rows.length, 3);
});

test("calendar and custom multipart share numbered immutable action contract, including all-unknown membership", async (t) => {
  const catalog = catalogOf(20, 190);
  const h = harness(t, { catalog });
  await settle();
  for (const name of ["calendar_export_requested", "custom_guide_created"]) {
    const props = name === "custom_guide_created"
      ? { eventId: events[0].id, source: "custom", shareVersion: 2, sessionCount: 20 }
      : { eventId: events[0].id, source: "agenda", exportedCount: 20, skippedCount: 1, conflictCount: 3 };
    assert.equal(h.runtime.trackComposition(name, catalog.instances, props).state, "submitted");
    const parts = h.instances[0].rows.filter((row) => row.name === name).map((row) => row.properties);
    assert.ok(parts.length > 1);
    assert.equal(new Set(parts.map((part) => part.actionId)).size, 1);
    parts.forEach((part, index) => {
      assert.equal(part.partIndex, index);
      assert.equal(part.partCount, parts.length);
      assert.equal(part.itemsInPart, JSON.parse(part.composition).length);
      assert.equal(part.totalItemCount, 20);
      assert.equal(part.knownItemCount, 20);
      assert.equal(part.unknownItemCount, 0);
    });
    assert.deepEqual(parts.flatMap((part) => JSON.parse(part.composition)).map((item) => item.occurrenceId), catalog.instances.map((item) => item.id));
  }
  assert.equal(exportAction(h.runtime, [{ id: "SECRET", sessionId: "SECRET" }]).state, "submitted");
  assert.equal(h.instances[0].rows.at(-1).properties.unknownItemCount, 1);
  assert.equal(h.instances[0].rows.at(-1).properties.composition, "[]");
  assert.equal(exportAction(h.runtime, catalog.instances, { exportedCount: 19 }).state, "dropped");
});

test("catalog version comes only from the matching trusted catalog; parent source enums are allowlisted", async (t) => {
  const h = harness(t);
  h.catalog.event.catalogVersion = "release-2026.11:1";
  await settle();
  for (const source of ["session", "path", "draft", "shared", "agenda", "catalog", "custom"]) {
    assert.equal(h.runtime.track("session_opened", {
      eventId: events[0].id, source, sessionId: h.catalog.instances[0].sessionId,
      catalogVersion: "UNTRUSTED provided version",
    }).state, "submitted");
    assert.equal(exportAction(h.runtime, h.catalog.instances, { source }).state, "submitted");
  }
  h.instances[0].rows.forEach((row) => assert.equal(row.properties.catalogVersion, "release-2026.11:1"));
  for (const source of ["directory", "switcher"]) {
    assert.equal(h.runtime.track("event_selected", { eventId: events[1].id, source }).state, "submitted");
    assert.equal(h.instances[0].rows.at(-1).properties.catalogVersion, undefined, "never attach the current catalog's version to another event");
  }
  for (const version of ["https://url/?SECRET", "SECRET text"]) {
    h.catalog.event.catalogVersion = version;
    selection(h.runtime);
    assert.equal(h.instances[0].rows.at(-1).properties.catalogVersion, undefined);
  }
});

test("consented startup queue snapshots actual action selection and never queues native navigation", async (t) => {
  const pending = deferred();
  const h = harness(t, { factory: () => pending.promise });
  await settle();
  assert.equal(h.runtime.status, "starting");
  assert.equal(selection(h.runtime).state, "dropped");
  const selected = h.catalog.instances.map((item) => ({ ...item }));
  assert.equal(exportAction(h.runtime, selected).state, "queued");
  const original = selected[0].id;
  selected[0].id = "MUTATED SECRET";
  selected.length = 0;
  h.runtime.setCatalog(catalogOf(1, 8, events[1].id));
  pending.resolve(h.instances[0]);
  await settle();
  assert.equal(h.instances[0].rows.length, 1);
  assert.equal(JSON.parse(h.instances[0].rows[0].properties.composition)[0].occurrenceId, original);
});

test("startup queue drops whole logical actions at action and byte limits with diagnostics", async (t) => {
  const pending = deferred();
  const h = harness(t, { factory: () => pending.promise });
  await settle();
  for (let index = 0; index < STARTUP_LIMITS.actions; index += 1) assert.equal(exportAction(h.runtime, h.catalog.instances).state, "queued");
  assert.deepEqual(exportAction(h.runtime, h.catalog.instances), { state: "dropped", reason: "startup-capacity" });
  pending.resolve(h.instances[0]);
  await settle();
  assert.equal(h.instances[0].rows.length, STARTUP_LIMITS.actions);
  assert.ok(h.diagnostics.includes("[telemetry] startup-action-capacity"));
  const blocked = deferred();
  const large = harness(t, { catalog: catalogOf(1500, 190), factory: () => blocked.promise });
  await settle();
  assert.equal(exportAction(large.runtime, large.catalog.instances).state, "dropped");
  blocked.resolve(large.instances[0]);
  await settle();
  assert.equal(large.instances[0].rows.length, 0);
});

test("startup timeout/expiry invalidates all queued actions and late SDKs", async (t) => {
  const pending = deferred();
  const h = harness(t, { factory: () => pending.promise });
  await settle();
  exportAction(h.runtime, h.catalog.instances);
  h.time.tick(STARTUP_LIMITS.milliseconds + 1);
  assert.equal(h.runtime.status, "unavailable");
  pending.resolve(h.instances[0]);
  await settle();
  assert.equal(h.instances[0].rows.length, 0);
  assert.equal(h.instances[0].disposals, 1);
  assert.equal(h.time.pending, 0);
});

test("withdrawal during initialization and reconsent use fresh generations with one live SDK", async (t) => {
  const pending = deferred();
  let first = true;
  const h = harness(t, { factory(sdk) { if (first) { first = false; return pending.promise; } return sdk; } });
  await settle();
  exportAction(h.runtime, h.catalog.instances);
  h.provider.choose(false);
  h.provider.choose(true);
  await settle();
  assert.equal(h.instances.length, 2);
  pending.resolve(h.instances[0]);
  await settle();
  assert.equal(h.instances[0].disposals, 1);
  assert.equal(h.instances[0].rows.length, 0);
  assert.equal(h.instances[1].disposals, 0);
  assert.equal(selection(h.runtime).state, "submitted");
  h.provider.choose(false);
  assert.equal(h.instances[1].disposals, 1);
  assert.equal(selection(h.runtime).state, "dropped");
  h.provider.choose(true);
  await settle();
  assert.equal(h.instances.length, 3);
  assert.equal(h.instances.filter((sdk) => sdk.disposals === 0).length, 1);
  assert.equal(h.instances[2].rows.length, 0);
});

test("dispatch and visibility recheck consent; storage and broadcast support withdrawal only", async (t) => {
  class Channel {
    static instances = [];
    constructor() { Channel.instances.push(this); }
    postMessage(data) { Channel.instances.filter((item) => item !== this).forEach((item) => item.onmessage?.({ data })); }
    close() { this.closed = true; }
  }
  const a = harness(t, { channel: Channel });
  const b = harness(t, { channel: Channel });
  await settle();
  a.provider.choose(false);
  assert.equal(b.runtime.status, "denied");
  assert.equal(selection(b.runtime).state, "dropped");
  Channel.instances[0].postMessage("allow");
  b.document.emit("visibilitychange");
  assert.equal(selection(b.runtime).state, "dropped", "cross-tab messages and visibility cannot grant");
  b.provider.choose(true);
  await settle();
  assert.equal(selection(b.runtime).state, "submitted");
  b.provider.setSilently(false);
  b.document.emit("visibilitychange");
  assert.equal(b.runtime.status, "denied");
  b.provider.choose(true);
  await settle();
  b.provider.setSilently(false);
  assert.equal(selection(b.runtime).state, "dropped", "dispatch rechecks even without callback");
  b.provider.choose(true);
  await settle();
  b.window.emit("storage", { key: "ms-events-guide:telemetry-withdrawal", newValue: "nonce" });
  assert.equal(selection(b.runtime).state, "dropped");
});

test("unavailable consent/storage/SDK failures never throw into application actions or leak exception content", async (t) => {
  const h = harness(t, { factory: async () => { throw new Error("SECRET https://url/?token=secret"); } });
  await settle();
  assert.equal(h.runtime.status, "unavailable");
  assert.equal(selection(h.runtime).state, "dropped");
  assert.doesNotMatch(JSON.stringify(h.diagnostics), /SECRET|https:|token/);
  h.provider.choose(false);
  h.provider.choose(true);
  await settle();
  assert.equal(h.runtime.status, "unavailable");
  const broken = harness(t);
  await settle();
  broken.window.localStorage.setItem = () => { throw new Error("blocked storage"); };
  broken.provider.choose(false);
  assert.equal(broken.runtime.status, "denied");
  const consentFailure = browser();
  const failed = initializeTelemetry({ events, config: config(), consentProvider: {
    subscribe() { throw new Error("SECRET consent failure"); }, getConsent() { throw new Error("SECRET"); },
  }, sdkFactory: () => { throw new Error("must not start"); }, platform: { ...consentFailure, randomUUID, console: { warn() {} } } });
  t.after(() => failed.dispose());
  await settle();
  assert.equal(failed.status, "unavailable");
  assert.equal(selection(failed).state, "dropped");
});

test("source-observed selection fires once per explicit hook; initialization and direct loads emit no fake pageview", async (t) => {
  const h = harness(t);
  await settle();
  assert.equal(h.instances[0].rows.length, 0);
  selection(h.runtime);
  h.runtime.track("event_selected", { eventId: events[1].id, source: "switcher" });
  assert.equal(h.instances[0].rows.length, 2);
  assert.equal(h.instances[0].flushes, 2);
  assert.notEqual(h.instances[0].rows[0].properties.actionId, h.instances[0].rows[1].properties.actionId);
  h.provider.choose(false);
  h.window.emit("pagehide");
  assert.equal(h.instances[0].flushes, 2);
  h.runtime.dispose();
  assert.equal(h.runtime.status, "disposed");
  assert.equal(selection(h.runtime).state, "dropped");
});

test("SDK rejection/unavailable navigation is reported as dropped, never a collection success", async (t) => {
  const h = harness(t, { factory(sdk) { sdk.track = () => false; return sdk; } });
  await settle();
  assert.deepEqual(selection(h.runtime), { state: "dropped", reason: "transport-unavailable" });
  assert.equal(h.instances[0].flushes, 0);
});

test("actual 3.4.6 core+sender final golden envelopes contain no identity, operation, browser, URL or automatic events", async () => {
  const requests = [];
  let allowed = true;
  const settings = validateTelemetryConfig(config(), ORIGIN);
  const sdk = createTelemetrySDK({ config: settings, canSend: () => allowed, diagnostic() {},
    window: { Request, fetch: async (url, init) => { requests.push({ url, init }); return { status: 200 }; } } });
  try {
    sdk.track("event_selected", { eventId: events[0].id, source: "directory", actionId: randomUUID() });
    sdk.flushNavigation();
    await settle();
    assert.equal(requests.length, 1);
    const request = requests[0];
    assert.equal(request.init.keepalive, true);
    assert.equal(request.init.referrerPolicy, "no-referrer");
    assert.equal(request.init.credentials, "omit");
    assert.deepEqual(request.init.headers, { "Content-Type": "application/json" });
    const envelope = JSON.parse(request.init.body)[0];
    assert.deepEqual(Object.keys(envelope).sort(), ["name", "time", "sampleRate", "iKey", "tags", "data"].sort());
    assert.deepEqual(Object.keys(envelope.tags).sort(), ["ai.application.ver", "ai.internal.sdkVersion", "ai.location.ip"].sort());
    assert.equal(envelope.tags["ai.internal.sdkVersion"], "javascript:3.4.6");
    assert.equal(envelope.tags["ai.location.ip"], "0.0.0.0");
    assert.equal(envelope.sampleRate, 100);
    assert.equal(envelope.data.baseType, "EventData");
    assert.doesNotMatch(request.init.body, /operation|user|session\.id|device|referrer|https?:|pageView|exception/i);
    sdk.track("calendar_export_requested", { actionId: randomUUID() });
    allowed = false;
    sdk.dispose();
    await settle();
    assert.equal(requests.length, 1, "pause+unload must discard pending sender batches without teardown flush");
    sdk.dispose();
  } finally { sdk.dispose(); }
});

test("actual SDK 1500-occurrence multipart payloads reconstruct completely without serializer truncation or keepalive quota abuse", async (t) => {
  const requests = [];
  const catalog = catalogOf(1500, 185);
  const h = harness(t, { catalog, factory(_sdk, context) {
    context.window.Request = Request;
    context.window.fetch = async (_url, init) => { requests.push(init); return { status: 200 }; };
    return createTelemetrySDK(context);
  } });
  await settle();
  assert.equal(exportAction(h.runtime, catalog.instances).state, "submitted");
  h.window.emit("pagehide");
  await settle();
  const parts = requests.flatMap((request) => JSON.parse(request.body)).map((envelope) => envelope.data.baseData.properties);
  assert.ok(parts.length > 1);
  assert.ok(requests.some((request) => request.keepalive === false), "ordinary large exports must not exhaust the 64KiB aggregate keepalive budget");
  assert.ok(requests.at(-1).keepalive);
  assert.equal(parts.length, Number(parts[0].partCount));
  assert.equal(new Set(parts.map((part) => part.actionId)).size, 1);
  parts.forEach((part, index) => {
    assert.equal(Number(part.partIndex), index);
    assert.equal(Number(part.knownItemCount), 1500);
    assert.equal(Number(part.unknownItemCount), 0);
    assert.ok(new TextEncoder().encode(part.composition).length <= COMPOSITION_BYTES);
  });
  assert.deepEqual(parts.flatMap((part) => JSON.parse(part.composition)).map((item) => item.occurrenceId), catalog.instances.map((item) => item.id));
});

test("SDK network rejection is best-effort and withdrawal prevents later retry initiation", async () => {
  let allowed = true;
  let requests = 0;
  const diagnostics = [];
  const sdk = createTelemetrySDK({ config: validateTelemetryConfig(config(), ORIGIN), canSend: () => allowed,
    diagnostic: (code) => diagnostics.push(code), window: { Request, fetch: async () => {
      requests += 1;
      throw new Error("SECRET token https://private-url/");
    } } });
  try {
    assert.doesNotThrow(() => {
      sdk.track("event_selected", { eventId: events[0].id, source: "directory", actionId: randomUUID() });
      sdk.flushNavigation();
    });
    await settle();
    assert.equal(requests, 1);
    assert.ok(diagnostics.includes("transport-unavailable"));
    assert.doesNotMatch(JSON.stringify(diagnostics), /SECRET|private-url|token/);
    allowed = false;
    sdk.dispose();
    sdk.flushNavigation();
    await settle();
    assert.equal(requests, 1);
  } finally { sdk.dispose(); }
});

test("SDK transport rechecks consent on every retry, scrubs excluded SDK tags and has no sync-XHR fallback", async () => {
  let allowed = true;
  const requests = [];
  const transport = createTelemetryTransport({ config: { endpointUrl: "https://approved.example/v2/track", buildId: "golden" },
    canSend: () => allowed, diagnostic() {}, window: { Request, fetch: async (...args) => { requests.push(args); return { status: 200 }; } } });
  const envelope = { name: "Microsoft.ApplicationInsights.key.Event", time: "2026-11-11T00:00:00Z", iKey: KEY,
    tags: { "ai.user.id": "SECRET", "ai.operation.name": "https://url?SECRET", "ai.session.id": "SECRET",
      "ai.device.id": "SECRET", "ai.internal.sdkVersion": "javascript:3.4.6" },
    ext: { user: { id: "SECRET" } }, data: { baseType: "EventData", baseData: { name: "event_selected",
      properties: { source: "directory", userId: "SECRET", url: "SECRET", notes: "SECRET" } } } };
  const payload = { data: JSON.stringify([envelope]), urlString: "https://not-approved.example/" };
  transport.sendPOST(payload, () => {});
  await settle();
  assert.equal(requests[0][0], "https://approved.example/v2/track");
  assert.doesNotMatch(requests[0][1].body, /SECRET|not-approved/);
  allowed = false;
  transport.sendPOST(payload, () => {});
  assert.equal(requests.length, 1, "no new retry request after withdrawal");
  assert.equal(sanitizeTelemetryEnvelope({ data: { baseType: "PageviewData" } }, "golden"), null);
  transport.close();
  const unsupported = createTelemetrySDK({ config: validateTelemetryConfig(config(), ORIGIN), canSend: () => true,
    diagnostic() {}, window: { fetch: async () => { throw new Error("must not dispatch navigation"); } } });
  unsupported.track("event_selected", {});
  unsupported.flushNavigation();
  unsupported.dispose();
});

test("WCP uses supported Analytics category and settings API, fails closed for NR/blocked/timeout states", async () => {
  const dom = browser();
  let callback;
  let analytics = false;
  let managed = 0;
  const manager = { isConsentRequired: true, getConsentFor(category) { assert.equal(category, "Analytics"); return analytics; },
    manageConsent() { managed += 1; } };
  dom.window.WcpConsent = { consentCategories: { Analytics: "Analytics" },
    init(language, banner, done, onChanged) {
      assert.equal(language, "en-US");
      assert.equal(banner, dom.elements.get("cookie-banner"));
      callback = onChanged;
      done(undefined, manager);
    } };
  const provider = createWcpConsentProvider(dom);
  const choices = [];
  provider.subscribe((value) => choices.push(value));
  await provider.start();
  assert.equal(provider.getConsent(), false);
  analytics = true;
  callback();
  assert.equal(provider.getConsent(), true);
  assert.deepEqual(choices, [false, true]);
  assert.equal(provider.openPrivacySettings(), true);
  assert.equal(managed, 1);
  provider.dispose();
  callback();
  assert.equal(provider.getConsent(), null);
  for (const required of [false, undefined]) {
    dom.window.WcpConsent.init = (_language, _banner, done) => done(undefined, { ...manager, isConsentRequired: required });
    const nr = createWcpConsentProvider(dom);
    await assert.rejects(nr.start(), /wcp-unavailable/);
    assert.equal(nr.getConsent(), null);
    assert.equal(nr.openPrivacySettings(), false);
    nr.dispose();
  }
  const blockedDom = browser();
  const blocked = createWcpConsentProvider(blockedDom);
  const load = blocked.start();
  const script = blockedDom.document.head.children[0];
  assert.equal(script.src, "https://wcpstatic.microsoft.com/mscc/lib/v2/wcp-consent.js");
  assert.equal(script.referrerPolicy, "no-referrer");
  script.onerror();
  await assert.rejects(load, /wcp-unavailable/);
  assert.equal(blocked.getConsent(), null);
  blocked.dispose();
  const time = clock();
  const timed = createWcpConsentProvider({ ...browser(), setTimeout: time.setTimeout, clearTimeout: time.clearTimeout });
  const timeout = timed.start();
  time.tick(10001);
  await assert.rejects(timeout, /wcp-unavailable/);
  assert.equal(timed.getConsent(), null);
  timed.dispose();
});

test("explicit TEST adapter has equal-type Allow/Reject/reset controls, valid stored choice and storage-unavailable fallback", () => {
  const dom = browser();
  const provider = createTestConsentProvider(dom);
  provider.start();
  const buttons = dom.elements.get("cookie-banner").children.filter((element) => element.tagName === "BUTTON");
  assert.deepEqual(buttons.map((button) => button.textContent), ["Allow TEST analytics", "Reject TEST analytics", "Reset TEST consent"]);
  assert.ok(buttons.every((button) => button.type === "button"));
  assert.equal(provider.getConsent(), null);
  buttons[0].emit("click");
  assert.equal(provider.getConsent(), true);
  const other = createTestConsentProvider(dom);
  assert.equal(other.getConsent(), true);
  buttons[1].emit("click");
  assert.equal(provider.getConsent(), false);
  buttons[2].emit("click");
  assert.equal(provider.getConsent(), null);
  dom.window.localStorage.getItem = () => { throw new Error("storage blocked"); };
  dom.window.localStorage.setItem = () => { throw new Error("storage blocked"); };
  buttons[0].emit("click");
  assert.equal(provider.getConsent(), true);
  assert.equal(provider.openPrivacySettings(), true);
  provider.dispose();
  other.dispose();
});

test("Hugo telemetry flag/config matrix and tree-shaken disabled/production SDK and consent bundles", async (t) => {
  const root = fileURLToPath(new URL("../", import.meta.url));
  const fixture = `${root}tests/.telemetry-fixture-${process.pid}-${randomUUID()}`;
  await mkdir(`${fixture}/layouts/partials`, { recursive: true });
  await mkdir(`${fixture}/assets/js`, { recursive: true });
  t.after(() => rm(fixture, { recursive: true, force: true }));
  await copyFile(`${root}layouts/partials/telemetry-config.html`, `${fixture}/layouts/partials/telemetry-config.html`);
  for (const name of ["telemetry.js", "telemetry-sdk.js", "telemetry-consent.js", "telemetry-test-consent.js"]) {
    await copyFile(`${root}assets/js/${name}`, `${fixture}/assets/js/${name}`);
  }
  await symlink(`${root}node_modules`, `${fixture}/node_modules`, "dir");
  await writeFile(`${fixture}/hugo.toml`, 'baseURL = "https://guide.example/repo/"\ndisableKinds = ["taxonomy", "term", "RSS", "sitemap"]\n');
  await writeFile(`${fixture}/assets/js/entry.js`, 'import {initializeTelemetry} from "./telemetry.js"; globalThis.guideTelemetry=initializeTelemetry();');
  await writeFile(`${fixture}/layouts/index.html`, `{{ $t := partial "telemetry-config.html" . }}{{ $t.config | jsonify | safeHTML }}
{{ $test := and $t.enabled (eq $t.config.environment "test") (eq $t.config.consentMode "test") }}
{{ $js := resources.Get "js/entry.js" | js.Build (dict "targetPath" "guide.js" "minify" true "defines" (dict "__TELEMETRY_ENABLED__" (cond $t.enabled "true" "false") "__TELEMETRY_TEST__" (cond $test "true" "false"))) }}{{ $js.RelPermalink }}`);
  const clean = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("HUGO_TELEMETRY_")));
  function build(env = {}) {
    return spawnSync("hugo", ["--source", fixture, "--destination", `${fixture}/output`, "--noBuildLock"], {
      encoding: "utf8", env: { ...clean, ...env }, timeout: 30000,
    });
  }
  const valid = { HUGO_TELEMETRY_ENABLED: "true", HUGO_TELEMETRY_ENV: "test",
    HUGO_TELEMETRY_CONNECTION_STRING: CONNECTION, HUGO_TELEMETRY_CONSENT_MODE: "test" };
  for (const flag of [undefined, "false"]) {
    const result = build(flag === undefined ? {} : { HUGO_TELEMETRY_ENABLED: flag });
    assert.equal(result.status, 0, result.stdout + result.stderr);
    const html = await readFile(`${fixture}/output/index.html`, "utf8");
    const js = await readFile(`${fixture}/output/guide.js`, "utf8");
    assert.match(html, /"enabled":false/);
    assert.doesNotMatch(html + js, /InstrumentationKey|wcpstatic|applicationinsights|livediagnostics|v2\/track|TEST analytics|AppInsightsCore/);
  }
  for (const env of [
    { HUGO_TELEMETRY_ENABLED: "TRUE" }, { HUGO_TELEMETRY_ENABLED: "false " },
    { HUGO_TELEMETRY_ENABLED: "true" }, { ...valid, HUGO_TELEMETRY_CONNECTION_STRING: "" },
    { ...valid, HUGO_TELEMETRY_ENV: "staging" },
    { ...valid, HUGO_TELEMETRY_CONNECTION_STRING: CONNECTION.replace(KEY, "invalid") },
    { ...valid, HUGO_TELEMETRY_CONNECTION_STRING: CONNECTION.replace("westus2-1.in.applicationinsights.azure.com", "arbitrary.example") },
    { ...valid, HUGO_TELEMETRY_ENV: "production" },
    { ...valid, HUGO_TELEMETRY_ORIGIN: "http://unapproved.example" },
    { ...valid, HUGO_TELEMETRY_ORIGIN: "https://guide.example/path" },
    { ...valid, HUGO_TELEMETRY_CONSENT_MODE: "fake" },
    { ...valid, HUGO_TELEMETRY_BUILD_ID: "not safe" },
  ]) {
    const result = build(env);
    assert.notEqual(result.status, 0, `must reject ${JSON.stringify(env)}`);
  }
  const enabled = build(valid);
  assert.equal(enabled.status, 0, enabled.stdout + enabled.stderr);
  assert.match(await readFile(`${fixture}/output/guide.js`, "utf8"), /Allow TEST analytics/);
  const production = build({ ...valid, HUGO_TELEMETRY_ENV: "production", HUGO_TELEMETRY_CONSENT_MODE: "wcp" });
  assert.equal(production.status, 0, production.stdout + production.stderr);
  const productionJS = await readFile(`${fixture}/output/guide.js`, "utf8");
  assert.doesNotMatch(productionJS, /Allow TEST analytics|telemetry-test-consent|Reset TEST consent/);
  assert.match(productionJS, /wcpstatic/);
});
