export const GUIDE_LIMITS = Object.freeze({
  steps: 20, title: 100, summary: 600, note: 600, url: 7500,
});

const MAX_PAYLOAD_BYTES = 256 * 1024;
const MAX_COMPRESSED_BYTES = Math.floor((GUIDE_LIMITS.url - 2) * 3 / 4);
const MAX_LABELS = 50;
const TOO_LONG = "This guide link is too long to share. Shorten notes or use fewer sessions.";
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;
const TIMESTAMP = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(?:Z|[+-](\d{2}):(\d{2}))$/;

function plainObject(value, label) {
  if (value === null || typeof value !== "object" || Array.isArray(value) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(value))) {
    throw new Error(`${label} must be a plain object.`);
  }
}

function text(value, label, maximum, { required = false, trim = false } = {}) {
  if (typeof value !== "string") throw new Error(`${label} must be text.`);
  const result = trim ? value.trim() : value;
  if (result.length > maximum) throw new Error(`${label} must be at most ${maximum} characters.`);
  if (required && !result.trim()) throw new Error(`${label} cannot be empty.`);
  return result;
}

function identifier(value, label) {
  const result = text(value, label, 200, { required: true });
  if (!IDENTIFIER.test(result)) throw new Error(`${label} is not a valid session identifier.`);
  return result;
}

function labels(value, label) {
  if (!Array.isArray(value) || value.length > MAX_LABELS) {
    throw new Error(`${label} must be a list of at most ${MAX_LABELS} text values.`);
  }
  return Object.freeze(Array.from(value, (item) => text(item, label, 200, { required: true })));
}

function timestamp(value, label) {
  const result = text(value, label, 40);
  if (result === "") return result;
  const parts = TIMESTAMP.exec(result);
  if (!parts) throw new Error(`${label} must be an ISO date and time with a time zone.`);
  const [year, month, day, hour, minute, second, offsetHour, offsetMinute] =
    parts.slice(1).map((part) => Number(part ?? 0));
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > days[month - 1] ||
      hour > 23 || minute > 59 || second > 59 || offsetHour > 23 || offsetMinute > 59 ||
      !Number.isFinite(Date.parse(result))) {
    throw new Error(`${label} contains an invalid date or time.`);
  }
  return result;
}

export function snapshotSession(instance) {
  plainObject(instance, "A session snapshot");
  const start = timestamp(instance.start, "Session start");
  const end = timestamp(instance.end, "Session end");
  if (Boolean(start) !== Boolean(end) || (start && Date.parse(end) <= Date.parse(start))) {
    throw new Error("Session start and end must both be empty or describe a positive time range.");
  }
  if (!Number.isInteger(instance.duration) || instance.duration < 0 || instance.duration > 1440) {
    throw new Error("Session duration must be a whole number of minutes between 0 and 1440.");
  }
  return Object.freeze({
    id: identifier(instance.id, "Session instance ID"),
    sessionId: identifier(instance.sessionId, "Session ID"),
    code: text(instance.code, "Session code", 100, { required: true }),
    title: text(instance.title, "Session title", 500, { required: true }),
    description: text(instance.description, "Session description", 8000),
    speakers: text(instance.speakers, "Session speakers", 2000),
    type: text(instance.type, "Session type", 200),
    level: text(instance.level, "Session level", 200),
    topics: labels(instance.topics, "Session topics"),
    delivery: labels(instance.delivery, "Session delivery"),
    audiences: instance.audiences === undefined ? Object.freeze([]) : labels(instance.audiences, "Session audiences"),
    viewing: labels(instance.viewing, "Session viewing options"),
    start,
    end,
    duration: instance.duration,
    location: text(instance.location, "Session location", 1000),
  });
}

