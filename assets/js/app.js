// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import {
  FILTER_DEFAULTS, createCatalog, filterCatalog, compareInstances, isScheduled,
  dateKey, getConflicts, readFilters, readViewState, writeFilters, restoreSaved, calendarExport,
  calendarSessions, normalizeSearch,
  getAudiencePaths, audienceRecommendations,
} from "./catalog.js";
import { GUIDE_LIMITS, snapshotSession, validateGuide, decodeGuide, createShareURL, getGuideEventId } from "./guides.js";
import { LEGACY_EVENT, LEGACY_EVENT_ID } from "./event-context.js";
import { eventStorageKeys, migrateLegacyStorage, withEventStorageLock, validateStoredDraft } from "./event-state.js";
import { initializeTelemetry } from "./telemetry.js";
import { eventRegistration, preserveThemeForSiteLinks, validateManifest, wireEventLinks, wireEventSwitcher } from "./events.js";

const $ = (id) => document.getElementById(id);
let storageKeys = eventStorageKeys(LEGACY_EVENT_ID);
const PAGE_SIZE = 9;
let catalog;
let events = [];
let telemetry;
let filters = readFilters(location.search);
let saved = new Set();
let draft = newDraft();
let sharedGuide = null;
let viewingShared = false;
let sharedViewRevision = 0;
let audience = "";
let activePath = "";
let zoneChoice = LEGACY_EVENT.timeZone;
let visibleCount = PAGE_SIZE;
let dialogContext = null;
let confirmCallback = null;
let toastTimer;
let shareRevision = 0;
let draftRevision = 0;
let initialized = false;
let storageNotices = [];
const unsavedStorageKeys = new Set();
const storageRevisions = new Map();

function newDraft() {
  const event = catalog?.event || LEGACY_EVENT;
  return {
    version: 2, eventId: event.id,
    title: `My ${event.name} guide`.slice(0, GUIDE_LIMITS.title), summary: "", steps: [],
  };
}

function node(tag, className = "", text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function icon(name) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.classList.add("icon");
  svg.setAttribute("aria-hidden", "true");
  const use = document.createElementNS(svg.namespaceURI, "use");
  use.setAttribute("href", `#i-${name}`);
  svg.append(use);
  return svg;
}

function button(text, className, action, iconName) {
  const element = node("button", className);
  element.type = "button";
  if (iconName) element.append(icon(iconName));
  element.append(document.createTextNode(text));
  element.addEventListener("click", action);
  return element;
}

function announce(message) {
  clearTimeout(toastTimer);
  $("toast").textContent = message;
  $("toast").hidden = false;
  toastTimer = setTimeout(() => { $("toast").hidden = true; }, 6500);
}

function guideMessage(message) {
  $("guide-message").textContent = message;
  $("guide-message").hidden = !message;
}

function storageWarning(message) {
  if (!storageNotices.includes(message)) storageNotices.push(message);
  $("storage-warning").textContent = storageNotices.join(" ");
  $("storage-warning").hidden = false;
  guideMessage(storageNotices.join(" "));
}

function storageRead(key) {
  try {
    return localStorage.getItem(key);
  } catch (error) {
    storageWarning(`Browser storage is unavailable (${error.name}). Keep a share link for your guide; agenda changes will last only until this page is closed.`);
    return null;
  }
}

function storageWrite(key, value) {
  const revision = (storageRevisions.get(key) || 0) + 1;
  storageRevisions.set(key, revision);
  unsavedStorageKeys.add(key);
  withEventStorageLock(catalog.event.id, () => localStorage.setItem(key, value), {
    onWarning: storageWarning,
  }).then(() => {
    if (storageRevisions.get(key) === revision) unsavedStorageKeys.delete(key);
  }, (error) => {
    storageWarning(`Your changes could not be saved in this browser (${error.name}). Copy a guide share link before leaving; the agenda is not persistent.`);
  });
}

function timeZone() {
  return zoneChoice === "local" ? Intl.DateTimeFormat().resolvedOptions().timeZone : zoneChoice;
}

function formatDate(value, options = {}) {
  return new Intl.DateTimeFormat("en-US", { timeZone: timeZone(), ...options }).format(new Date(value));
}

function shortTime(instance) {
  if (!isScheduled(instance)) return "Time not listed";
  return formatDate(instance.start, {
    weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short",
  });
}

function timeRange(instance) {
  if (!isScheduled(instance)) return "Time not listed";
  const crossesDay = dateKey(instance.start, timeZone()) !== dateKey(instance.end, timeZone());
  return `${formatDate(instance.start, { hour: "numeric", minute: "2-digit" })} - ${formatDate(instance.end, {
    hour: "numeric", minute: "2-digit", timeZoneName: "short",
    ...(crossesDay ? { month: "short", day: "numeric" } : {}),
  })}`;
}

function durationLabel(instance) {
  return instance.duration > 0 ? `${instance.duration} min` : "Duration not listed";
}

function sessionTime(instance) {
  const element = node("span", "session-time");
  element.append(icon("clock"), document.createTextNode(shortTime(instance)));
  return element;
}

function updateURL() {
  const url = writeFilters(location.href, filters);
  if (activePath === getAudiencePaths(catalog.paths, audience)[0].id) url.searchParams.delete("route");
  else url.searchParams.set("route", activePath);
  if (audience === catalog.audiences[0].id) url.searchParams.delete("audience");
  else url.searchParams.set("audience", audience);
  if (zoneChoice === catalog.event.timeZone) url.searchParams.delete("tz");
  else url.searchParams.set("tz", zoneChoice);
  history.replaceState(null, "", url);
}

async function copyText(text, onFailure) {
  try {
    await navigator.clipboard.writeText(text);
    announce("Link copied. Ready to share.");
  } catch {
    onFailure();
    announce("Clipboard access is unavailable. Select and copy the link manually.");
  }
}

function selectedInstances() {
  return [...saved].map((id) => catalog.instanceById.get(id)).filter(Boolean);
}

function pathInstances(path) {
  return path.steps.map((step) => catalog.byCode.get(step.code).instances[0]);
}

