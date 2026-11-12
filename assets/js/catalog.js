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
  if (!payload || typeof payload !== "object" || !Array.isArray(payload.instances) ||
      !payload.guide || typeof payload.guide !== "object" || !Array.isArray(payload.guide.paths)) {
    throw new Error("The generated catalog has an unexpected shape. Rebuild the Hugo site.");
  }
  const event = payload.event === undefined ? LEGACY_EVENT : validateEvent(payload.event);
  if (payload.event !== undefined && !payload.guide.paths.some((path) =>
    Array.isArray(path?.steps) && path.steps.length)) {
    throw new Error("The generated catalog must contain a nonempty curated guide.");
  }
  const audiences = payload.guide.audiences === undefined && payload.event === undefined ?
    LEGACY_AUDIENCES : payload.guide.audiences;
  if (!Array.isArray(audiences) || !audiences.length) {
    throw new Error("The generated catalog must define its guide audiences.");
  }
  const audienceIds = new Set();
  for (const audience of audiences) {
    if (!audience || typeof audience !== "object" || typeof audience.label !== "string" ||
        !audience.label.trim()) throw new Error("Each guide audience must have an ID and label.");
    validateEventId(audience.id);
    if (audience.id === "custom") throw new Error("The custom audience ID is reserved for the guide editor.");
    if (audienceIds.has(audience.id)) throw new Error("Guide audience IDs must be unique.");
    audienceIds.add(audience.id);
  }
  const byId = new Map();
  const byCode = new Map();
  const instanceById = new Map();
  for (const instance of payload.instances) {
    if (!instance || typeof instance !== "object" ||
        ["id", "sessionId", "code", "title"].some((key) => typeof instance[key] !== "string" || !instance[key]) ||
        ["description", "speakers", "type", "level", "start", "end", "location"]
          .some((key) => typeof instance[key] !== "string") ||
        !Number.isInteger(instance.duration) || instance.duration < 0 || instance.duration > 1440 ||
        ["topics", "delivery", "viewing"].some((key) =>
          !Array.isArray(instance[key]) || Array.from(instance[key]).some((item) => typeof item !== "string")) ||
        (instance.audiences !== undefined && (!Array.isArray(instance.audiences) ||
          Array.from(instance.audiences).some((item) => typeof item !== "string"))) ||
        instanceById.has(instance.id)) {
      throw new Error("The catalog contains an invalid or duplicate session instance.");
    }
    if ((byCode.has(instance.code) && byCode.get(instance.code).sessionId !== instance.sessionId) ||
        (byId.has(instance.sessionId) && byId.get(instance.sessionId).code !== instance.code)) {
      throw new Error("The catalog contains inconsistent or duplicate session codes.");
    }
    instanceById.set(instance.id, instance);
    if (!byId.has(instance.sessionId)) {
      const session = { ...instance, instances: [], recommendations: [] };
      byId.set(instance.sessionId, session);
      byCode.set(instance.code, session);
    }
    byId.get(instance.sessionId).instances.push(instance);
  }
  const pathIds = new Set();
  for (const path of payload.guide.paths) {
    if (!path || typeof path !== "object" || typeof path.id !== "string" || !path.id ||
        pathIds.has(path.id)) throw new Error("Every guide must have a unique ID.");
    if (!audienceIds.has(path.audience)) {
      throw new Error("Every guide must target a configured audience.");
    }
    if (typeof path.name !== "string" || !path.name || !Array.isArray(path.steps)) {
      throw new Error("Every guide must have a name and a list of steps.");
    }
    pathIds.add(path.id);
    Array.from(path.steps).forEach((step, index) => {
      if (!step || typeof step !== "object" || typeof step.code !== "string" || !step.code) {
        throw new Error("Every guide step must reference a session code.");
      }
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
  return { event, audiences, sessions, byId, byCode, instanceById, paths: payload.guide.paths, updated: payload.updated };
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

export function getAudiencePaths(paths, audience) {
  return paths.filter((path) => path.audience === audience);
}

export function audienceRecommendations(session, audience) {
  return session.recommendations.filter(({ path }) => !audience || path.audience === audience);
}

export function filterCatalog(catalog, filters, timeZone, audience) {
  const words = normalizeSearch(filters.q || "").split(/\s+/).filter(Boolean);
  const paths = audience ? getAudiencePaths(catalog.paths, audience) : catalog.paths;
  const path = paths.find((item) => item.id === filters.path);
  if (audience && filters.path && !path) return [];
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
    return Number(audienceRecommendations(b, audience).length > 0) -
      Number(audienceRecommendations(a, audience).length > 0) ||
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

export function readViewState(search, paths, event = LEGACY_EVENT, audiences) {
  const options = Object.hasOwn(event, "eventTimeZone") ? event : null;
  const eventTimeZone = options ? options.eventTimeZone : event.timeZone;
  audiences = audiences || options?.audiences;
  const params = new URLSearchParams(search);
  const filters = readFilters(search);
  const linkedPath = paths.find((path) => path.id === params.get("route")) ||
    paths.find((path) => path.id === filters.path);
  const requestedAudience = params.get("audience");
  const availableIds = new Set(paths.map((path) => path.audience));
  if (!audiences && paths.every((path) => LEGACY_AUDIENCES.some((item) => item.id === path.audience))) {
    for (const item of LEGACY_AUDIENCES) availableIds.add(item.id);
  }
  const audience = availableIds.has(requestedAudience) ?
    requestedAudience : linkedPath?.audience || paths[0]?.audience;
  const available = getAudiencePaths(paths, audience);
  if (!available.length) throw new Error(`No guides are configured for ${audience}.`);
  const selected = available.find((path) => path.id === params.get("route")) ||
    available.find((path) => path.id === filters.path) || available[0];
  if (!available.some((path) => path.id === filters.path)) filters.path = "";
  return {
    filters,
    audience,
    activePath: selected.id,
    zoneChoice: ["local", "UTC", eventTimeZone].includes(params.get("tz")) ?
      params.get("tz") : eventTimeZone,
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

export function calendarSessions(instances) {
  return [...new Map(instances.filter(isScheduled).map((instance) => [instance.id, instance])).values()]
    .sort(compareInstances);
}

function calendarDescription(instance, event) {
  return `${instance.description}\nSpeakers: ${instance.speakers || "Not listed"}\nVerify times and attendance in the official ${event.name} catalog: ${event.catalogUrl}. Saving is not a reservation.`;
}

export function calendarExport(instances, now = new Date(), name = "Ignite 2026 - My field guide", event = LEGACY_EVENT) {
  event = validateEvent(event);
  if (arguments[2] === undefined && event.id !== LEGACY_EVENT_ID) name = `${event.name} - My guide`;
  const timestamp = (value) => new Date(value).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Microsoft//Events Guide//EN",
    "CALSCALE:GREGORIAN", "METHOD:PUBLISH", `X-WR-CALNAME:${escapeCalendar(name)}`];
  for (const instance of calendarSessions(instances)) {
    const uid = event.id === LEGACY_EVENT_ID ? `${instance.id}@ignite-field-guide` :
      `${event.id}:${instance.id}@ms-events-guide`;
    lines.push("BEGIN:VEVENT", `UID:${escapeCalendar(uid)}`,
      `DTSTAMP:${timestamp(now)}`, `DTSTART:${timestamp(instance.start)}`,
      `DTEND:${timestamp(instance.end)}`,
      `SUMMARY:${escapeCalendar(`${instance.code}: ${instance.title}`)}`,
      `DESCRIPTION:${escapeCalendar(calendarDescription(instance, event))}`,
      `LOCATION:${escapeCalendar(instance.location || "Location not listed")}`, "END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return `${lines.map(foldCalendarLine).join("\r\n")}\r\n`;
}
import { LEGACY_AUDIENCES, LEGACY_EVENT, LEGACY_EVENT_ID, validateEvent, validateEventId } from "./event-context.js";