export function validateGuide(input) {
  plainObject(input, "The guide");
  if (input.version !== 1) throw new Error("Unsupported guide version. Only version 1 is supported.");
  const title = text(input.title, "Guide title", GUIDE_LIMITS.title, { required: true, trim: true });
  const summary = text(input.summary, "Guide summary", GUIDE_LIMITS.summary);
  if (!Array.isArray(input.steps) || input.steps.length > GUIDE_LIMITS.steps) {
    throw new Error(`Guide steps must be a list of at most ${GUIDE_LIMITS.steps} sessions.`);
  }
  const seen = new Set();
  const steps = Array.from(input.steps, (step) => {
    plainObject(step, "Each guide step");
    const session = snapshotSession(step.session);
    if (seen.has(session.sessionId)) throw new Error("A guide cannot include the same session more than once.");
    seen.add(session.sessionId);
    return { session, note: text(step.note, "Session note", GUIDE_LIMITS.note) };
  });
  return { version: 1, title, summary, steps };
}

function base64URL(bytes) {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 32768) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 32768));
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64URL(value) {
  if (value.length % 4 === 1) throw new Error("This guide link contains invalid base64url data.");
  const padded = value.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - value.length % 4) % 4);
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  if (base64URL(bytes) !== value) throw new Error("This guide link contains invalid base64url data.");
  return bytes;
}

async function collectBytes(stream, maximum, overflowMessage, decoding = false) {
  const reader = stream.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      let chunk;
      if (decoding) {
        try {
          chunk = await reader.read();
        } catch (cause) {
          throw new Error("This guide link contains invalid compressed data.", { cause });
        }
      } else {
        chunk = await reader.read();
      }
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > maximum) {
        await reader.cancel();
        throw new Error(overflowMessage);
      }
      chunks.push(chunk.value);
    }
  } finally {
    reader.releaseLock();
  }
  const result = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

export async function encodeGuide(input) {
  const guide = validateGuide(input);
  if (!guide.steps.length) throw new Error("Add at least one session before sharing your guide.");
  if (typeof globalThis.CompressionStream !== "function") {
    throw new Error("This browser cannot create guide links: native compression is unavailable. Use a current browser.");
  }
  const bytes = new TextEncoder().encode(JSON.stringify(guide));
  if (bytes.byteLength > MAX_PAYLOAD_BYTES) {
    throw new Error("This guide contains too much session data. Shorten notes or use fewer sessions.");
  }
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream("deflate"));
  const compressed = await collectBytes(stream, MAX_COMPRESSED_BYTES, TOO_LONG);
  return `1.${base64URL(compressed)}`;
}

export async function decodeGuide(token) {
  if (typeof token !== "string") throw new Error("A guide link must contain a text token.");
  if (token.length > GUIDE_LIMITS.url) {
    throw new Error("This guide link is too large to open. Shorten notes or use fewer sessions.");
  }
  const match = /^(\d+)\.([A-Za-z0-9_-]+)$/.exec(token);
  if (!match) throw new Error("This guide link has an invalid token format.");
  if (match[1] !== "1") throw new Error("This guide link uses an unsupported version.");
  if (typeof globalThis.DecompressionStream !== "function") {
    throw new Error("This browser cannot open guide links: native decompression is unavailable. Use a current browser.");
  }
  const compressed = fromBase64URL(match[2]);
  const stream = new Blob([compressed]).stream().pipeThrough(new DecompressionStream("deflate"));
  const bytes = await collectBytes(stream, MAX_PAYLOAD_BYTES,
    "This guide link expands beyond the 256 KB safety limit.", true);
  let json;
  try {
    json = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch (cause) {
    throw new Error("This guide link does not contain valid UTF-8 text.", { cause });
  }
  let guide;
  try {
    guide = JSON.parse(json);
  } catch (cause) {
    throw new Error("This guide link does not contain valid JSON guide data.", { cause });
  }
  return validateGuide(guide);
}

export async function createShareURL(baseURL, guide) {
  let result;
  try {
    result = new URL(baseURL);
  } catch (cause) {
    throw new Error("A valid absolute site URL is required to share a guide.", { cause });
  }
  if (!["https:", "http:"].includes(result.protocol) || result.username || result.password) {
    throw new Error("Guide links require an HTTP or HTTPS site URL without account credentials.");
  }
  result.search = "";
  result.hash = "";
  result.searchParams.set("guide", await encodeGuide(guide));
  result.hash = "my-guide";
  if (result.href.length > GUIDE_LIMITS.url) throw new Error(TOO_LONG);
  return result.href;
}