function downloadCalendar(instances, name, filename, source = "session") {
  const scheduled = calendarSessions(instances);
  if (!scheduled.length) {
    announce("No calendar file was created: these sessions have no listed start and end time.");
    return;
  }
  const slug = normalizeSearch(name).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80) || "guide";
  const blob = new Blob([calendarExport(scheduled, new Date(), name, catalog.event)], { type: "text/calendar;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = node("a");
  link.href = url;
  link.download = filename || `${catalog.event.id}-${slug}.ics`;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  const skipped = instances.filter((instance) => !isScheduled(instance)).length;
  const overlaps = getConflicts(scheduled).size;
  telemetry?.trackComposition("calendar_export_requested", scheduled, {
    eventId: catalog.event.id, source, exportedCount: scheduled.length,
    skippedCount: skipped, conflictCount: overlaps,
  });
  announce(`Calendar file ready: ${scheduled.length} session${scheduled.length === 1 ? "" : "s"}. If your browser downloads it, open the .ics file in your default calendar app and confirm the import.${skipped ? ` ${skipped} without times excluded.` : ""}${overlaps ? ` ${overlaps} overlapping sessions included.` : ""}`);
}

function calendarActions(instance, source = "session") {
  const actions = node("div", "calendar-actions");
  if (!isScheduled(instance)) {
    actions.append(node("span", "calendar-unavailable", "Calendar unavailable: time not listed"));
    return actions;
  }
  const download = button("Calendar (.ics)", "save-button calendar-download", () => downloadCalendar(
    [instance], `${instance.code} - ${instance.title}`, undefined, source,
  ), "calendar");
  download.setAttribute("aria-label", `Download calendar event for ${instance.code}, ${shortTime(instance)}`);
  download.title = "Open with your default calendar app, or download the .ics file";
  actions.append(download);
  return actions;
}

function sessionCalendarActions(session, source = "catalog") {
  if (session.instances.length === 1) return calendarActions(session.instances[0], source);
  const actions = node("div", "calendar-actions");
  if (!session.instances.some(isScheduled)) return calendarActions(session.instances[0], source);
  const choose = button("Choose calendar time", "save-button", () => openSession(session), "calendar");
  choose.setAttribute("aria-label", `Choose a calendar time for ${session.code}`);
  actions.append(choose);
  return actions;
}

function renderGuideCalendar(buttonId, helpId, instances) {
  const scheduled = calendarSessions(instances);
  const skipped = instances.filter((instance) => !isScheduled(instance)).length;
  const count = scheduled.length;
  $(buttonId).disabled = count === 0;
  $(buttonId).replaceChildren(icon("calendar"), document.createTextNode(
    count ? `Add all ${count} session${count === 1 ? "" : "s"} to calendar (.ics)` : "Add entire guide to calendar (.ics)",
  ));
  $(helpId).textContent = count ?
    `One .ics file with all ${count} scheduled session${count === 1 ? "" : "s"}; no agenda setup needed. Your browser may open it in your default calendar app or download it for you to open/import.${skipped ? ` ${skipped} without times excluded.` : ""}${getConflicts(scheduled).size ? " Overlapping sessions are included." : ""}` :
    "Add a session with a listed start and end time to enable calendar import.";
}

function persistAgenda() {
  storageWrite(storageKeys.agenda, JSON.stringify({ version: 1, ids: [...saved] }));
}

function refreshSavedViews() {
  renderAgenda();
  renderCatalog();
  renderPath();
}

function toggleSaved(instance) {
  const removed = saved.delete(instance.id);
  if (!removed) saved.add(instance.id);
  persistAgenda();
  refreshSavedViews();
  if (dialogContext) {
    renderDialog();
    const target = [...$("dialog-content").querySelectorAll("[data-save-instance]")]
      .find((element) => element.dataset.saveInstance === instance.id);
    target?.focus({ preventScroll: true });
  }
  const conflicts = getConflicts(selectedInstances());
  announce(removed ? "Removed from your agenda." : conflicts.has(instance.id) ?
    "Saved. This time overlaps another session in your agenda." : "Saved to your agenda. This is not a seat reservation.");
}

function addSessionsToAgenda(instances) {
  let added = 0;
  const sessionsAlreadySaved = new Set(selectedInstances().map((instance) => instance.sessionId));
  for (const instance of instances) {
    if (sessionsAlreadySaved.has(instance.sessionId)) continue;
    saved.add(instance.id);
    sessionsAlreadySaved.add(instance.sessionId);
    added++;
  }
  persistAgenda();
  refreshSavedViews();
  const conflicts = getConflicts(selectedInstances()).size;
  announce(`${added} session${added === 1 ? "" : "s"} added.${conflicts ? ` ${conflicts} saved sessions have overlapping times; review your agenda.` : " Review your agenda before attending."}`);
}

function saveButton(instance, label = "Save") {
  const isSaved = saved.has(instance.id);
  const element = button(isSaved ? "Saved" : label, "save-button", () => toggleSaved(instance), isSaved ? "check" : "bookmark");
  element.setAttribute("aria-pressed", String(isSaved));
  element.setAttribute("aria-label", `${isSaved ? "Remove" : "Save"} ${instance.code}, ${shortTime(instance)}`);
  element.dataset.saveInstance = instance.id;
  return element;
}

function renderPathOptions() {
  $("path-options").replaceChildren(...getAudiencePaths(catalog.paths, audience).map((path, index) => {
    const content = node("span");
    content.append(node("strong", "", path.name),
      node("small", "", path.fit));
    const element = button("", "path-option", () => {
      activePath = path.id;
      updateURL();
      renderPathOptions();
      renderPath();
      $("path-options").querySelector(`[data-path="${path.id}"]`)?.focus({ preventScroll: true });
    });
    element.dataset.path = path.id;
    element.dataset.pathAudience = path.audience;
    element.setAttribute("aria-pressed", String(path.id === activePath));
    element.append(node("span", "path-number", String(index + 1).padStart(2, "0")), content, icon("arrow-up"));
    return element;
  }));
}

function renderPath() {
  const path = catalog.paths.find((item) => item.id === activePath);
  for (const key of ["label", "headline", "description", "fit", "outcome"]) {
    $(`path-${key}`).textContent = path[key];
  }
  renderGuideCalendar("export-path", "path-calendar-help", pathInstances(path));
  $("path-calendar-help").append(document.createTextNode(" Uses each session's earliest listed occurrence."));
  $("path-steps").replaceChildren(...path.steps.map((step, index) => {
    const session = catalog.byCode.get(step.code);
    const item = node("li", "path-step");
    const card = node("article", "step-card");
    const kicker = node("p", "step-kicker");
    kicker.append(node("span", "", step.stage), node("span", "session-code", step.code));
    const title = node("h4");
    title.style.margin = "0";
    title.append(button(session.title, "step-title", () => openSession(session)));
    const bottom = node("div", "step-bottom");
    const isSaved = session.instances.some((instance) => saved.has(instance.id));
    bottom.append(sessionTime(session.instances[0]),
      button(isSaved ? "Saved to agenda" : "Session brief", "text-link", () => openSession(session), isSaved ? "check" : "arrow"));
    card.append(kicker, title, node("p", "step-why", step.why), bottom, sessionCalendarActions(session, "path"));
    item.append(node("span", "step-number", String(index + 1).padStart(2, "0")), card);
    return item;
  }));
}

function setupFilters() {
  const options = {
    topic: [...new Set(catalog.sessions.flatMap((session) => session.instances.flatMap((item) => item.topics)))].sort(),
    type: [...new Set(catalog.sessions.map((session) => session.type))].sort(),
    level: [...new Set(catalog.sessions.map((session) => session.level).filter(Boolean))].sort(),
    delivery: [...new Set(catalog.sessions.flatMap((session) => session.instances.flatMap((item) => item.delivery)))].sort(),
  };
  for (const [key, values] of Object.entries(options)) {
    for (const value of values) $(key).append(new Option(value, value));
  }
  setupDays();
}

function populatePathFilter() {
  $("path-filter").replaceChildren(new Option("All sessions", ""));
  for (const path of getAudiencePaths(catalog.paths, audience)) {
    $("path-filter").append(new Option(path.name, path.id));
  }
}

function setupDays() {
  const days = [...new Set([...catalog.instanceById.values()].filter(isScheduled)
    .map((instance) => dateKey(instance.start, timeZone())))].sort();
  $("day").replaceChildren(new Option("Any day", ""), new Option("Time not listed", "unscheduled"));
  for (const day of days) {
    const [year, month, date] = day.split("-").map(Number);
    const label = new Intl.DateTimeFormat("en-US", {
      timeZone: "UTC", weekday: "short", month: "short", day: "numeric",
    }).format(new Date(Date.UTC(year, month - 1, date)));
    $("day").append(new Option(label, day));
  }
}

function syncFilterInputs() {
  $("search").value = filters.q;
  for (const key of ["topic", "type", "level", "delivery", "day", "path", "sort"]) {
    const input = $(key === "path" ? "path-filter" : key);
    if (![...input.options].some((option) => option.value === filters[key])) {
      filters[key] = FILTER_DEFAULTS[key];
    }
    input.value = filters[key];
  }
}

function renderCatalog() {
  const focusKey = document.activeElement?.dataset.focusKey;
  const results = filterCatalog(catalog, filters, timeZone(), audience);
  const count = node("strong", "", results.length.toLocaleString());
  $("results-count").replaceChildren(count, document.createTextNode(
    ` of ${catalog.sessions.length.toLocaleString()} sessions${filters.path ? " in learning order (when using guide sort)" : " · repeat times grouped"}`));
  $("session-grid").replaceChildren(...results.slice(0, visibleCount).map(sessionCard));
  $("catalog-empty").hidden = results.length !== 0;
  $("load-more").hidden = results.length <= visibleCount;
  $("shown-count").textContent = results.length ? `Showing ${Math.min(visibleCount, results.length)} of ${results.length.toLocaleString()}` : "";
  if (focusKey) {
    [...$("session-grid").querySelectorAll("[data-focus-key]")]
      .find((element) => element.dataset.focusKey === focusKey)?.focus({ preventScroll: true });
  }
  return results.length;
}

function recordEmptyResults(count) {
  if (count !== 0) return;
  const facetNames = Object.keys(FILTER_DEFAULTS)
    .filter((key) => key !== "sort" && filters[key] !== FILTER_DEFAULTS[key])
    .map((key) => key === "q" ? "search" : key);
  telemetry?.track("catalog_zero_results", { eventId: catalog.event.id, facetNames });
}

function sessionCard(session) {
  const first = session.instances[0];
  const recommendations = audienceRecommendations(session, audience);
  const article = node("article", "session-card");
  const top = node("div", "card-top");
  top.append(node("span", "badge", first.type));
  if (recommendations.length) top.append(node("span", "badge badge-accent", "Guide pick"));
  top.append(node("span", "session-code", session.code));
  const title = node("h3", "card-title");
  title.append(button(session.title, "", () => openSession(session)));
  article.append(top, title, node("p", "card-description", session.description));
  const recommendation = recommendations.find((item) => item.path.id === filters.path) || recommendations[0];
  if (recommendation) {
    const payoff = node("div", "card-payoff");
    payoff.append(node("span", "", "TAKE THIS HOME"), node("p", "", recommendation.step.takeaway));
    article.append(payoff);
  }
  const meta = node("div", "card-meta");
  meta.append(sessionTime(first), node("p", "session-attributes", [
    durationLabel(first), first.level || "Level not listed",
    session.instances.length > 1 ? `${session.instances.length} matching times` : first.delivery.join(" + ") || "Attendance not listed",
  ].join(" · ")));
  const tags = node("div", "card-tags");
  tags.append(...first.topics.slice(0, 2).map((topic) => node("span", "topic-tag", topic)));
  const footer = node("div", "card-footer");
  const actions = node("div", "card-footer-actions");
  const full = catalog.byId.get(session.sessionId);
  const hasSaved = full.instances.some((instance) => saved.has(instance.id));
  const save = button(hasSaved ? "Saved" : "Save", "save-button", () => {
    if (session.instances.length > 1 || (hasSaved && !saved.has(first.id))) openSession(session);
    else toggleSaved(first);
  }, hasSaved ? "check" : "bookmark");
  save.setAttribute("aria-label", `${hasSaved ? "Manage saved times for" : "Save"} ${session.code}`);
  save.setAttribute("aria-pressed", String(hasSaved));
  save.dataset.focusKey = `catalog-save-${session.sessionId}`;
  const inGuide = draft.steps.some((step) => step.session.sessionId === session.sessionId);
  const add = button("", "save-button card-guide-button", () => addToDraft(first), inGuide ? "check" : "route");
  add.setAttribute("aria-label", inGuide ? `${session.code} is already in custom guide` : `Add ${session.code} to custom guide`);
  add.setAttribute("aria-pressed", String(inGuide));
  add.dataset.focusKey = `catalog-guide-${session.sessionId}`;
  add.title = inGuide ? "Already in your custom guide" : "Add to custom guide";
  actions.append(save, add);
  footer.append(button("Session brief", "text-link", () => openSession(session), "arrow"), actions);
  article.append(meta, tags, footer, sessionCalendarActions(session));
  return article;
}

function openSession(session, snapshot = false) {
  if (!snapshot) {
    telemetry?.track("session_opened", {
      eventId: catalog.event.id, sessionId: session.sessionId, source: "catalog",
    });
  }
  dialogContext = {
    session: snapshot ? { ...session, instances: [session], recommendations: [] } : catalog.byId.get(session.sessionId),
    snapshot,
    matchingIds: new Set(snapshot ? [session.id] : session.instances.map((instance) => instance.id)),
  };
  renderDialog();
  if (!$("session-dialog").open) $("session-dialog").showModal();
  $("close-dialog").focus({ preventScroll: true });
  $("session-dialog").scrollTop = 0;
}

function renderDialog() {
  const { session, snapshot, matchingIds } = dialogContext;
  const recommendations = audienceRecommendations(session, audience);
  const focusKey = document.activeElement?.dataset.focusKey;
  const content = $("dialog-content");
  const badges = node("div", "dialog-badges");
  badges.append(node("span", "session-code", session.code), node("span", "badge", session.type));
  if (session.level) badges.append(node("span", "badge", session.level));
  if (snapshot) badges.append(node("span", "badge badge-accent", "Saved snapshot"));
  const title = node("h2", "dialog-title", session.title);
  title.id = "dialog-title";
  content.replaceChildren(badges, title, node("p", "dialog-description", session.description),
    node("p", "dialog-speakers", `Speakers: ${session.speakers || "Not listed in the source catalog"}`));
  const tags = node("div", "card-tags");
  tags.append(...session.topics.map((topic) => node("span", "topic-tag", topic)));
  content.append(tags);
  if (recommendations.length) {
    content.append(node("h3", "dialog-section-title", "Why go, and where does it fit?"));
    for (const { path, step, index } of recommendations) {
      const box = node("div", "recommendation");
      box.append(node("p", "eyebrow", `${path.name} / Step ${index + 1}: ${step.stage}`),
        node("p", "", step.why), node("p", "takeaway", `Take this home: ${step.takeaway}`));
      content.append(box);
    }
  } else if (!snapshot) {
    content.append(node("p", "dialog-note", "An open-catalog discovery, outside your current audience's curated guides. Use the description and level to decide whether it answers a question your team needs to resolve."));
  }
  content.append(node("h3", "dialog-section-title", snapshot ? "Time saved with this guide" : "Choose your session time"));
  if (!snapshot && matchingIds.size < session.instances.length) {
    content.append(node("p", "dialog-note", `${matchingIds.size} of these ${session.instances.length} occurrences match your current catalog filters. Matching times have an accent border.`));
  }
  for (const instance of session.instances) {
    const row = node("div", `occurrence${matchingIds.size < session.instances.length && matchingIds.has(instance.id) ? " is-matching" : ""}`);
    const info = node("div", "occurrence-info");
    info.append(node("strong", "", isScheduled(instance) ?
      formatDate(instance.start, { weekday: "long", month: "short", day: "numeric" }) : "Time not listed"),
    node("p", "", `${timeRange(instance)} · ${durationLabel(instance)}`),
    node("p", "", `${instance.location || "Location not listed"} · ${instance.delivery.join(" + ") || "Attendance not listed"}`));
    if (instance.viewing.length) info.append(node("p", "", instance.viewing.join(" · ")));
    row.append(info);
    if (!snapshot) row.append(saveButton(instance));
    row.append(calendarActions(instance));
    content.append(row);
  }
  content.append(node("p", "dialog-note", "Calendar (.ics) provides an event for your default calendar app. Depending on your browser settings, it may open automatically or download locally; open the file to import it in Outlook, Apple Calendar, or another calendar app. These are personal calendar entries, not seat reservations."));
  if (!snapshot) {
    const first = session.instances.find((instance) => matchingIds.has(instance.id)) || session.instances[0];
    const inGuide = draft.steps.some((step) => step.session.sessionId === session.sessionId);
    const add = button(inGuide ? "Already in your custom guide" : "Add to my custom guide", "button dialog-official",
      () => addToDraft(first), inGuide ? "check" : "route");
    add.dataset.focusKey = "dialog-add-guide";
    content.append(add);
  } else {
    const current = catalog.byId.get(session.sessionId);
    if (current) content.append(button("View current catalog listing", "button dialog-official", () => openSession(current), "arrow"));
  }
  const official = node("a", "text-link dialog-official", `Open official ${catalog.event.name} catalog`);
  official.href = catalog.event.catalogUrl;
  official.target = "_blank";
  official.rel = "noopener noreferrer";
  official.append(icon("arrow-up"));
  content.append(official, node("p", "dialog-note", `Look up ${session.code} in the official catalog to confirm attendance and registration. Saving here does not reserve a seat. Times throughout this page use ${timeZone()}.`));
  if (focusKey === "dialog-add-guide") {
    content.querySelector('[data-focus-key="dialog-add-guide"]')?.focus({ preventScroll: true });
  }
}

function renderAgenda() {
  const focusKey = document.activeElement?.dataset.focusKey;
  const instances = selectedInstances().sort(compareInstances);
  const conflicts = getConflicts(instances);
  const scheduled = instances.filter(isScheduled);
  $("nav-saved-count").textContent = String(instances.length);
  $("agenda-empty").hidden = instances.length > 0;
  $("export-calendar").disabled = scheduled.length === 0;
  $("clear-agenda").disabled = instances.length === 0;
  $("agenda-summary").replaceChildren();
  if (instances.length) {
    $("agenda-summary").append(node("span", "", `${instances.length} saved · ${scheduled.length} with a listed time${instances.length > scheduled.length ? ` · ${instances.length - scheduled.length} not included in calendar export` : ""}`));
    if (conflicts.size) $("agenda-summary").append(node("span", "conflict-label", `${conflicts.size} sessions overlap. Pick an alternative time or remove a session.`));
    else $("agenda-summary").append(node("span", "", "No overlapping times."));
  }
  const list = $("agenda-list");
  list.replaceChildren();
  let previousDay = "";
  for (const instance of instances) {
    const day = isScheduled(instance) ? dateKey(instance.start, timeZone()) : "unscheduled";
    if (day !== previousDay) {
      list.append(node("h3", "agenda-day", isScheduled(instance) ? formatDate(instance.start, {
        weekday: "long", month: "long", day: "numeric",
      }) : "Time not listed"));
      previousDay = day;
    }
    const row = node("article", `agenda-item${conflicts.has(instance.id) ? " has-conflict" : ""}`);
    const time = node("div", "agenda-item-time", timeRange(instance));
    time.append(node("small", "", durationLabel(instance)));
    const body = node("div", "agenda-item-body");
    body.append(button(instance.title, "agenda-item-title", () => openSession(catalog.byId.get(instance.sessionId))),
      node("p", "agenda-item-detail", `${instance.code} · ${instance.location || "Location not listed"} · ${instance.delivery.join(" + ")}`));
    body.append(calendarActions(instance, "agenda"));
    if (conflicts.has(instance.id)) body.append(node("p", "conflict-label",
      `Overlaps ${conflicts.get(instance.id).map((id) => catalog.instanceById.get(id).code).join(", ")}`));
    const remove = button("", "icon-button", () => toggleSaved(instance), "close");
    remove.setAttribute("aria-label", `Remove ${instance.code} from agenda`);
    remove.dataset.focusKey = `agenda-remove-${instance.id}`;
    row.append(time, body, remove);
    list.append(row);
  }
  if (focusKey?.startsWith("agenda-remove-")) {
    const target = [...list.querySelectorAll("[data-focus-key]")]
      .find((element) => element.dataset.focusKey === focusKey);
    (target || list.querySelector("button") || $("timezone")).focus({ preventScroll: true });
  }
}

function persistDraft() {
  draftRevision++;
  storageWrite(storageKeys.draft, JSON.stringify(draft));
  $("share-result").hidden = true;
}

function dismissSharedView() {
  sharedViewRevision++;
  viewingShared = false;
  $("shared-guide").hidden = true;
  $("guide-editor").hidden = false;
  const url = new URL(location.href);
  url.searchParams.delete("guide");
  history.replaceState(null, "", url);
}

function showDraft() {
  dismissSharedView();
  const url = new URL(location.href);
  url.hash = "my-guide";
  history.replaceState(null, "", url);
  $("my-guide").scrollIntoView();
  $("guide-title").focus({ preventScroll: true });
}

function renderDraft() {
  $("guide-title").value = draft.title;
  $("guide-summary").value = draft.summary;
  $("draft-count").textContent = `${draft.steps.length} / ${GUIDE_LIMITS.steps} SESSIONS`;
  $("draft-empty").hidden = draft.steps.length > 0;
  $("clear-draft").disabled = draft.steps.length === 0 && draft.title === newDraft().title && !draft.summary;
  $("share-guide").disabled = draft.steps.length === 0;
  renderGuideCalendar("export-draft-guide", "draft-calendar-help", draft.steps.map((step) => step.session));
  $("draft-steps").replaceChildren(...draft.steps.map((step, index) => customStep(step, index, true)));
}

function customStep(step, index, editable) {
  const item = node("li", "custom-step");
  const body = node("div");
  const session = step.session;
  body.append(button(session.title, "custom-step-title", () => openSession(session, true)),
    node("p", "custom-step-meta", `${session.code} · ${shortTime(session)} · ${session.type}`),
    calendarActions(session, editable ? "draft" : "shared"));
  if (editable) {
    const label = node("label", "", "Why should someone attend this session?");
    const input = node("textarea");
    input.maxLength = GUIDE_LIMITS.note;
    input.rows = 2;
    input.value = step.note;
    input.placeholder = "The question it answers, or the decision it will help someone make.";
    input.setAttribute("aria-label", `Why attend ${session.code}`);
    input.addEventListener("input", () => {
      step.note = input.value;
      persistDraft();
    });
    label.append(input);
    body.append(label);
    const actions = node("div", "custom-step-actions");
    const up = button("↑", "", () => moveStep(index, -1));
    up.disabled = index === 0;
    up.setAttribute("aria-label", `Move ${session.code} earlier`);
    const down = button("↓", "", () => moveStep(index, 1));
    down.disabled = index === draft.steps.length - 1;
    down.setAttribute("aria-label", `Move ${session.code} later`);
    const remove = button("×", "", () => {
      draft.steps.splice(index, 1);
      persistDraft();
      renderDraft();
      renderCatalog();
      $("draft-steps").querySelector("button")?.focus({ preventScroll: true });
      announce(`${session.code} removed from your guide.`);
    });
    remove.setAttribute("aria-label", `Remove ${session.code} from custom guide`);
    actions.append(up, down, remove);
    item.append(node("span", "custom-step-number", String(index + 1).padStart(2, "0")), body, actions);
  } else {
    body.append(node("p", "custom-step-note", step.note || "No additional attendance note from the author."));
    item.append(node("span", "custom-step-number", String(index + 1).padStart(2, "0")), body);
  }
  return item;
}

function moveStep(index, delta) {
  const next = index + delta;
  [draft.steps[index], draft.steps[next]] = [draft.steps[next], draft.steps[index]];
  persistDraft();
  renderDraft();
  const buttons = $("draft-steps").children[next].querySelectorAll(".custom-step-actions button");
  const target = delta < 0 ? buttons[0] : buttons[1];
  (target.disabled ? $("draft-steps").children[next].querySelector(".custom-step-title") : target).focus({ preventScroll: true });
  announce(`Moved to position ${next + 1}.`);
}

function addToDraft(instance) {
  if (draft.steps.some((step) => step.session.sessionId === instance.sessionId)) {
    announce("That session is already in your custom guide. Edit its note or order in Create a guide.");
    return;
  }
  if (draft.steps.length >= GUIDE_LIMITS.steps) {
    announce(`Your guide can contain up to ${GUIDE_LIMITS.steps} sessions. Remove one before adding another.`);
    return;
  }
  draft.steps.push({ session: snapshotSession(instance), note: "" });
  if (new URLSearchParams(location.search).has("guide")) dismissSharedView();
  persistDraft();
  renderDraft();
  renderCatalog();
  if (dialogContext) renderDialog();
  announce(`${instance.code} added to your custom guide. Set its order and why in Create a guide.`);
}

function confirmAction(title, description, label, action) {
  $("confirm-title").textContent = title;
  $("confirm-dialog").querySelector("p").textContent = description;
  $("confirm-clear").textContent = label;
  confirmCallback = action;
  $("confirm-dialog").showModal();
  $("cancel-clear").focus();
}

function replaceDraft(next, message) {
  const replace = () => {
    draft = validateGuide({ ...next, version: 2, eventId: catalog.event.id });
    persistDraft();
    renderDraft();
    renderCatalog();
    showDraft();
    announce(message);
  };
  if (draft.steps.length) {
    confirmAction("Replace your current draft?", "This replaces the guide draft saved in this browser. Previously shared links will still show their original snapshots.", "Replace draft", replace);
  } else replace();
}

function customizePath() {
  const path = catalog.paths.find((item) => item.id === activePath);
  replaceDraft({
    version: 2, eventId: catalog.event.id, title: path.name, summary: path.description,
    steps: path.steps.map((step) => ({
      session: snapshotSession(catalog.byCode.get(step.code).instances[0]),
      note: `${step.why}\n\nTake this home: ${step.takeaway}`,
    })),
  }, "Your editable copy is ready. Set the order, add notes, and create a share link.");
}

function renderShared() {
  if (!sharedGuide || !viewingShared) return;
  $("shared-guide").hidden = false;
  $("guide-editor").hidden = true;
  $("shared-guide-title").textContent = sharedGuide.title;
  $("shared-guide-summary").textContent = sharedGuide.summary;
  renderGuideCalendar("export-shared-guide", "shared-calendar-help", sharedGuide.steps.map((step) => step.session));
  $("shared-guide-steps").replaceChildren(...sharedGuide.steps.map((step, index) => customStep(step, index, false)));
}

function applyURLState() {
  ({ filters, audience, activePath, zoneChoice } = readViewState(location.search, catalog.paths, {
    eventTimeZone: catalog.event.timeZone, audiences: catalog.audiences,
  }));
  $("timezone").value = zoneChoice;
  const theme = new URLSearchParams(location.search).get("scoutTheme");
  document.documentElement.dataset.theme = theme ||
    (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
  preserveThemeForSiteLinks(document.body, location);
}

function renderView() {
  const label = `${catalog.audiences.find((item) => item.id === audience).label} guides`;
  $("audience-heading").textContent = `Your ${label.toLowerCase()}.`;
  $("path-options").setAttribute("aria-label", label);
  populatePathFilter();
  syncFilterInputs();
  renderPathOptions();
  renderPath();
  renderCatalog();
  renderAgenda();
  renderDraft();
  document.querySelectorAll("[data-audience]").forEach((element) => {
    element.setAttribute("aria-pressed", String(element.dataset.audience === audience));
  });
}

function selectAudience(next) {
  audience = next;
  const first = getAudiencePaths(catalog.paths, audience)[0];
  if (!first) throw new Error(`No guides are configured for ${audience}.`);
  activePath = first.id;
  filters.q = $("search").value;
  visibleCount = PAGE_SIZE;
  renderView();
  updateURL();
}

async function syncSharedView({ scroll = false } = {}) {
  const revision = ++sharedViewRevision;
  const token = new URLSearchParams(location.search).get("guide");
  viewingShared = false;
  $("shared-guide").hidden = true;
  $("guide-editor").hidden = false;
  if (token === null) return;
  const isCurrent = () => revision === sharedViewRevision &&
    token === new URLSearchParams(location.search).get("guide");
  try {
    const decoded = await decodeGuide(token);
    if (!isCurrent()) return;
    const eventId = getGuideEventId(decoded);
    if (eventId !== catalog.event.id) {
      const targetEvent = events.find((item) => item.id === eventId);
      if (!targetEvent) throw new Error("The event for this shared guide is not available.");
      const destination = new URL(targetEvent.url, location.href);
      if (destination.origin !== location.origin) throw new Error("The event destination is not on this site.");
      destination.search = location.search;
      destination.hash = location.hash || "my-guide";
      location.replace(destination.href);
      return;
    }
    sharedGuide = decoded;
    viewingShared = true;
    renderShared();
    telemetry?.track("shared_guide_opened", {
      eventId: catalog.event.id, shareVersion: decoded.version, sessionCount: decoded.steps.length,
    });
    if (scroll && ["", "#my-guide"].includes(location.hash)) {
      $("my-guide").scrollIntoView({ behavior: "instant" });
    }
  } catch (error) {
    if (!isCurrent()) return;
    guideMessage(`This shared guide could not be opened: ${error.message} Your local draft has not been changed.`);
    if (scroll && ["", "#my-guide"].includes(location.hash)) {
      $("my-guide").scrollIntoView({ behavior: "instant" });
    }
  }
}

async function shareGuide() {
  const revision = draftRevision;
  const request = ++shareRevision;
  $("share-guide").disabled = true;
  $("share-guide").textContent = "Creating link...";
  try {
    const url = await createShareURL(location.href, draft);
    if (revision !== draftRevision || request !== shareRevision) {
      guideMessage("Your draft changed while the link was being created. Create a new share link for the latest version.");
      return;
    }
    $("share-url").value = url;
    $("open-guide-link").href = url;
    $("share-result").hidden = false;
    telemetry?.trackComposition("custom_guide_created", draft.steps.map((step) => step.session), {
      eventId: catalog.event.id, source: "custom", sessionCount: draft.steps.length, shareVersion: draft.version,
    });
    guideMessage("");
    $("share-url").focus();
    $("share-url").select();
    announce("Your snapshot link is ready. Copy it to share this exact guide.");
  } catch (error) {
    guideMessage(`Could not create a share link: ${error.message}`);
  } finally {
    $("share-guide").disabled = draft.steps.length === 0;
    $("share-guide").replaceChildren(icon("arrow-up"), document.createTextNode("Create share link"));
  }
}

function bindEvents() {
  document.querySelectorAll("[data-entry]").forEach((element) => {
    element.addEventListener("click", (event) => {
      event.preventDefault();
      if (new URLSearchParams(location.search).has("guide")) dismissSharedView();
      if (element.dataset.entry === "custom") {
        showDraft();
        return;
      }
      selectAudience(element.dataset.entry);
      location.hash = "guide";
      $("guide").scrollIntoView();
      $("path-headline").tabIndex = -1;
      $("path-headline").focus({ preventScroll: true });
    });
  });
  $("catalog-filters").addEventListener("submit", (event) => event.preventDefault());
  let searchTimer;
  $("search").addEventListener("input", () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      filters.q = $("search").value;
      visibleCount = PAGE_SIZE;
      updateURL();
      recordEmptyResults(renderCatalog());
    }, 140);
  });
  for (const key of ["topic", "type", "level", "delivery", "day", "path", "sort"]) {
    $(key === "path" ? "path-filter" : key).addEventListener("change", (event) => {
      filters[key] = event.target.value;
      visibleCount = PAGE_SIZE;
      updateURL();
      recordEmptyResults(renderCatalog());
    });
  }
  const reset = () => {
    clearTimeout(searchTimer);
    filters = { ...FILTER_DEFAULTS };
    visibleCount = PAGE_SIZE;
    syncFilterInputs();
    updateURL();
    renderCatalog();
  };
  $("reset-filters").addEventListener("click", reset);
  $("empty-reset").addEventListener("click", reset);
  $("load-more").addEventListener("click", () => {
    const oldCount = visibleCount;
    visibleCount += PAGE_SIZE;
    renderCatalog();
    $("session-grid").children[oldCount]?.querySelector("button")?.focus({ preventScroll: true });
  });
  $("share-filters").addEventListener("click", () => {
    updateURL();
    const url = new URL(location.href);
    url.searchParams.delete("guide");
    url.hash = "catalog";
    copyText(url.href, () => {
      guideMessage(`Copy this catalog view link: ${url.href}`);
      $("my-guide").scrollIntoView();
    });
  });
  document.querySelectorAll("[data-audience]").forEach((element) => {
    element.addEventListener("click", () => {
      selectAudience(element.dataset.audience);
    });
  });
  $("save-path").addEventListener("click", () => {
    const path = catalog.paths.find((item) => item.id === activePath);
    addSessionsToAgenda(pathInstances(path));
  });
  $("export-path").addEventListener("click", () => {
    const path = catalog.paths.find((item) => item.id === activePath);
    downloadCalendar(pathInstances(path), path.name, undefined, "path");
  });
  $("export-draft-guide").addEventListener("click", () => {
    downloadCalendar(draft.steps.map((step) => step.session), draft.title.trim() || newDraft().title, undefined, "draft");
  });
  $("export-shared-guide").addEventListener("click", () => {
    downloadCalendar(sharedGuide.steps.map((step) => step.session), sharedGuide.title, undefined, "shared");
  });
  $("customize-path").addEventListener("click", customizePath);
  $("start-from-path").addEventListener("click", customizePath);
  $("browse-path").addEventListener("click", () => {
    filters = { ...FILTER_DEFAULTS, path: activePath };
    visibleCount = PAGE_SIZE;
    syncFilterInputs();
    updateURL();
    renderCatalog();
    location.hash = "catalog";
  });
  $("timezone").addEventListener("change", () => {
    zoneChoice = $("timezone").value;
    setupDays();
    syncFilterInputs();
    updateURL();
    renderCatalog();
    renderPath();
    renderAgenda();
    renderDraft();
    renderShared();
    if (dialogContext) renderDialog();
    announce(`All displayed times now use ${timeZone()}.`);
  });
  $("close-dialog").addEventListener("click", () => $("session-dialog").close());
  $("session-dialog").addEventListener("close", () => { dialogContext = null; });
  $("session-dialog").addEventListener("click", (event) => {
    if (event.target !== $("session-dialog")) return;
    const rect = $("session-dialog").getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) {
      $("session-dialog").close();
    }
  });
  $("clear-agenda").addEventListener("click", () => confirmAction("Clear your saved agenda?",
    "This removes every saved session from this browser. It won't change any official event bookings.", "Clear agenda", () => {
      saved.clear();
      persistAgenda();
      refreshSavedViews();
      announce("Your saved agenda is clear.");
    }));
  $("cancel-clear").addEventListener("click", () => $("confirm-dialog").close());
  $("confirm-clear").addEventListener("click", () => {
    const action = confirmCallback;
    $("confirm-dialog").close();
    action?.();
  });
  $("confirm-dialog").addEventListener("close", () => { confirmCallback = null; });
  $("export-calendar").addEventListener("click", () => {
    downloadCalendar(selectedInstances(), `${catalog.event.name} - My agenda`, `my-${catalog.event.id}-agenda.ics`, "agenda");
  });
  for (const [id, key] of [["guide-title", "title"], ["guide-summary", "summary"]]) {
    $(id).addEventListener("input", () => {
      draft[key] = $(id).value;
      persistDraft();
    });
  }
  $("clear-draft").addEventListener("click", () => confirmAction("Clear your guide draft?",
    "This removes your local draft, including its notes. Any previously shared links will keep their original content.", "Clear draft", () => {
      draft = newDraft();
      persistDraft();
      renderDraft();
      renderCatalog();
      announce("Your guide draft is clear.");
    }));
  $("share-guide").addEventListener("click", shareGuide);
  $("copy-guide-link").addEventListener("click", () => copyText($("share-url").value, () => {
    $("share-url").focus();
    $("share-url").select();
  }));
  $("share-url").addEventListener("click", () => $("share-url").select());
  $("edit-shared").addEventListener("click", () => {
    replaceDraft(structuredClone(sharedGuide), "You're editing a local copy. The original shared guide is unchanged.");
  });
  $("show-draft").addEventListener("click", showDraft);
  $("save-shared-agenda").addEventListener("click", () => {
    const available = sharedGuide.steps.map((step) => catalog.instanceById.get(step.session.id)).filter(Boolean);
    addSessionsToAgenda(available);
    const missing = sharedGuide.steps.length - available.length;
    if (missing) guideMessage(`${missing} shared session${missing === 1 ? " is" : "s are"} no longer in the current catalog and could not be saved. Your agenda uses current catalog times; this shared snapshot is unchanged.`);
    else guideMessage("Sessions were added using current catalog times. The shared snapshot above is unchanged; check the agenda for live times and conflicts.");
  });
  window.addEventListener("popstate", () => {
    applyURLState();
    setupDays();
    visibleCount = PAGE_SIZE;
    renderView();
    syncSharedView();
  });
  wireEventLinks(document.body, () => telemetry);
  window.addEventListener("beforeunload", (event) => {
    if (!unsavedStorageKeys.size) return;
    event.preventDefault();
    event.returnValue = "";
  });
}

