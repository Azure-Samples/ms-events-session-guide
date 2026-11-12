// Copyright (c) Microsoft Corporation. Licensed under the MIT license.
// Pure helpers for event discovery: metadata validation, event-local status,
// highlights, search, and root-link routing. No DOM or storage access.

import { normalizeSearch } from "./catalog.js";
import { validateEvent } from "./event-context.js";

export const HIGHLIGHT_LIMIT = 3;
export const EVENT_SOURCES = Object.freeze(["directory", "switcher"]);

// Query parameters and hashes the single-event root page understood before
// multi-event support. Theme-only links (scoutTheme) intentionally stay on discovery.
export const LEGACY_QUERY_PARAMETERS = Object.freeze([
  "guide", "q", "topic", "type", "level", "delivery", "day", "path", "sort", "route", "audience", "tz",
]);
export const LEGACY_HASHES = Object.freeze(["guide", "catalog", "my-guide", "agenda"]);

function siteRelative(value, label) {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//") ||
      /[\x00-\x20\\]/.test(value)) {
    throw new Error(`${label} must be a site-relative path.`);
  }
  return value;
}

export function validateManifestEvent(input) {
  const event = validateEvent(input);
  const keywords = input.keywords ?? [];
  if (!Array.isArray(keywords) || keywords.some((item) => typeof item !== "string" || !item.trim())) {
    throw new Error(`Event ${event.id} keywords must be a list of nonempty text values.`);
  }
  return Object.freeze({
    ...event,
    catalogAssetUrl: siteRelative(input.catalogAssetUrl, `Event ${event.id} catalog asset URL`),
    keywords: Object.freeze([...keywords]),
  });
}

export function validateManifest(manifest) {
  if (!manifest || typeof manifest !== "object" || manifest.version !== 1 || !Array.isArray(manifest.events)) {
    throw new Error("The event manifest has an unexpected shape. Rebuild the Hugo site.");
  }
  const ids = new Set();
  const events = manifest.events.map((input) => {
    const event = validateManifestEvent(input);
    if (ids.has(event.id)) throw new Error(`The event manifest lists ${event.id} more than once.`);
    ids.add(event.id);
    return event;
  });
  return Object.freeze({ version: 1, events: Object.freeze(events) });
}

const dayFormatters = new Map();

