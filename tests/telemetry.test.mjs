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

const KEY = "11111111-2222-4333-8444-555555555555";
const ORIGIN = "https://guide.example";
const CONNECTION = `InstrumentationKey=${KEY};IngestionEndpoint=https://westus2-1.in.applicationinsights.azure.com/;LiveEndpoint=https://westus2.livediagnostics.monitor.azure.com/;ApplicationId=${KEY}`;
const config = (overrides = {}) => ({ enabled: true, connectionString: CONNECTION, origin: ORIGIN,
  environment: "test", buildId: "test-build", ...overrides });
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
function browser() {
  const document = new Target();
  const accesses = [];
  function forbidden(name) { accesses.push(name); throw new Error(`Unexpected telemetry access: ${name}`); }
  document.getElementById = (id) => id === "telemetry-config" ? null : forbidden(id);
  document.createElement = () => forbidden("createElement");
  Object.defineProperty(document, "cookie", { get: () => forbidden("cookie"), set: () => forbidden("cookie") });
  document.visibilityState = "visible";
  const window = new Target();
  window.document = document;
  window.location = { origin: ORIGIN };
  for (const name of ["localStorage", "sessionStorage", "WcpConsent", "BroadcastChannel"]) {
    Object.defineProperty(window, name, { get: () => forbidden(name) });
  }
  return { window, document, accesses };
}
function harness(t, { catalog = catalogOf(), factory, settings } = {}) {
  const dom = browser();
  const time = clock();
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
    sdkFactory: fakeFactory,
    platform: { ...dom, ...time, now: time.now, setTimeout: time.setTimeout, clearTimeout: time.clearTimeout,
      randomUUID, console: { warn: (code) => diagnostics.push(code) } } });
  t.after(() => { runtime.dispose(); assert.deepEqual(dom.accesses, []); });
  return { ...dom, runtime, instances, catalog, time, diagnostics };
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
    { connectionString: "" },
    { connectionString: CONNECTION.replace(KEY, "not-a-guid") },
    { connectionString: CONNECTION.replace("westus2-1.in.applicationinsights.azure.com", "collector.example") },
    { connectionString: `${CONNECTION};InstrumentationKey=${KEY}` },
    { connectionString: `${CONNECTION};Authorization=secret` },
    { connectionString: CONNECTION.replace("https://westus2-1", "http://westus2-1") },
    { connectionString: CONNECTION.replace(".com/;", ".com/path?secret=1;") },
  ];
  for (const item of bad) assert.throws(() => validateTelemetryConfig(config(item), ORIGIN), JSON.stringify(item));
  assert.equal(validateTelemetryConfig(config({ origin: "http://localhost:1313" }), "http://localhost:1313").enabled, true);
  assert.equal(validateTelemetryConfig(config({ environment: "production" }), ORIGIN).enabled, true);
  assert.throws(() => validateTelemetryConfig(config({ origin: "http://localhost:1313", environment: "production" }), "http://localhost:1313"));
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

test("absent, disabled and invalid configuration never starts SDK or sends preconfiguration actions", async () => {
  let started = 0;
  for (const settings of [undefined, { enabled: false }, config({ origin: "https://wrong.example" })]) {
    const dom = browser();
    const runtime = initializeTelemetry({ config: settings,
      sdkFactory() { started += 1; }, platform: { ...dom, console: { warn() {} } } });
    assert.equal(selection(runtime).state, "dropped");
    assert.equal(exportAction(runtime, []).state, "dropped");
    assert.equal(runtime.openPrivacySettings, undefined);
    runtime.setCatalog(null);
    runtime.dispose();
    assert.deepEqual(dom.accesses, []);
  }
  assert.equal(started, 0);
});

test("enabled test and production telemetry starts automatically without consent or storage access", async (t) => {
  for (const environment of ["production", "test"]) {
    const h = harness(t, { settings: { environment } });
    assert.equal(h.runtime.status, "starting");
    await settle();
    assert.equal(h.runtime.status, "ready");
    assert.equal(h.instances.length, 1);
    assert.equal(h.instances[0].rows.length, 0);
    assert.equal(h.instances[0].context.canSend(), true);
    assert.equal(selection(h.runtime).state, "submitted");
    assert.equal(h.instances[0].rows.length, 1);
    assert.equal(h.runtime.openPrivacySettings, undefined);
    assert.deepEqual(h.accesses, []);
  }
});

