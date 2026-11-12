// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT license.

export const COMPOSITION_BYTES = 6000;
export const STARTUP_LIMITS = Object.freeze({ actions: 32, bytes: 262144, milliseconds: 10000 });
const SCHEMA_VERSION = "1";
const SOURCES = Object.freeze({
  event_selected: ["directory", "switcher"],
  session_opened: ["catalog", "session", "path", "draft", "custom", "shared", "agenda"],
  calendar_export_requested: ["catalog", "session", "path", "draft", "custom", "shared", "agenda"],
  custom_guide_created: ["custom"],
  shared_guide_opened: ["shared"],
  catalog_zero_results: ["catalog"],
});
const FACETS = new Set(["search", "q", "topic", "type", "level", "delivery", "day", "path"]);
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;
const WITHDRAWAL_KEY = "ms-events-guide:telemetry-withdrawal";
const bytes = (value) => new TextEncoder().encode(value).length;
const count = (value) => Number.isSafeInteger(value) && value >= 0 && value <= 1000000;

export function parseTelemetryConnectionString(value) {
  if (typeof value !== "string" || value.length > 4096) throw new Error("invalid-connection-string");
  const fields = new Map();
  for (const pair of value.split(";").filter(Boolean)) {
    const index = pair.indexOf("=");
    const key = pair.slice(0, index).toLowerCase();
    const item = pair.slice(index + 1);
    if (index < 1 || fields.has(key) || !item || item.trim() !== item) throw new Error("invalid-connection-string");
    fields.set(key, item);
  }
  const allowed = new Set(["instrumentationkey", "ingestionendpoint", "liveendpoint", "applicationid"]);
  if ([...fields.keys()].some((key) => !allowed.has(key)) ||
      !GUID.test(fields.get("instrumentationkey") || "") ||
      (fields.has("applicationid") && !GUID.test(fields.get("applicationid")))) {
    throw new Error("invalid-connection-string");
  }
  function endpoint(value, live = false) {
    const url = new URL(value);
    const suffix = live ? /\.livediagnostics\.monitor\.azure\.com$/ : /\.in\.applicationinsights\.azure\.com$/;
    if (url.protocol !== "https:" || url.port || url.username || url.password ||
        url.search || url.hash || url.pathname !== "/" ||
        !/^[a-z0-9.-]+$/.test(url.hostname) || !suffix.test(url.hostname)) {
      throw new Error("invalid-ingestion-endpoint");
    }
    return url.origin;
  }
  const ingestion = endpoint(fields.get("ingestionendpoint"));
  if (fields.has("liveendpoint")) endpoint(fields.get("liveendpoint"), true);
  return Object.freeze({ instrumentationKey: fields.get("instrumentationkey").toLowerCase(), endpointUrl: `${ingestion}/v2/track` });
}

export function validateTelemetryConfig(config, currentOrigin) {
  if (!config || config.enabled !== true) return Object.freeze({ enabled: false });
  if (!["production", "test"].includes(config.environment) ||
      typeof config.buildId !== "string" || !/^[A-Za-z0-9._:-]{1,100}$/.test(config.buildId)) {
    throw new Error("invalid-telemetry-config");
  }
  const approved = new URL(config.origin);
  const local = approved.hostname === "localhost" || approved.hostname === "127.0.0.1" || approved.hostname === "[::1]";
  if (approved.origin !== config.origin || approved.username || approved.password ||
      (approved.protocol !== "https:" && !(config.environment === "test" && local && approved.protocol === "http:")) ||
      (config.environment === "production" && local) || currentOrigin !== approved.origin) {
    throw new Error("unapproved-origin");
  }
  if (!["wcp", "test"].includes(config.consentMode) ||
      (config.consentMode === "test" && config.environment !== "test")) throw new Error("invalid-consent-mode");
  return Object.freeze({ ...parseTelemetryConnectionString(config.connectionString),
    enabled: true, environment: config.environment, buildId: config.buildId, origin: config.origin,
    consentMode: config.consentMode });
}

