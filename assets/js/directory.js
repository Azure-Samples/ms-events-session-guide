// Copyright (c) Microsoft Corporation. Licensed under the MIT license.
// Event directory: progressive search, runtime highlights and status labels,
// explicit and legacy root-link routing, and observed event-selection telemetry.
// Without JavaScript the page remains a static list of event links.

import {
  STATUS_LABELS, eventStatus, legacyRouteKind, resolveLegacyRoute, searchEvents, selectHighlights,
  validateManifest, wireEventLinks, preserveThemeForSiteLinks,
} from "./events.js";
import { decodeGuide, getGuideEventId } from "./guides.js";
import { LEGACY_EVENT_ID } from "./event-context.js";
import { initializeTelemetry } from "./telemetry.js";

const $ = (id) => document.getElementById(id);
let telemetry;

function setupTheme() {
  const button = $("theme-toggle");
  const label = () => button.setAttribute("aria-label",
    `Switch to ${document.documentElement.dataset.theme === "dark" ? "light" : "dark"} theme`);
  label();
  preserveThemeForSiteLinks(document.body, location);
  button.addEventListener("click", () => {
    const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    const url = new URL(location.href);
    url.searchParams.set("scoutTheme", next);
    history.replaceState(history.state, "", url);
    preserveThemeForSiteLinks(document.body, location);
    label();
  });
}

async function loadManifest() {
  const response = await fetch(document.body.dataset.events);
  if (!response.ok) throw new Error(`The event directory request returned HTTP ${response.status}.`);
  return validateManifest(await response.json());
}

function showRouteError(message) {
  $("route-status").hidden = true;
  $("route-error-message").textContent = message;
  $("route-error").hidden = false;
  $("route-error").focus();
}

// Returns true when the page is navigating away to an event. Invalid links
// show a visible error and leave the directory usable; nothing is stored.
async function bridgeEventLink(manifestPromise) {
  if (!legacyRouteKind(location.search, location.hash)) return false;
  let result;
  try {
    result = await resolveLegacyRoute(location, (await manifestPromise).events, {
      decodeGuide, getGuideEventId, legacyEventId: LEGACY_EVENT_ID,
    });
  } catch (error) {
    showRouteError(`${error.message} Reload the page to try again.`);
    return false;
  }
  if (result.type === "error") {
    showRouteError(result.message);
    return false;
  }
  if (result.type !== "redirect") return false;
  $("route-status").textContent = `Opening ${result.event.name}…`;
  $("route-status").hidden = false;
  location.replace(result.url);
  return true;
}

function cardFor(id) {
  return document.querySelector(`#event-list [data-event-card][data-event-id="${CSS.escape(id)}"]`);
}

function applyStatuses(events, now) {
  for (const event of events) {
    const badge = cardFor(event.id)?.querySelector("[data-event-status]");
    if (!badge) continue;
    const status = eventStatus(event, now);
    badge.textContent = STATUS_LABELS[status];
    badge.classList.toggle("badge-accent", status !== "past");
    badge.hidden = false;
  }
}

function renderHighlights(events, now) {
  const highlights = selectHighlights(events, now);
  const items = highlights.map(({ event }) => {
    const card = cardFor(event.id)?.cloneNode(true);
    if (!card) return null;
    card.removeAttribute("data-event-card");
    card.removeAttribute("hidden");
    return card;
  }).filter(Boolean);
  $("highlights-list").replaceChildren(...items);
  $("highlights-list").hidden = items.length === 0;
  $("highlights-empty").hidden = items.length !== 0;
  $("highlights").hidden = false;
}

function setupSearch(events) {
  const input = $("event-query");
  const render = () => {
    const matches = new Set(searchEvents(events, input.value).map((event) => event.id));
    for (const event of events) {
      const card = cardFor(event.id);
      if (card) card.hidden = !matches.has(event.id);
    }
    const query = input.value.trim();
    $("event-empty").hidden = matches.size !== 0;
    $("event-search-clear").hidden = !query;
    $("event-results").textContent = query ?
      `${matches.size} of ${events.length} event${events.length === 1 ? "" : "s"} match.` :
      `${events.length} event${events.length === 1 ? "" : "s"}.`;
  };
  const reset = () => {
    input.value = "";
    render();
    input.focus();
  };
  $("event-search").addEventListener("submit", (event) => event.preventDefault());
  input.addEventListener("input", render);
  $("event-search-clear").addEventListener("click", reset);
  $("event-empty-reset").addEventListener("click", reset);
  $("event-search").hidden = false;
  render();
}

async function main() {
  setupTheme();
  wireEventLinks(document.body, () => telemetry);
  const manifestPromise = loadManifest();
  if (await bridgeEventLink(manifestPromise)) return;
  let manifest;
  try {
    manifest = await manifestPromise;
  } catch (error) {
    showRouteError(`Event search and live highlights could not be loaded: ${error.message} The static event links below remain available.`);
    return;
  }
  const now = new Date();
  applyStatuses(manifest.events, now);
  renderHighlights(manifest.events, now);
  setupSearch(manifest.events);
  preserveThemeForSiteLinks(document.body, location);
  try {
    telemetry = initializeTelemetry({ events: manifest.events });
  } catch (error) {
    telemetry = undefined;
    console.warn("Optional analytics could not initialize.", error.name);
  }
}

main();
