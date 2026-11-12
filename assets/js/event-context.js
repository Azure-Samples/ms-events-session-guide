// Copyright (c) Microsoft Corporation. Licensed under the MIT license.

export const LEGACY_EVENT_ID = "ignite-2026";
export const LEGACY_EVENT = Object.freeze({
  id: LEGACY_EVENT_ID,
  name: "Microsoft Ignite 2026",
  summary: "Microsoft Ignite 2026 session guide",
  startDate: "2026-11-17",
  endDate: "2026-11-20",
  timeZone: "America/Los_Angeles",
  catalogUrl: "https://ignite.microsoft.com/en-US/sessions",
  url: "/events/ignite-2026/",
  catalogVersion: "ignite",
});

export const LEGACY_AUDIENCES = Object.freeze([
  Object.freeze({ id: "startup", label: "Startups" }),
  Object.freeze({ id: "digital-native", label: "Digital-native companies" }),
]);

export function validateEventId(value) {
  if (typeof value !== "string" || value.length > 80 ||
      !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value)) {
    throw new Error("Event ID must be a lowercase slug of at most 80 characters.");
  }
  return value;
}

function date(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value &&
    !value.startsWith("0000");
}

export function validateTimeZone(value) {
  if (typeof value !== "string" || !value || value.length > 100 || /^[+-]/.test(value)) {
    throw new Error("Event time zone must be a valid IANA time zone.");
  }
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
  } catch (cause) {
    throw new Error("Event time zone must be a valid IANA time zone.", { cause });
  }
  return value;
}

export function validateEvent(event) {
  if (!event || typeof event !== "object" || Array.isArray(event)) {
    throw new Error("The generated catalog must contain valid event metadata.");
  }
  validateEventId(event.id);
  for (const field of ["name", "summary", "catalogVersion"]) {
    if (typeof event[field] !== "string" || !event[field].trim() || event[field].length > 1000) {
      throw new Error(`Event ${field} must be nonempty text.`);
    }
  }
  if (!date(event.startDate) || !date(event.endDate) || event.startDate > event.endDate) {
    throw new Error("Event dates must be valid and in chronological order.");
  }
  validateTimeZone(event.timeZone);
  for (const [field, label] of [["catalogUrl", "catalog"], ["registrationUrl", "registration"]]) {
    if (field === "registrationUrl" && event[field] === undefined) continue;
    const value = event[field];
    if (typeof value !== "string" || !value.startsWith("https://") || /[\s\x00-\x20\x7f\\]/.test(value)) {
      throw new Error(`Event ${label} URL must be an absolute HTTPS URL without credentials or whitespace.`);
    }
    let official;
    try {
      official = new URL(value);
    } catch (cause) {
      throw new Error(`Event ${label} URL must be an absolute HTTPS URL.`, { cause });
    }
    if (official.protocol !== "https:" || official.username || official.password) {
      throw new Error(`Event ${label} URL must be an absolute HTTPS URL without credentials.`);
    }
  }
  if (typeof event.url !== "string" || !event.url.startsWith("/") || event.url.startsWith("//") ||
      /[\x00-\x20\\]/.test(event.url)) {
    throw new Error("Event URL must be a site-relative path.");
  }
  return Object.freeze({
    id: event.id, name: event.name, summary: event.summary, startDate: event.startDate,
    endDate: event.endDate, timeZone: event.timeZone, catalogUrl: event.catalogUrl,
    url: event.url, catalogVersion: event.catalogVersion,
    ...(event.registrationUrl === undefined ? {} : { registrationUrl: event.registrationUrl }),
  });
}