function restoreLocalData() {
  try {
    const restored = restoreSaved(storageRead(storageKeys.agenda), catalog.instanceById);
    saved = new Set(restored.ids);
    if (restored.removed) storageWarning(`${restored.removed} previously saved session times are no longer in this catalog and were removed from the agenda.`);
  } catch (error) {
    storageWarning(`Your previous agenda could not be read: ${error.message} New selections will replace it.`);
  }
  const rawDraft = storageRead(storageKeys.draft);
  if (rawDraft !== null) {
    try {
      const parsed = validateStoredDraft(rawDraft, catalog.event.id);
      // An unfinished title is a valid local draft, but not a shareable guide yet.
      draft = validateGuide({
        ...parsed, version: 2, eventId: catalog.event.id,
        title: parsed.title?.trim() ? parsed.title : newDraft().title,
      });
      if (typeof parsed.title === "string") draft.title = parsed.title;
    } catch (error) {
      storageWarning(`Your previous guide draft could not be read: ${error.message} New edits will replace it; existing share links remain unchanged.`);
    }
  }
}

function renderRegistration() {
  const section = $("event-registration");
  if (!section) return;
  const registration = eventRegistration(catalog.event);
  section.hidden = !registration;
  if (registration) {
    $("event-registration-link").href = registration.url;
    $("event-registration-label").textContent = registration.label;
    $("event-registration-ended").hidden = !registration.past;
    $("event-registration-link").setAttribute("aria-describedby",
      registration.past ? "event-registration-note event-registration-destination event-registration-ended"
        : "event-registration-note event-registration-destination");
    $("event-registration-link").title = registration.past
      ? $("event-registration-ended").textContent
      : "Event registration on the official website (opens in a new tab).";
  }
}

