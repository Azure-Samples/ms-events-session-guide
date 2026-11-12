// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT license.

import { AppInsightsCore, Sender } from "@microsoft/applicationinsights-web-basic";

const TAGS = new Set(["ai.application.ver", "ai.internal.sdkVersion", "ai.location.ip"]);
const COMMON_PROPERTIES = ["schemaVersion", "buildId", "catalogVersion", "environment", "eventId", "source", "actionId"];
const COMPOSITION_PROPERTIES = ["composition", "partIndex", "partCount", "itemsInPart",
  "totalItemCount", "knownItemCount", "unknownItemCount"];
const EVENT_PROPERTIES = Object.freeze({
  event_selected: [],
  session_opened: ["sessionId"],
  calendar_export_requested: [...COMPOSITION_PROPERTIES, "exportedCount", "skippedCount", "conflictCount"],
  custom_guide_created: [...COMPOSITION_PROPERTIES, "sessionCount", "shareVersion"],
  shared_guide_opened: ["sessionCount", "shareVersion"],
  catalog_zero_results: ["facetNames", "facetCount"],
});

// This final boundary also rejects any unexpected SDK-generated telemetry type.
export function sanitizeTelemetryEnvelope(envelope, buildId) {
  if (envelope?.data?.baseType !== "EventData") return null;
  const event = envelope.data.baseData;
  if (!Object.hasOwn(EVENT_PROPERTIES, event?.name)) return null;
  const allowedProperties = new Set([...COMMON_PROPERTIES, ...EVENT_PROPERTIES[event.name]]);
  const properties = {};
  for (const [key, value] of Object.entries(event.properties ?? {})) {
    if (allowedProperties.has(key) && ["string", "number", "boolean"].includes(typeof value)) properties[key] = value;
  }
  const tags = {};
  for (const [key, value] of Object.entries(envelope.tags ?? {})) {
    if (TAGS.has(key) && typeof value === "string") tags[key] = value;
  }
  tags["ai.application.ver"] = buildId;
  // An explicit override is a suppression candidate, not proof about ingested enrichment.
  tags["ai.location.ip"] = "0.0.0.0";
  return {
    ver: envelope.ver, name: envelope.name, time: envelope.time, sampleRate: 100, iKey: envelope.iKey,
    tags, data: { baseType: "EventData", baseData: { ver: 2, name: event.name, properties } },
  };
}

export function createTelemetryTransport({ config, canSend, diagnostic, window }) {
  const fetch = window?.fetch?.bind(window);
  const Request = window?.Request;
  const unloadSupported = Boolean(fetch && Request && "keepalive" in Request.prototype);
  let closed = false;
  return {
    unloadSupported,
    close() { closed = true; },
    sendPOST(payload, complete, sync = false) {
      if (closed || !canSend() || !fetch) { complete(0, {}); return; }
      let body;
      try {
        const parsed = JSON.parse(payload.data);
        if (!Array.isArray(parsed)) throw new Error("invalid-sdk-batch");
        const envelopes = parsed.map((item) => sanitizeTelemetryEnvelope(item, config.buildId));
        if (envelopes.some((item) => item === null)) throw new Error("unexpected-sdk-event");
        body = JSON.stringify(envelopes);
      } catch {
        diagnostic("invalid-sdk-envelope");
        complete(400, {});
        return;
      }
      if (closed || !canSend()) { complete(0, {}); return; }
      // Fetch keepalive is the supported unload-safe path; never use sync XHR.
      // Small batches stay under the browser's 64 KiB keepalive budget.
      const keepalive = sync && unloadSupported && new TextEncoder().encode(body).length <= 60000;
      if (sync && !keepalive) { diagnostic("navigation-transport-unavailable"); complete(0, {}); return; }
      try {
        const request = fetch(config.endpointUrl, {
          method: "POST", body, headers: { "Content-Type": "application/json" },
          credentials: "omit", referrerPolicy: "no-referrer", cache: "no-store",
          mode: "cors", keepalive,
        });
        Promise.resolve(request).then(async (response) => {
          let result = "";
          try { if (typeof response.text === "function") result = await response.text(); }
          catch { diagnostic("transport-response-unavailable"); }
          if (!closed) complete(response.status, {}, result);
        }, () => {
          diagnostic("transport-unavailable");
          if (!closed) complete(0, {});
        });
      } catch {
        diagnostic("transport-unavailable");
        complete(0, {});
      }
    },
  };
}

export function createTelemetrySDK({ config, canSend, diagnostic, window }) {
  if (!canSend()) throw new Error("telemetry-unavailable");
  const core = new AppInsightsCore();
  const sender = new Sender();
  const transport = createTelemetryTransport({ config, canSend, diagnostic, window });
  let closed = false;
  core.initialize({
    instrumentationKey: config.instrumentationKey, endpointUrl: config.endpointUrl,
    cookieCfg: { enabled: false }, disableCookiesUsage: true,
    isStorageUseDisabled: true, enableSessionStorageBuffer: false,
    loggingLevelConsole: 0, loggingLevelTelemetry: 0, disableDbgExt: true,
    enableDebug: false, enablePerfMgr: false, samplingPercentage: 100,
    disableExceptionTracking: true, disableAjaxTracking: true, disableFetchTracking: true,
    enableAutoRouteTracking: false, autoTrackPageVisitTime: false,
    disableTelemetry: false, maxBatchSizeInBytes: 24000, maxBatchInterval: 1000,
    eventsLimitInMem: 4096, isRetryDisabled: false, maxRetryCnt: 2,
    httpXHROverride: transport, alwaysUseXhrOverride: true, enableSendPromise: false,
    onunloadDisableBeacon: true, onunloadDisableFetch: false, disableXhr: true,
    customHeaders: [], disableInstrumentationKeyValidation: false,
  }, [sender]);
  core.stopPollingInternalLogs();
  core.addTelemetryInitializer((item) => {
    if (closed || !canSend() || item.baseType !== "EventData") return false;
    item.ext = {};
    item.tags = { "ai.application.ver": config.buildId, "ai.location.ip": "0.0.0.0" };
    item.data = {};
    return true;
  });
  return {
    track(name, properties) {
      if (closed || !canSend()) return false;
      if (name === "event_selected" && !transport.unloadSupported) {
        diagnostic("navigation-transport-unavailable");
        return false;
      }
      core.track({ name: "Microsoft.ApplicationInsights.{0}.Event", baseType: "EventData",
        baseData: { ver: 2, name, properties: { ...properties } } });
      return true;
    },
    flushNavigation() {
      if (!closed && canSend() && transport.unloadSupported) sender.onunloadFlush();
    },
    dispose() {
      if (closed) return;
      closed = true;
      transport.close();
      // pause() is public and suppresses both core.unload's flush and sender teardown's flush.
      // Synchronous unload destroys the memory-only buffer; no private _buffer access.
      sender.pause();
      core.unload(false);
    },
  };
}