export function splitTelemetryComposition(instances, catalog, eventId, maximumBytes = COMPOSITION_BYTES) {
  if (!Array.isArray(instances) || catalog?.event?.id !== eventId ||
      !(catalog.instanceById instanceof Map) || !(catalog.byId instanceof Map)) throw new Error("catalog-unavailable");
  const parts = [];
  let items = [];
  let size = 2;
  let knownItemCount = 0;
  instances.forEach((instance, position) => {
    const canonical = catalog.instanceById.get(instance?.id ?? instance?.occurrenceId);
    if (!canonical || canonical.sessionId !== instance?.sessionId || !catalog.byId.has(canonical.sessionId)) return;
    const item = { sessionId: canonical.sessionId, occurrenceId: canonical.id, position };
    const itemSize = bytes(JSON.stringify(item));
    if (itemSize + 2 > maximumBytes) throw new Error("composition-item-too-large");
    if (size + itemSize + (items.length ? 1 : 0) > maximumBytes) {
      parts.push(items);
      items = [];
      size = 2;
    }
    size += itemSize + (items.length ? 1 : 0);
    items.push(item);
    knownItemCount += 1;
  });
  if (items.length || !parts.length) parts.push(items);
  return Object.freeze({
    parts: Object.freeze(parts.map((part) => JSON.stringify(part))),
    totalItemCount: instances.length, knownItemCount, unknownItemCount: instances.length - knownItemCount,
  });
}

function propertiesFor(name, input, eventIds, catalog, config, actionId) {
  if (!Object.hasOwn(SOURCES, name) || !eventIds.has(input?.eventId)) throw new Error("invalid-event");
  const source = input.source ?? ({ shared_guide_opened: "shared", catalog_zero_results: "catalog" })[name];
  if (!SOURCES[name].includes(source)) throw new Error("invalid-source");
  const result = { schemaVersion: SCHEMA_VERSION, buildId: config.buildId, environment: config.environment,
    eventId: input.eventId, source, actionId };
  const version = catalog?.event?.id === input.eventId ? catalog.event.catalogVersion : undefined;
  if (typeof version === "string" && version.length <= 1000 && IDENTIFIER.test(version)) result.catalogVersion = version;
  if (name === "session_opened") {
    if (catalog?.event?.id !== input.eventId || !catalog.byId?.has(input.sessionId)) throw new Error("unknown-session");
    result.sessionId = input.sessionId;
  }
  if (name === "calendar_export_requested") {
    for (const key of ["exportedCount", "skippedCount", "conflictCount"]) {
      if (!count(input[key])) throw new Error("invalid-count");
      result[key] = input[key];
    }
  }
  if (name === "custom_guide_created" || name === "shared_guide_opened") {
    if (!count(input.sessionCount) || ![1, 2].includes(input.shareVersion)) throw new Error("invalid-guide-count");
    result.sessionCount = input.sessionCount;
    result.shareVersion = input.shareVersion;
  }
  if (name === "catalog_zero_results") {
    if (!Array.isArray(input.facetNames) || input.facetNames.some((facet) => !FACETS.has(facet))) throw new Error("invalid-facets");
    const facets = [...new Set(input.facetNames)].sort();
    result.facetNames = JSON.stringify(facets);
    result.facetCount = facets.length;
  }
  return result;
}

function readConfig(document) {
  const script = document?.getElementById("telemetry-config");
  if (!script) return { enabled: false };
  return JSON.parse(script.textContent);
}

function disabledFacade(state = "disabled") {
  return Object.freeze({
    track: () => ({ state: "dropped", reason: state }),
    trackComposition: () => ({ state: "dropped", reason: state }),
    setCatalog() {}, openPrivacySettings: () => false, dispose() {},
    get status() { return state; },
  });
}

export function initializeTelemetry(options = {}) {
  if (typeof __TELEMETRY_ENABLED__ === "undefined" || __TELEMETRY_ENABLED__) {
    return initializeEnabledTelemetry(options);
  }
  return disabledFacade();
}

