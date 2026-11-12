// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT license.

const KEY = "ms-events-guide:telemetry-test-consent";

export function createTestConsentProvider({ window, document }) {
  let choice = null;
  let storageUnavailable = false;
  const subscribers = new Set();
  const controls = [];
  function getConsent() {
    if (storageUnavailable) return choice;
    try {
      const stored = window.localStorage.getItem(KEY);
      return stored === "allow" ? true : stored === "reject" ? false : null;
    } catch { storageUnavailable = true; return choice; }
  }
  function select(value) {
    choice = value;
    try {
      if (value === null) window.localStorage.removeItem(KEY);
      else window.localStorage.setItem(KEY, value ? "allow" : "reject");
    } catch { storageUnavailable = true; }
    subscribers.forEach((callback) => callback(value));
  }
  function render() {
    const banner = document?.getElementById("cookie-banner");
    if (!banner || controls.length) return;
    const label = document.createElement("p");
    label.textContent = "TEST ONLY analytics consent — does not validate production WCP registration.";
    banner.append(label);
    controls.push(label);
    for (const [text, value] of [["Allow TEST analytics", true], ["Reject TEST analytics", false], ["Reset TEST consent", null]]) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = text;
      button.addEventListener("click", () => select(value));
      banner.append(button);
      controls.push(button);
    }
  }
  return {
    getConsent,
    subscribe(callback) { subscribers.add(callback); return () => subscribers.delete(callback); },
    start() { render(); },
    openPrivacySettings() {
      render();
      controls.find((element) => element.tagName === "BUTTON")?.focus();
      return controls.length > 0;
    },
    dispose() { controls.forEach((element) => element.remove()); subscribers.clear(); },
  };
}