test("disposal invalidates pending startup and queued actions without restarting", async (t) => {
  const pending = deferred();
  const h = harness(t, { factory: () => pending.promise });
  await settle();
  assert.equal(h.instances[0].context.canSend(), true);
  assert.equal(exportAction(h.runtime, h.catalog.instances).state, "queued");
  h.runtime.dispose();
  assert.equal(h.runtime.status, "disposed");
  assert.equal(h.instances[0].context.canSend(), false);
  assert.equal(h.time.pending, 0);
  assert.equal(exportAction(h.runtime, h.catalog.instances).state, "dropped");
  pending.resolve(h.instances[0]);
  await settle();
  assert.equal(h.instances[0].disposals, 1);
  assert.equal(h.instances[0].rows.length, 0);
  assert.equal(h.runtime.status, "disposed");
  assert.equal(h.instances.length, 1);
  assert.equal(selection(h.runtime).state, "dropped");
  h.runtime.dispose();
  assert.equal(h.instances[0].disposals, 1);
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

test("startup queue snapshots actual action selection and never queues native navigation", async (t) => {
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
  assert.equal(h.instances[0].context.canSend(), false);
  assert.equal(selection(h.runtime).state, "dropped");
  assert.equal(exportAction(h.runtime, h.catalog.instances).state, "dropped");
  pending.resolve(h.instances[0]);
  await settle();
  assert.equal(h.instances[0].rows.length, 0);
  assert.equal(h.instances[0].disposals, 1);
  assert.equal(h.time.pending, 0);
});

test("pagehide clears pending startup actions and flushes only the current sender", async (t) => {
  const pending = deferred();
  const h = harness(t, { factory: () => pending.promise });
  await settle();
  assert.equal(exportAction(h.runtime, h.catalog.instances).state, "queued");
  h.window.emit("pagehide");
  assert.equal(h.instances[0].flushes, 0);
  pending.resolve(h.instances[0]);
  await settle();
  assert.equal(h.instances[0].rows.length, 0);
  assert.equal(selection(h.runtime).state, "submitted");
  assert.equal(h.instances[0].flushes, 1);
  h.window.emit("pagehide");
  assert.equal(h.instances[0].flushes, 2);
  h.runtime.dispose();
  assert.equal(h.instances[0].disposals, 1);
  assert.equal(h.instances[0].context.canSend(), false);
  assert.equal(selection(h.runtime).state, "dropped");
  h.window.emit("pagehide");
  assert.equal(h.instances[0].flushes, 2);
});

test("storage, broadcast and visibility events introduce no consent gates or telemetry storage", async (t) => {
  const h = harness(t);
  await settle();
  h.window.emit("storage", { key: "unrelated-setting", newValue: "false" });
  h.window.emit("message", { data: "deny" });
  h.document.visibilityState = "hidden";
  h.document.emit("visibilitychange");
  assert.equal(h.runtime.status, "ready");
  assert.equal(selection(h.runtime).state, "submitted");
  assert.deepEqual(h.accesses, []);
});

test("synchronous and asynchronous SDK failures drop queued actions without leaking exceptions", async (t) => {
  for (const factory of [
    () => { throw new Error("SECRET https://url/?token=secret"); },
    async () => { throw new Error("SECRET https://url/?token=secret"); },
  ]) {
    const h = harness(t, { factory });
    exportAction(h.runtime, h.catalog.instances);
    await settle();
    assert.equal(h.runtime.status, "unavailable");
    assert.equal(h.instances[0].context.canSend(), false);
    assert.equal(selection(h.runtime).state, "dropped");
    assert.equal(exportAction(h.runtime, h.catalog.instances).state, "dropped");
    assert.equal(h.instances[0].rows.length, 0);
    assert.equal(h.time.pending, 0);
    assert.doesNotMatch(JSON.stringify(h.diagnostics), /SECRET|https:|token/);
    assert.deepEqual(h.accesses, []);
  }
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
  h.runtime.dispose();
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

test("SDK network rejection is best-effort and disposal prevents later retry initiation", async () => {
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

test("SDK transport rechecks canSend on every retry, scrubs excluded SDK tags and has no sync-XHR fallback", async () => {
  assert.throws(() => createTelemetrySDK({
    config: validateTelemetryConfig(config(), ORIGIN), canSend: () => false, diagnostic() {}, window: {},
  }), /telemetry-unavailable/);
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
  assert.equal(requests.length, 1, "no new retry request after telemetry stops");
  assert.equal(sanitizeTelemetryEnvelope({ data: { baseType: "PageviewData" } }, "golden"), null);
  transport.close();
  const unsupported = createTelemetrySDK({ config: validateTelemetryConfig(config(), ORIGIN), canSend: () => true,
    diagnostic() {}, window: { fetch: async () => { throw new Error("must not dispatch navigation"); } } });
  unsupported.track("event_selected", {});
  unsupported.flushNavigation();
  unsupported.dispose();
});

test("Hugo flag matrix excludes disabled SDK and starts configured production telemetry without consent bundles", async (t) => {
  const root = fileURLToPath(new URL("../", import.meta.url));
  const fixture = `${root}tests/.telemetry-fixture-${process.pid}-${randomUUID()}`;
  await mkdir(`${fixture}/layouts/partials`, { recursive: true });
  await mkdir(`${fixture}/assets/js`, { recursive: true });
  t.after(() => rm(fixture, { recursive: true, force: true }));
  await copyFile(`${root}layouts/partials/telemetry-config.html`, `${fixture}/layouts/partials/telemetry-config.html`);
  for (const name of ["telemetry.js", "telemetry-sdk.js"]) {
    await copyFile(`${root}assets/js/${name}`, `${fixture}/assets/js/${name}`);
  }
  await symlink(`${root}node_modules`, `${fixture}/node_modules`, "dir");
  await writeFile(`${fixture}/hugo.toml`, 'baseURL = "https://guide.example/repo/"\ndisableKinds = ["taxonomy", "term", "RSS", "sitemap"]\n');
  await writeFile(`${fixture}/assets/js/entry.js`, 'import {initializeTelemetry} from "./telemetry.js"; globalThis.guideTelemetry=initializeTelemetry();');
  await writeFile(`${fixture}/layouts/index.html`, `{{ $t := partial "telemetry-config.html" . }}{{ $t.config | jsonify | safeHTML }}
{{ $js := resources.Get "js/entry.js" | js.Build (dict "targetPath" "guide.js" "minify" true "defines" (dict "__TELEMETRY_ENABLED__" (cond $t.enabled "true" "false"))) }}{{ $js.RelPermalink }}`);
  const clean = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("HUGO_TELEMETRY_")));
  function build(env = {}) {
    return spawnSync("hugo", ["--source", fixture, "--destination", `${fixture}/output`, "--noBuildLock"], {
      encoding: "utf8", env: { ...clean, ...env }, timeout: 30000,
    });
  }
  const valid = { HUGO_TELEMETRY_ENABLED: "true", HUGO_TELEMETRY_ENV: "test",
    HUGO_TELEMETRY_CONNECTION_STRING: CONNECTION };
  for (const env of [{}, { HUGO_TELEMETRY_ENABLED: "false" },
    { ...valid, HUGO_TELEMETRY_ENABLED: "false" }]) {
    const result = build(env);
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
    { ...valid, HUGO_TELEMETRY_ORIGIN: "http://unapproved.example" },
    { ...valid, HUGO_TELEMETRY_ORIGIN: "https://guide.example/path" },
    { ...valid, HUGO_TELEMETRY_BUILD_ID: "not safe" },
  ]) {
    const result = build(env);
    assert.notEqual(result.status, 0, `must reject ${JSON.stringify(env)}`);
  }
  const enabled = build(valid);
  assert.equal(enabled.status, 0, enabled.stdout + enabled.stderr);
  const testJS = await readFile(`${fixture}/output/guide.js`, "utf8");
  assert.match(testJS, /AppInsightsCore/);
  assert.doesNotMatch(testJS, /wcpstatic|WcpConsent|cookie-banner|privacy-settings|TEST analytics|consentMode|consentProvider|openPrivacySettings/);
  const production = build({ ...valid, HUGO_TELEMETRY_ENV: "production" });
  assert.equal(production.status, 0, production.stdout + production.stderr);
  const productionJS = await readFile(`${fixture}/output/guide.js`, "utf8");
  const productionHTML = await readFile(`${fixture}/output/index.html`, "utf8");
  assert.match(productionHTML, /"enabled":true/);
  assert.match(productionHTML, /"environment":"production"/);
  assert.match(productionJS, /AppInsightsCore/);
  assert.doesNotMatch(productionHTML + productionJS,
    /wcpstatic|WcpConsent|cookie-banner|privacy-settings|TEST analytics|consentMode|consentProvider|openPrivacySettings|PRODUCTION_APPROVED|__TELEMETRY_TEST__/);
});