function initializeEnabledTelemetry({ events = [], catalog = null, config, sdkFactory, consentProvider, platform = {} }) {
  const window = platform.window ?? globalThis.window;
  const document = platform.document ?? window?.document;
  const now = platform.now ?? Date.now;
  const schedule = platform.setTimeout ?? globalThis.setTimeout;
  const cancel = platform.clearTimeout ?? globalThis.clearTimeout;
  const uuid = platform.randomUUID ?? (() => globalThis.crypto.randomUUID());
  let settings;
  try { settings = validateTelemetryConfig(config ?? readConfig(document), window?.location?.origin); }
  catch { settings = null; }
  if (!settings?.enabled) {
    const status = document?.getElementById("telemetry-status");
    if (status) status.textContent = settings ? "Optional analytics disabled." : "Optional analytics unavailable: configuration error.";
    const button = document?.getElementById("privacy-settings");
    if (button) button.disabled = true;
    return disabledFacade(settings ? "disabled" : "configuration-error");
  }
  const eventIds = new Set(events.map((event) => event?.id).filter((id) => typeof id === "string" && IDENTIFIER.test(id)));
  let state = "waiting-for-consent";
  let generation = 0;
  let permitted = false;
  let closed = false;
  let sender = null;
  let provider = consentProvider;
  let unsubscribe;
  let channel;
  let queue = [];
  let queueBytes = 0;
  let queueTimer;
  let startupTimer;
  const privacyButton = document?.getElementById("privacy-settings");
  const cleanups = [];
  const diagnostics = new Set();
  function diagnostic(code) {
    if (diagnostics.has(code)) return;
    diagnostics.add(code);
    (platform.console ?? globalThis.console)?.warn?.(`[telemetry] ${code}`);
  }
  function updateStatus(next) {
    state = next;
    const element = document?.getElementById("telemetry-status");
    if (element) element.textContent = {
      "waiting-for-consent": "Optional analytics off until consent is available.",
      starting: "Optional analytics starting after consent.",
      ready: "Optional analytics enabled (best-effort delivery).",
      denied: "Optional analytics off.",
      unavailable: "Optional analytics unavailable. Your guide still works.",
      disposed: "Optional analytics off.",
    }[next];
    if (privacyButton) privacyButton.disabled = provider?.canOpenPrivacySettings === false || !provider?.openPrivacySettings;
  }
  function clearQueue() {
    queue = [];
    queueBytes = 0;
    cancel(queueTimer);
    queueTimer = undefined;
  }
  function stopSender(target) {
    if (!target) return;
    try { target.dispose(); } catch { diagnostic("sdk-dispose-failed"); }
  }
  function broadcastWithdrawal() {
    try { channel?.postMessage("withdraw"); } catch { diagnostic("withdrawal-broadcast-unavailable"); }
    try { window?.localStorage?.setItem(WITHDRAWAL_KEY, uuid()); } catch { diagnostic("withdrawal-storage-unavailable"); }
  }
  function withdraw({ broadcast = false, unavailable = false, waitingForConsent = false } = {}) {
    permitted = false;
    generation += 1;
    clearQueue();
    cancel(startupTimer);
    const previous = sender;
    sender = null;
    stopSender(previous);
    updateStatus(unavailable ? "unavailable" : waitingForConsent ? "waiting-for-consent" : "denied");
    if (broadcast) broadcastWithdrawal();
  }
  function consentStillValid() {
    if (closed || !permitted) return false;
    let value;
    try { value = provider?.getConsent(); }
    catch {
      diagnostic("consent-read-failed");
      withdraw({ broadcast: true, unavailable: true });
      return false;
    }
    if (value !== true) withdraw({ broadcast: true, waitingForConsent: value == null });
    return value === true;
  }
  function sendAction(action) {
    if (!sender || action.generation !== generation || !consentStillValid()) return { state: "dropped", reason: "consent-unavailable" };
    try {
      for (const row of action.rows) {
        if (!consentStillValid()) return { state: "dropped", reason: "consent-withdrawn" };
        if (sender.track(row.name, row.properties) === false) return { state: "dropped", reason: "transport-unavailable" };
      }
      if (action.navigation) sender.flushNavigation();
      return { state: "submitted" };
    } catch {
      diagnostic("sdk-dispatch-failed");
      withdraw({ unavailable: true });
      return { state: "dropped", reason: "sdk-unavailable" };
    }
  }
  function expireQueue() {
    cancel(queueTimer);
    queueTimer = undefined;
    const cutoff = now() - STARTUP_LIMITS.milliseconds;
    while (queue.length && queue[0].created <= cutoff) {
      queueBytes -= queue.shift().bytes;
      diagnostic("startup-action-expired");
    }
    if (queue.length) queueTimer = schedule(expireQueue, Math.max(1, queue[0].created + STARTUP_LIMITS.milliseconds - now()));
  }
  function acceptAction(rows, navigation) {
    const action = { rows, navigation, generation, created: now(), bytes: bytes(JSON.stringify(rows)) };
    if (sender) return sendAction(action);
    // A native link must never wait for the SDK or be replayed on another page.
    if (navigation || state !== "starting") return { state: "dropped", reason: "sdk-unready" };
    expireQueue();
    cancel(queueTimer);
    if (queue.length >= STARTUP_LIMITS.actions || queueBytes + action.bytes > STARTUP_LIMITS.bytes) {
      diagnostic("startup-action-capacity");
      if (queue.length) queueTimer = schedule(expireQueue, Math.max(1, queue[0].created + STARTUP_LIMITS.milliseconds - now()));
      return { state: "dropped", reason: "startup-capacity" };
    }
    queue.push(action);
    queueBytes += action.bytes;
    queueTimer = schedule(expireQueue, Math.max(1, queue[0].created + STARTUP_LIMITS.milliseconds - now()));
    return { state: "queued" };
  }
  async function defaultFactory(context) {
    if (typeof __TELEMETRY_ENABLED__ !== "undefined" && __TELEMETRY_ENABLED__) {
      const { createTelemetrySDK } = await import("./telemetry-sdk.js");
      return createTelemetrySDK(context);
    }
    throw new Error("sdk-not-compiled");
  }
  async function startSender() {
    if (closed || !permitted || sender || state === "starting") return;
    updateStatus("starting");
    const expected = generation;
    startupTimer = schedule(() => {
      if (generation === expected && state === "starting") {
        diagnostic("sdk-startup-timeout");
        withdraw({ unavailable: true });
      }
    }, STARTUP_LIMITS.milliseconds);
    try {
      const created = await (sdkFactory ?? defaultFactory)({
        config: settings, canSend: () => generation === expected && consentStillValid(),
        diagnostic, window, document,
      });
      if (!created || !["track", "flushNavigation", "dispose"].every((key) => typeof created[key] === "function")) {
        stopSender(created);
        throw new Error("unsupported-sdk");
      }
      if (closed || generation !== expected || !consentStillValid()) { stopSender(created); return; }
      cancel(startupTimer);
      sender = created;
      updateStatus("ready");
      expireQueue();
      const pending = queue;
      clearQueue();
      pending.forEach(sendAction);
    } catch {
      if (closed || generation !== expected) return;
      diagnostic("sdk-startup-failed");
      withdraw({ unavailable: true });
    }
  }
  function onConsent(value) {
    if (closed) return;
    if (value !== true) {
      withdraw({ broadcast: permitted, waitingForConsent: value == null });
      return;
    }
    if (!permitted) {
      permitted = true;
      generation += 1;
      startSender();
    }
  }
  function onVisibility() {
    if (document?.visibilityState !== "hidden" && permitted) consentStillValid();
  }
  function listen(target, event, handler) {
    target?.addEventListener?.(event, handler);
    cleanups.push(() => target?.removeEventListener?.(event, handler));
  }
  listen(document, "visibilitychange", onVisibility);
  listen(window, "storage", (event) => {
    if (event.key === WITHDRAWAL_KEY && event.newValue) withdraw();
    else if (permitted) consentStillValid();
  });
  listen(window, "pagehide", () => {
    if (consentStillValid()) {
      try { sender?.flushNavigation(); } catch { diagnostic("navigation-flush-failed"); }
    }
    clearQueue();
  });
  const Channel = platform.BroadcastChannel ?? window?.BroadcastChannel;
  try {
    if (Channel) {
      channel = new Channel("ms-events-guide:telemetry-consent");
      channel.onmessage = (event) => { if (event.data === "withdraw") withdraw(); };
    }
  } catch { diagnostic("withdrawal-channel-unavailable"); }
  async function startConsent() {
    try {
      if (!provider) {
        if (settings.consentMode === "test") {
          if (typeof __TELEMETRY_TEST__ !== "undefined" && __TELEMETRY_TEST__) {
            const { createTestConsentProvider } = await import("./telemetry-test-consent.js");
            provider = createTestConsentProvider({ window, document });
          } else throw new Error("test-consent-not-compiled");
        } else {
          const { createWcpConsentProvider } = await import("./telemetry-consent.js");
          provider = createWcpConsentProvider({ window, document });
        }
      }
      if (closed) { provider?.dispose?.(); return; }
      unsubscribe = provider.subscribe(onConsent);
      await provider.start?.();
      if (!closed) onConsent(provider.getConsent());
    } catch {
      if (!closed) {
        diagnostic("consent-startup-failed");
        withdraw({ unavailable: true });
      }
    }
  }
  function openPrivacySettings() {
    if (closed) return false;
    try {
      const opened = provider?.openPrivacySettings?.() === true;
      if (!opened && state !== "ready") updateStatus("unavailable");
      return opened;
    } catch {
      diagnostic("privacy-settings-unavailable");
      withdraw({ unavailable: true });
      return false;
    }
  }
  listen(privacyButton, "click", openPrivacySettings);
  updateStatus(state);
  startConsent();
  function capture(name, input, instances) {
    if (!consentStillValid()) return { state: "dropped", reason: "consent-unavailable" };
    try {
      const actionId = uuid();
      if (!GUID.test(actionId)) throw new Error("uuid-unavailable");
      const properties = propertiesFor(name, input, eventIds, catalog, settings, actionId);
      let rows;
      if (["calendar_export_requested", "custom_guide_created"].includes(name)) {
        const composition = splitTelemetryComposition(instances, catalog, input.eventId);
        if ((name === "calendar_export_requested" ? properties.exportedCount : properties.sessionCount) !== composition.totalItemCount) {
          throw new Error("composition-count-mismatch");
        }
        rows = composition.parts.map((compositionJSON, partIndex) => ({
          name, properties: Object.freeze({ ...properties, composition: compositionJSON, partIndex,
            partCount: composition.parts.length, itemsInPart: JSON.parse(compositionJSON).length,
            totalItemCount: composition.totalItemCount, knownItemCount: composition.knownItemCount,
            unknownItemCount: composition.unknownItemCount }),
        }));
      } else {
        if (instances !== undefined) throw new Error("unexpected-composition");
        rows = [{ name, properties: Object.freeze(properties) }];
      }
      return acceptAction(Object.freeze(rows), name === "event_selected");
    } catch (error) {
      const codes = new Set(["invalid-event", "invalid-source", "unknown-session", "invalid-count", "invalid-guide-count",
        "invalid-facets", "catalog-unavailable", "composition-item-too-large", "composition-count-mismatch", "unexpected-composition"]);
      const code = codes.has(error?.message) ? error.message : "invalid-action";
      diagnostic(code);
      return { state: "dropped", reason: code };
    }
  }
  return Object.freeze({
    track: (name, input = {}) => capture(name, input),
    trackComposition: (name, instances, input = {}) => capture(name, input, instances),
    setCatalog(value) { catalog = value; },
    openPrivacySettings,
    dispose() {
      if (closed) return;
      closed = true;
      withdraw();
      unsubscribe?.();
      try { provider?.dispose?.(); } catch { diagnostic("consent-dispose-failed"); }
      channel?.close?.();
      cleanups.forEach((cleanup) => cleanup());
      updateStatus("disposed");
    },
    get status() { return state; },
  });
}
