// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT license.

const WCP_SCRIPT = "https://wcpstatic.microsoft.com/mscc/lib/v2/wcp-consent.js";

export function createWcpConsentProvider({ window, document, timeout = 10000,
  setTimeout = globalThis.setTimeout, clearTimeout = globalThis.clearTimeout }) {
  let manager;
  let disposed = false;
  let failed = false;
  let script;
  let timer;
  let cancelStart;
  const subscribers = new Set();
  function getConsent() {
    if (disposed || failed || !manager || manager.isConsentRequired !== true) return null;
    // WCP's no-consent-required/NR result is not a classification approval.
    const value = manager.getConsentFor(window.WcpConsent.consentCategories.Analytics);
    return typeof value === "boolean" ? value : null;
  }
  function publish() {
    let value = null;
    try { value = getConsent(); } catch { failed = true; }
    subscribers.forEach((callback) => callback(value));
  }
  return {
    getConsent,
    subscribe(callback) { subscribers.add(callback); return () => subscribers.delete(callback); },
    start() {
      return new Promise((resolve, reject) => {
        let settled = false;
        function finish(error) {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          cancelStart = undefined;
          if (error) { failed = true; publish(); reject(new Error("wcp-unavailable")); }
          else { publish(); resolve(); }
        }
        cancelStart = () => finish(new Error("disposed"));
        function initialize() {
          if (disposed || settled) return;
          try {
            const wcp = window?.WcpConsent;
            const banner = document?.getElementById("cookie-banner");
            if (!wcp?.init || !wcp.consentCategories?.Analytics || !banner) throw new Error("unsupported-wcp");
            wcp.init("en-US", banner, (error, consent) => {
              if (settled || disposed) return;
              if (error || consent?.isConsentRequired !== true ||
                  typeof consent.getConsentFor !== "function" || typeof consent.manageConsent !== "function") {
                finish(new Error("wcp-classification-unavailable"));
                return;
              }
              manager = consent;
              finish();
            }, () => { if (!disposed && !failed) publish(); });
          } catch { finish(new Error("wcp-unavailable")); }
        }
        timer = setTimeout(() => finish(new Error("wcp-timeout")), timeout);
        if (window?.WcpConsent) initialize();
        else {
          script = document?.createElement("script");
          if (!script || !document?.head) { finish(new Error("document-unavailable")); return; }
          script.src = WCP_SCRIPT;
          script.async = true;
          script.referrerPolicy = "no-referrer";
          script.onload = initialize;
          script.onerror = () => finish(new Error("wcp-blocked"));
          document.head.append(script);
        }
      });
    },
    openPrivacySettings() {
      if (disposed || failed || !manager || manager.isConsentRequired !== true) return false;
      manager.manageConsent();
      return true;
    },
    get canOpenPrivacySettings() { return !disposed && !failed && manager?.isConsentRequired === true; },
    dispose() {
      disposed = true;
      clearTimeout(timer);
      cancelStart?.();
      subscribers.clear();
      if (script) { script.onload = null; script.onerror = null; script.remove(); }
      manager = undefined;
    },
  };
}