// The calendar date at `now` in the event's own time zone, as YYYY-MM-DD.
export function eventLocalDate(now, timeZone) {
  if (!dayFormatters.has(timeZone)) {
    dayFormatters.set(timeZone, new Intl.DateTimeFormat("en-US", {
      timeZone, year: "numeric", month: "2-digit", day: "2-digit", hourCycle: "h23",
    }));
  }
  const parts = dayFormatters.get(timeZone).formatToParts(now);
  const get = (type) => parts.find((part) => part.type === type).value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

// Dates are inclusive event-local calendar days, never UTC midnights.
export function eventStatus(event, now = new Date()) {
  const today = eventLocalDate(now, event.timeZone);
  if (today < event.startDate) return "upcoming";
  if (today > event.endDate) return "past";
  return "ongoing";
}

export const STATUS_LABELS = Object.freeze({
  ongoing: "Happening now", upcoming: "Upcoming", past: "Past event",
});

function byStartThenId(a, b) {
  return a.startDate === b.startDate ? (a.id < b.id ? -1 : a.id > b.id ? 1 : 0) :
    a.startDate < b.startDate ? -1 : 1;
}

// Ongoing events first, then upcoming; each ordered by start date then event ID.
// Returns only real events; never pads to the limit.
export function selectHighlights(events, now = new Date(), limit = HIGHLIGHT_LIMIT) {
  const withStatus = events.map((event) => ({ event, status: eventStatus(event, now) }));
  const group = (status) => withStatus.filter((item) => item.status === status)
    .sort((a, b) => byStartThenId(a.event, b.event));
  return [...group("ongoing"), ...group("upcoming")].slice(0, Math.max(0, limit));
}

export function eventSearchText(event) {
  return normalizeSearch([event.name, event.summary, event.id, ...(event.keywords || [])].join(" "));
}

// Accent- and case-insensitive; every word must match. Preserves input order.
export function searchEvents(events, query) {
  const words = normalizeSearch(query || "").split(/\s+/).filter(Boolean);
  if (!words.length) return [...events];
  return events.filter((event) => {
    const text = eventSearchText(event);
    return words.every((word) => text.includes(word));
  });
}

export function legacyRouteKind(search, hash) {
  const params = new URLSearchParams(search);
  if (params.has("guide")) return "guide";
  if (params.has("event")) return "event";
  if (LEGACY_QUERY_PARAMETERS.some((key) => params.has(key))) return "view";
  if (LEGACY_HASHES.includes(String(hash || "").replace(/^#/, ""))) return "view";
  return null;
}

// Builds the event URL while carrying the original query and hash verbatim:
// share tokens are never decoded and re-encoded during navigation.
export function eventDestination(eventUrl, origin, search, hash) {
  const target = new URL(siteRelative(eventUrl, "Event URL"), origin);
  return `${target.origin}${target.pathname}${search || ""}${hash || ""}`;
}

// Resolves an explicit event selector or a legacy root link. Version-1 guide tokens and
// pre-multi-event view links belong to the legacy event; every guide token
// (v1 included) is decoded and validated before its event identity is trusted.
export async function resolveLegacyRoute(location, events, {
  decodeGuide, getGuideEventId, legacyEventId,
}) {
  const kind = legacyRouteKind(location.search, location.hash);
  if (!kind) return { type: "none" };
  const params = new URLSearchParams(location.search);
  const requestedEvents = params.getAll("event");
  if (requestedEvents.length > 1 || (requestedEvents.length === 1 && !requestedEvents[0])) {
    return { type: "error", message: "Specify exactly one nonempty event ID in the event parameter." };
  }
  const requestedEvent = requestedEvents[0];
  let eventId = requestedEvent ?? legacyEventId;
  if (kind === "guide") {
    const token = params.get("guide");
    try {
      eventId = getGuideEventId(await decodeGuide(token));
    } catch (error) {
      return { type: "error", message: `This guide link is not valid: ${error.message}` };
    }
    if (requestedEvent && requestedEvent !== eventId) {
      return { type: "error", message: "The event parameter does not match this shared guide's event. Nothing was imported or saved." };
    }
  }
  const event = events.find((item) => item.id === eventId);
  if (!event) {
    return {
      type: "error",
      message: kind === "guide" ?
        "This guide belongs to an event that is not available on this site. Nothing was imported or saved." :
        "The event for this link is not available on this site.",
    };
  }
  return {
    type: "redirect",
    event,
    url: eventDestination(event.url, location.origin, location.search, location.hash),
  };
}

// Observes discovery/switcher selections without delaying native navigation.
export function wireEventLinks(root, getTelemetry) {
  const handler = (domEvent) => {
    if (domEvent.type === "auxclick" && domEvent.button !== 1) return;
    const link = domEvent.target.closest?.("a[data-event-id][data-event-source]");
    if (!link || !root.contains(link)) return;
    const source = link.dataset.eventSource;
    if (!EVENT_SOURCES.includes(source)) return;
    try {
      getTelemetry()?.track("event_selected", { eventId: link.dataset.eventId, source });
    } catch (error) {
      globalThis.console?.warn("Optional event-selection analytics is unavailable.", error?.name || "Error");
    }

  };
  root.addEventListener("click", handler);
  root.addEventListener("auxclick", handler);
  return () => {
    root.removeEventListener("click", handler);
    root.removeEventListener("auxclick", handler);
  };
}

export function preserveThemeForSiteLinks(root, location) {
  const theme = new URLSearchParams(location.search).get("scoutTheme");
  if (!["light", "dark"].includes(theme)) return;
  for (const link of root.querySelectorAll("a[href]")) {
    const href = link.getAttribute("href");
    if (!href || href.startsWith("#") || link.target === "_blank" || link.hasAttribute("download")) continue;
    const destination = new URL(href, location.href);
    if (destination.origin !== location.origin || !destination.pathname.endsWith("/")) continue;
    destination.searchParams.set("scoutTheme", theme);
    link.href = destination.href;
  }
}
