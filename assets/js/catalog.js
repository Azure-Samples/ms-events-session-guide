export const FILTER_DEFAULTS = Object.freeze({
  q: "", topic: "", type: "", level: "", delivery: "", day: "", path: "", sort: "recommended",
});

export function isScheduled(instance) {
  return Number.isFinite(Date.parse(instance.start)) &&
    Number.isFinite(Date.parse(instance.end)) &&
    Date.parse(instance.end) > Date.parse(instance.start);
}

export function compareInstances(a, b) {
  const first = isScheduled(a) ? Date.parse(a.start) : Infinity;
  const second = isScheduled(b) ? Date.parse(b.start) : Infinity;
  return first === second ? a.id.localeCompare(b.id) : first - second;
}

export function createCatalog(payload) {
  if (!Array.isArray(payload.instances) || !Array.isArray(payload.guide?.paths)) {
    throw new Error("The generated catalog has an unexpected shape. Rebuild the Hugo site.");
  }
  const byId = new Map();
  const byCode = new Map();
  const instanceById = new Map();
  for (const instance of payload.instances) {
    if (!instance.id || !instance.sessionId || !instance.title || instanceById.has(instance.id)) {
      throw new Error("The catalog contains an invalid or duplicate session instance.");
    }
    instanceById.set(instance.id, instance);
    if (!byId.has(instance.sessionId)) {
      const session = { ...instance, instances: [], recommendations: [] };
      byId.set(instance.sessionId, session);
      byCode.set(instance.code, session);
    }
    byId.get(instance.sessionId).instances.push(instance);
  }
  for (const path of payload.guide.paths) {
    path.steps.forEach((step, index) => {
      const session = byCode.get(step.code);
      if (!session) throw new Error(`The ${path.name} path references a missing session: ${step.code}.`);
      session.recommendations.push({ path, step, index });
    });
  }
  const sessions = [...byId.values()];
  sessions.forEach((session) => {
    session.instances.sort(compareInstances);
    session.searchText = normalizeSearch(session.instances.flatMap((instance) => [
      instance.code, instance.title, instance.description, instance.speakers, ...instance.topics,
    ]).join(" "));
  });
  return { sessions, byId, byCode, instanceById, paths: payload.guide.paths, updated: payload.updated };
}

export function normalizeSearch(value) {
  return value.normalize("NFKD").replace(/\p{M}/gu, "").toLocaleLowerCase().trim();
}

const dateFormatters = new Map();