async function boot() {
  $("load-error").hidden = true;
  $("loading-notice").hidden = false;
  try {
    const response = await fetch(document.body.dataset.catalog);
    if (!response.ok) throw new Error(`Catalog request returned HTTP ${response.status}.`);
    catalog = createCatalog(await response.json());
    renderRegistration();
    const manifestResponse = await fetch(document.body.dataset.events);
    if (!manifestResponse.ok) throw new Error(`Event directory request returned HTTP ${manifestResponse.status}.`);
    const manifest = validateManifest(await manifestResponse.json());
    events = manifest.events;
    storageKeys = eventStorageKeys(catalog.event.id);
    draft = newDraft();
    if (!telemetry) telemetry = initializeTelemetry({ events, catalog });
    else telemetry.setCatalog(catalog);
    const eventZone = [...$("timezone").options].find((option) => !["local", "UTC"].includes(option.value));
    if (eventZone) {
      eventZone.value = catalog.event.timeZone;
      eventZone.textContent = `Event time · ${catalog.event.timeZone}`;
    }
    let browserStorage;
    try {
      browserStorage = window.localStorage;
    } catch (error) {
      storageWarning(`Browser storage is unavailable (${error.name}). Keep a share link before leaving this event.`);
    }
    if (browserStorage) {
      await migrateLegacyStorage(catalog.event.id, browserStorage, {
        locks: navigator.locks, onWarning: storageWarning,
      });
    }
    applyURLState();
    restoreLocalData();
    setupFilters();
    renderView();
    $("session-count").textContent = catalog.sessions.length.toLocaleString();
    const unscheduled = [...catalog.instanceById.values()].filter((instance) => !isScheduled(instance)).length;
    $("source-summary").textContent = `${catalog.instanceById.size.toLocaleString()} instances, grouped into ${catalog.sessions.length.toLocaleString()} sessions; ${unscheduled} instances have no listed time.${catalog.updated ? ` Latest source update: ${formatDate(catalog.updated, { month: "short", day: "numeric", year: "numeric" })}.` : ""}`;
    if (!initialized) {
      bindEvents();
      initialized = true;
    }
    $("app-content").hidden = false;
    $("loading-notice").hidden = true;
    await syncSharedView({ scroll: true });
    if (!new URLSearchParams(location.search).has("guide") && location.hash) {
      const target = document.getElementById(location.hash.slice(1));
      target?.scrollIntoView({ behavior: "instant" });
    }
  } catch (error) {
    $("loading-notice").hidden = true;
    $("app-content").hidden = true;
    $("load-error-message").textContent = `${error.message} If you maintain this site, confirm that Hugo built the source JSON and that the deployment base URL is correct.`;
    $("load-error").hidden = false;
  }
}

$("theme-toggle").addEventListener("click", () => {
  const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
  document.documentElement.dataset.theme = next;
  const url = new URL(location.href);
  url.searchParams.set("scoutTheme", next);
  history.replaceState(null, "", url);
  preserveThemeForSiteLinks(document.body, location);
  $("theme-toggle").setAttribute("aria-label", `Switch to ${next === "dark" ? "light" : "dark"} theme`);
});
$("retry-load").addEventListener("click", boot);
const headerObserver = new ResizeObserver(([entry]) => {
  document.documentElement.style.setProperty("--event-header-height", `${entry.target.getBoundingClientRect().height}px`);
});
headerObserver.observe($("event-header"));
wireEventSwitcher(document);
boot();