export function dateKey(value, timeZone) {
  if (!Number.isFinite(Date.parse(value))) return "";
  if (!dateFormatters.has(timeZone)) {
    dateFormatters.set(timeZone, new Intl.DateTimeFormat("en-US", {
      timeZone, year: "numeric", month: "2-digit", day: "2-digit",
    }));
  }
  const parts = dateFormatters.get(timeZone).formatToParts(new Date(value));
  const get = (type) => parts.find((part) => part.type === type).value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

export function filterCatalog(catalog, filters, timeZone) {
  const words = normalizeSearch(filters.q || "").split(/\s+/).filter(Boolean);
  const path = catalog.paths.find((item) => item.id === filters.path);
  const results = [];
  for (const session of catalog.sessions) {
    if (words.some((word) => !session.searchText.includes(word))) continue;
    if (path && !path.steps.some((step) => step.code === session.code)) continue;
    const instances = session.instances.filter((instance) => {
      if (filters.topic && !instance.topics.includes(filters.topic)) return false;
      if (filters.type && instance.type !== filters.type) return false;
      if (filters.level && instance.level !== filters.level) return false;
      if (filters.delivery && !instance.delivery.includes(filters.delivery)) return false;
      if (filters.day === "unscheduled") return !isScheduled(instance);
      return !filters.day || (isScheduled(instance) && dateKey(instance.start, timeZone) === filters.day);
    });
    if (instances.length) results.push({ ...session, instances });
  }
  return results.sort((a, b) => {
    if (filters.sort === "title") return a.title.localeCompare(b.title);
    if (filters.sort === "time") return compareInstances(a.instances[0], b.instances[0]);
    if (path) return path.steps.findIndex((step) => step.code === a.code) -
      path.steps.findIndex((step) => step.code === b.code);
    return Number(b.recommendations.length > 0) - Number(a.recommendations.length > 0) ||
      a.title.localeCompare(b.title);
  });
}

export function getConflicts(instances) {
  const scheduled = instances.filter(isScheduled).sort(compareInstances);
  const conflicts = new Map();
  for (let i = 0; i < scheduled.length; i++) {
    for (let j = i + 1; j < scheduled.length; j++) {
      if (Date.parse(scheduled[j].start) >= Date.parse(scheduled[i].end)) break;
      for (const [first, second] of [[scheduled[i], scheduled[j]], [scheduled[j], scheduled[i]]]) {
        if (!conflicts.has(first.id)) conflicts.set(first.id, []);
        conflicts.get(first.id).push(second.id);
      }
    }
  }
  return conflicts;
}

export function readFilters(search) {
  const params = new URLSearchParams(search);
  const filters = { ...FILTER_DEFAULTS };
  for (const key of Object.keys(filters)) {
    if (params.has(key)) filters[key] = params.get(key);
  }
  if (!["recommended", "time", "title"].includes(filters.sort)) filters.sort = "recommended";
  return filters;
}

export function readViewState(search, paths) {
  const params = new URLSearchParams(search);
  const audience = params.get("audience") === "digital-native" ? "digital-native" : "startup";
  const preferredPath = params.get("route") || (audience === "digital-native" ? "scale" : "launch");
  return {
    filters: readFilters(search),
    audience,
    activePath: paths.some((path) => path.id === preferredPath) ? preferredPath : "launch",
    zoneChoice: ["local", "UTC", "America/Los_Angeles"].includes(params.get("tz")) ?
      params.get("tz") : "America/Los_Angeles",
  };
}

export function writeFilters(url, filters) {
  const result = new URL(url);
  for (const [key, defaultValue] of Object.entries(FILTER_DEFAULTS)) {
    if (filters[key] && filters[key] !== defaultValue) result.searchParams.set(key, filters[key]);
    else result.searchParams.delete(key);
  }
  return result;
}

export function restoreSaved(raw, instanceById) {
  if (raw === null) return { ids: [], removed: 0 };
  const parsed = JSON.parse(raw);
  if (parsed.version !== 1 || !Array.isArray(parsed.ids) ||
      parsed.ids.some((id) => typeof id !== "string")) {
    throw new Error("Saved agenda data is not in the expected format.");
  }
  const unique = [...new Set(parsed.ids)];
  const ids = unique.filter((id) => instanceById.has(id));
  return { ids, removed: unique.length - ids.length };
}

function escapeCalendar(value) {
  return String(value).replace(/\\/g, "\\\\").replace(/\r\n|\r|\n/g, "\\n")
    .replace(/;/g, "\\;").replace(/,/g, "\\,");
}

function foldCalendarLine(line) {
  const encoder = new TextEncoder();
  const lines = [];
  let chunk = "";
  let bytes = 0;
  for (const character of line) {
    const size = encoder.encode(character).length;
    if (bytes + size > 75) {
      lines.push(chunk);
      chunk = " ";
      bytes = 1;
    }
    chunk += character;
    bytes += size;
  }
  lines.push(chunk);
  return lines.join("\r\n");
}

export function calendarExport(instances, now = new Date()) {
  const timestamp = (value) => new Date(value).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Ignite Field Guide//2026//EN",
    "CALSCALE:GREGORIAN", "METHOD:PUBLISH", "X-WR-CALNAME:Ignite 2026 - My field guide"];
  for (const instance of instances.filter(isScheduled).sort(compareInstances)) {
    lines.push("BEGIN:VEVENT", `UID:${escapeCalendar(instance.id)}@ignite-field-guide`,
      `DTSTAMP:${timestamp(now)}`, `DTSTART:${timestamp(instance.start)}`,
      `DTEND:${timestamp(instance.end)}`,
      `SUMMARY:${escapeCalendar(`${instance.code}: ${instance.title}`)}`,
      `DESCRIPTION:${escapeCalendar(`${instance.description}\nSpeakers: ${instance.speakers || "Not listed"}\nVerify times and attendance in the official Ignite catalog. Saving is not a reservation.`)}`,
      `LOCATION:${escapeCalendar(instance.location || "Location not listed")}`, "END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return `${lines.map(foldCalendarLine).join("\r\n")}\r\n`;
}
