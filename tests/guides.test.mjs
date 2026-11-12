import assert from "node:assert/strict";
import test from "node:test";
import { deflateSync } from "node:zlib";
import {
  GUIDE_LIMITS, snapshotSession, validateGuide, getGuideEventId, encodeGuide, decodeGuide, createShareURL,
} from "../assets/js/guides.js";

function session(overrides = {}) {
  return {
    id: "session-1-instance-1",
    sessionId: "session-1",
    code: "BRK101",
    title: "Build with AI — 開発者向け 🌏",
    description: "A complete description.\nRésumé, café, 中文, العربية, and 🚀.",
    speakers: "Zoë García, 山田 太郎",
    type: "Breakout",
    level: "Intermediate",
    topics: ["AI", "Developer tools"],
    delivery: ["In person", "Online"],
    audiences: ["Developers"],
    viewing: ["Live", "On demand"],
    start: "2026-11-17T10:00:00-08:00",
    end: "2026-11-17T10:45:00-08:00",
    duration: 45,
    location: "Moscone West — Room 會議室 3",
    ...overrides,
  };
}

function guide(overrides = {}) {
  return {
    version: 1,
    title: "My Ignite field guide 🌟",
    summary: "First line.\n第二行 — bring questions.",
    steps: [{ session: session(), note: "Why attend:\nLearn, then discuss with Zoë. 👩🏽‍💻" }],
    ...overrides,
  };
}

function encodedBytes(bytes) {
  return `1.${deflateSync(bytes).toString("base64url")}`;
}

function rawToken(value) {
  return encodedBytes(new TextEncoder().encode(JSON.stringify(value)));
}

function distinctSteps(count, overrides = {}) {
  return Array.from({ length: count }, (_, index) => ({
    session: session({ id: `instance-${index}`, sessionId: `session-${index}`, ...overrides }),
    note: "",
  }));
}

function noisyText(length) {
  let state = 0x12345678;
  const alphabet = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_";
  return Array.from({ length }, () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return alphabet[(state >>> 0) % alphabet.length];
  }).join("");
}

test("exports the documented guide limits", () => {
  assert.deepEqual(GUIDE_LIMITS, { steps: 20, title: 100, summary: 600, note: 600, url: 7500 });
  assert.ok(Object.isFrozen(GUIDE_LIMITS));
});

test("snapshots preserve all facts, prune extra fields, and detach from their source", () => {
  const original = session({ searchText: "private implementation detail", arbitrary: { nested: true } });
  const expected = session();
  const snapshot = snapshotSession(original);
  assert.deepEqual(snapshot, expected);
  assert.notEqual(snapshot, original);
  assert.ok(Object.isFrozen(snapshot));
  for (const field of ["topics", "delivery", "audiences", "viewing"]) {
    assert.notEqual(snapshot[field], original[field]);
    assert.ok(Object.isFrozen(snapshot[field]));
    original[field].push("Changed");
  }
  original.title = "Renamed";
  original.description = "Deleted original description";
  original.start = "";
  original.location = "Elsewhere";
  assert.deepEqual(snapshot, expected);
  assert.throws(() => { snapshot.title = "Cannot mutate"; }, TypeError);
});

test("validation returns only canonical fields and trims only the guide title", () => {
  const input = guide({
    title: "  An intentionally spaced title  ",
    summary: "  Summary stays spaced.\r\nSecond line.\n",
    unrelated: { unsafe: "not retained" },
    steps: [{
      session: session({ title: "  Exact session title  ", extra: "not retained" }),
      note: "  Why attend.\r\nSecond line.\n",
      extra: "not retained",
    }],
  });
  Object.defineProperty(input, "__proto__", { value: { polluted: true }, enumerable: true });
  const result = validateGuide(input);
  assert.deepEqual(Object.keys(result), ["version", "title", "summary", "steps"]);
  assert.deepEqual(Object.keys(result.steps[0]), ["session", "note"]);
  assert.equal(result.title, "An intentionally spaced title");
  assert.equal(result.summary, input.summary);
  assert.equal(result.steps[0].note, input.steps[0].note);
  assert.equal(result.steps[0].session.title, input.steps[0].session.title);
  assert.equal(Object.getPrototypeOf(result), Object.prototype);
  assert.equal(result.steps[0].session.extra, undefined);
  assert.equal(input.title, "  An intentionally spaced title  ");
});

test("Unicode, time zones, complete snapshots, step order, and notes round-trip exactly", async () => {
  const input = guide({
    steps: [
      { session: session(), note: "Go here first.\n👩🏽‍💻: meet colleagues." },
      {
        session: session({
          id: "second-instance", sessionId: "second-session", title: "Développement — مرحبًا",
          start: "2026-11-17T19:00:00.123Z", end: "2026-11-17T20:00:00.123Z", duration: 60,
        }),
        note: "Then attend this session.\r\nAsk about 日本語.",
      },
    ],
  });
  const canonical = validateGuide(input);
  const token = await encodeGuide(input);
  assert.match(token, /^1\.[A-Za-z0-9_-]+$/);
  input.steps[0].session.title = "Catalog changed after link creation";
  input.steps[0].session.topics.push("New catalog topic");
  input.steps[0].note = "Changed locally";
  assert.deepEqual(await decodeGuide(token), canonical);
});

test("unscheduled sessions and optional audiences have canonical empty values", async () => {
  const unscheduled = session({ start: "", end: "", duration: 0, location: "" });
  delete unscheduled.audiences;
  const input = guide({ steps: [{ session: unscheduled, note: "" }] });
  const decoded = await decodeGuide(await encodeGuide(input));
  assert.deepEqual(decoded.steps[0].session, { ...unscheduled, audiences: [] });
  assert.equal(decoded.steps[0].session.start, "");
  assert.equal(decoded.steps[0].session.end, "");
});

test("plain text, including HTML-like text, is data rather than markup", async () => {
  const input = guide({
    title: "<b>Attend</b>",
    summary: "<script>alert('not executed')</script>",
    steps: [{ session: session({ description: "<img src=x onerror=alert(1)>" }), note: "<a>Why</a>" }],
  });
  assert.deepEqual(await decodeGuide(await encodeGuide(input)), validateGuide(input));
});

test("drafts may be empty but cannot be encoded or shared", async () => {
  const draft = guide({ steps: [] });
  assert.deepEqual(validateGuide(draft), draft);
  await assert.rejects(encodeGuide(draft), /add at least one session/i);
  await assert.rejects(createShareURL("https://example.github.io/ignite/", draft), /add at least one session/i);
});

test("rejects malformed guide and step structures with UI-safe errors", () => {
  for (const input of [null, [], "guide", 1, new Date(), new Map()]) {
    assert.throws(() => validateGuide(input), /plain object/i);
  }
  for (const input of [
    guide({ title: null }), guide({ title: " \n " }), guide({ summary: [] }),
    guide({ steps: null }), guide({ steps: {} }), guide({ steps: [null] }),
    guide({ steps: [[]] }), guide({ steps: new Array(1) }),
    guide({ steps: [{ session: [], note: "" }] }),
    guide({ steps: [{ session: session(), note: null }] }),
  ]) {
    assert.throws(() => validateGuide(input), Error);
  }
  for (const version of [undefined, null, "1", 0, 3]) {
    assert.throws(() => validateGuide(guide({ version })), /unsupported guide version/i);
  }
});

test("allows twenty steps and rejects more or repeated session IDs across instances", () => {
  assert.equal(validateGuide(guide({ steps: distinctSteps(20) })).steps.length, 20);
  assert.throws(() => validateGuide(guide({ steps: distinctSteps(21) })), /at most 20/i);
  const repeated = [
    { session: session(), note: "" },
    { session: session({ id: "another-instance-of-same-session" }), note: "" },
  ];
  assert.throws(() => validateGuide(guide({ steps: repeated })), /same session more than once/i);
});

test("rejects invalid identifiers without echoing untrusted content", () => {
  for (const field of ["id", "sessionId"]) {
    for (const value of ["", " ", "bad/id", "../id", "<script>unsafe</script>", "id\n", 12, null]) {
      assert.throws(() => snapshotSession(session({ [field]: value })), (error) => {
        assert.ok(error instanceof Error);
        assert.doesNotMatch(error.message, /<script>/);
        return true;
      });
    }
  }
  assert.equal(snapshotSession(session({ id: "ABC_123:part.2-3" })).id, "ABC_123:part.2-3");
});

test("rejects missing, non-string, and oversized session text", () => {
  const fields = {
    id: 200, sessionId: 200, code: 100, title: 500, description: 8000,
    speakers: 2000, type: 200, level: 200, location: 1000,
  };
  for (const [field, maximum] of Object.entries(fields)) {
    assert.throws(() => snapshotSession(session({ [field]: "a".repeat(maximum + 1) })), /at most/i);
    for (const value of [undefined, null, 1, [], {}]) {
      assert.throws(() => snapshotSession(session({ [field]: value })), /must be text/i);
    }
  }
  for (const field of ["code", "title"]) {
    assert.throws(() => snapshotSession(session({ [field]: " \t " })), /cannot be empty/i);
  }
  const snapshot = snapshotSession(session({ description: "a".repeat(8000), title: "a".repeat(500) }));
  assert.equal(snapshot.description.length, 8000);
  assert.equal(snapshot.title.length, 500);
});

test("enforces title, summary, and note limits while preserving allowed line breaks", () => {
  assert.equal(validateGuide(guide({ title: "x".repeat(100) })).title.length, 100);
  assert.equal(validateGuide(guide({ summary: "x\n".repeat(300) })).summary.length, 600);
  assert.throws(() => validateGuide(guide({ title: "x".repeat(101) })), /title.*100/i);
  assert.throws(() => validateGuide(guide({ summary: "x".repeat(601) })), /summary.*600/i);
  assert.throws(() => validateGuide(guide({
    steps: [{ session: session(), note: "x".repeat(601) }],
  })), /note.*600/i);
  assert.equal(validateGuide(guide({
    steps: [{ session: session(), note: "x\n".repeat(300) }],
  })).steps[0].note.length, 600);
});

test("validates all label lists and copies only bounded text items", () => {
  for (const field of ["topics", "delivery", "audiences", "viewing"]) {
    for (const value of [null, {}, "AI", [42], [null], [[]], [""], ["a".repeat(201)], new Array(1)]) {
      assert.throws(() => snapshotSession(session({ [field]: value })), Error);
    }
    assert.throws(() => snapshotSession(session({ [field]: Array(51).fill("a") })), /at most 50/i);
    assert.equal(snapshotSession(session({ [field]: Array(50).fill("a") }))[field].length, 50);
  }
  for (const field of ["topics", "delivery", "viewing"]) {
    assert.throws(() => snapshotSession(session({ [field]: undefined })), /must be a list/i);
  }
});

test("rejects malformed dates, impossible calendar dates, and non-positive ranges", () => {
  for (const start of [
    "tomorrow", "2026-11-17", "2026-11-17T10:00:00", "2026-11-17 10:00:00Z",
    "2026-02-29T10:00:00Z", "2026-02-30T10:00:00Z", "2026-04-31T10:00:00Z",
    "2026-00-17T10:00:00Z", "2026-13-17T10:00:00Z", "2026-11-00T10:00:00Z",
    "2026-11-17T24:00:00Z", "2026-11-17T10:60:00Z", "2026-11-17T10:00:60Z",
    "2026-11-17T10:00:00+24:00", "2026-11-17T10:00:00+00:60", "0000-01-01T10:00:00Z",
    "2026-11-17T10:00:00Z\n", null, 1794938400000,
  ]) {
    assert.throws(() => snapshotSession(session({ start })), /date|time|text/i);
  }
  for (const overrides of [
    { start: "" }, { end: "" },
    { end: "2026-11-17T10:00:00-08:00" }, { end: "2026-11-17T09:00:00-08:00" },
  ]) {
    assert.throws(() => snapshotSession(session(overrides)), /positive time range/i);
  }
  assert.equal(snapshotSession(session({
    start: "2028-02-29T10:00:00Z", end: "2028-02-29T11:00:00Z",
  })).start, "2028-02-29T10:00:00Z");
});

test("requires a finite, nonnegative, bounded integer duration", () => {
  for (const duration of [undefined, null, "45", -1, 0.5, 1441, NaN, Infinity, {}]) {
    assert.throws(() => snapshotSession(session({ duration })), /duration/i);
  }
});

test("rejects malformed token formats, noncanonical base64url, and unsupported versions", async () => {
  for (const value of [undefined, null, 1, [], {}]) {
    await assert.rejects(decodeGuide(value), /text token/i);
  }
  for (const token of ["", "1", "1.", "1.abc=", "1.a+b", "1.a/b", "1.a.b", " 1.abc", "1.abc\n"]) {
    await assert.rejects(decodeGuide(token), /invalid token format/i);
  }
  for (const token of ["3.eJw", "01.eJw", "999.eJw"]) {
    await assert.rejects(decodeGuide(token), /unsupported version/i);
  }
  for (const token of ["1.a", "1.Zh", "1.Zm9"]) {
    await assert.rejects(decodeGuide(token), /invalid base64url/i);
  }
});

test("rejects oversize encoded tokens before base64 decoding", async (t) => {
  const atob = t.mock.method(globalThis, "atob", () => {
    throw new Error("base64 decoding must not run");
  });
  await assert.rejects(decodeGuide(`1.${"a".repeat(GUIDE_LIMITS.url)}`), /too large to open/i);
  assert.equal(atob.mock.callCount(), 0);
});

test("reports invalid deflate, invalid UTF-8, and invalid JSON separately", async () => {
  await assert.rejects(decodeGuide("1.bm90IGRlZmxhdGU"), /invalid compressed data/i);
  const truncated = deflateSync(new TextEncoder().encode(JSON.stringify(guide()))).subarray(0, -3);
  await assert.rejects(decodeGuide(`1.${truncated.toString("base64url")}`), /invalid compressed data/i);
  await assert.rejects(decodeGuide(encodedBytes(Uint8Array.of(0xff, 0xfe))), /valid UTF-8/i);
  await assert.rejects(decodeGuide(encodedBytes(new TextEncoder().encode("{invalid json"))), /valid JSON/i);
});

test("validates decompressed shape and version instead of trusting compressed JSON", async () => {
  for (const value of [null, [], "guide", guide({ steps: {} }), guide({ summary: 123 })]) {
    await assert.rejects(decodeGuide(rawToken(value)), Error);
  }
  await assert.rejects(decodeGuide(rawToken(guide({ version: 3 }))), /unsupported guide version/i);
  await assert.rejects(decodeGuide(rawToken(guide({ steps: distinctSteps(21) }))), /at most 20/i);
  await assert.rejects(decodeGuide(rawToken(guide({
    steps: [{ session: session(), note: "" }, { session: session({ id: "other-instance" }), note: "" }],
  }))), /same session/i);
});

test("v1 retains its exact shape and identifies Ignite; v2 carries a validated event", async () => {
  const legacy = guide();
  assert.equal(getGuideEventId(legacy), "ignite-2026");
  assert.deepEqual(await decodeGuide(await encodeGuide(legacy)), validateGuide(legacy));
  const input = guide({ version: 2, eventId: "build-2027" });
  const expected = validateGuide(input);
  const token = await encodeGuide(input);
  assert.match(token, /^2\./);
  assert.equal(getGuideEventId(await decodeGuide(token)), "build-2027");
  assert.deepEqual(await decodeGuide(token), expected);
  assert.ok(Object.isFrozen(expected.steps[0].session));
  assert.deepEqual(Object.keys(expected), ["version", "eventId", "title", "summary", "steps"]);
  const shared = await createShareURL("https://example.test/events/build-2027/", input);
  assert.equal(getGuideEventId(await decodeGuide(new URL(shared).searchParams.get("guide"))), "build-2027");
});

test("v2 rejects invalid identities and mismatched token/payload versions", async () => {
  for (const eventId of [undefined, "", "a".repeat(81), "Build-2027", "a:b", "../a",
    "https://example.com", "a--b", "a\n", null]) {
    assert.throws(() => validateGuide(guide({ version: 2, eventId })), /event id/i);
  }
  assert.throws(() => getGuideEventId(guide({ version: 2, eventId: "https://example.com" })), /event id/i);
  const token = await encodeGuide(guide({ version: 2, eventId: "foreign-event" }));
  await assert.rejects(decodeGuide(`1.${token.slice(2)}`), /mismatched version/i);
  await assert.rejects(decodeGuide(`2.${rawToken(guide()).slice(2)}`), /mismatched version/i);
});

test("v2 shares enforce creation URL and decompression bounds", async () => {
  const input = guide({ version: 2, eventId: "build-2027" });
  const token = await encodeGuide(input);
  const origin = "https://example.test/";
  const suffix = `?guide=${token}#my-guide`;
  const base = origin + "a".repeat(GUIDE_LIMITS.url - origin.length - suffix.length);
  assert.equal((await createShareURL(base, input)).length, GUIDE_LIMITS.url);
  await assert.rejects(createShareURL(`${base}a`, input), /too long/i);
  const large = { ...input, ignoredPadding: "x".repeat(256 * 1024) };
  await assert.rejects(decodeGuide(`2.${rawToken(large).slice(2)}`), /256 KB safety limit/i);
  await assert.rejects(decodeGuide(`2.${rawToken({ ...input, eventId: "https://evil.test" }).slice(2)}`), /event id/i);
});

test("bounds streamed decompression at 256 KB, even for highly compressed ignored fields", async () => {
  const maximum = 256 * 1024;
  const input = { ...guide(), ignoredPadding: "" };
  const overhead = new TextEncoder().encode(JSON.stringify(input)).byteLength;
  input.ignoredPadding = "x".repeat(maximum - overhead);
  assert.equal(new TextEncoder().encode(JSON.stringify(input)).byteLength, maximum);
  assert.deepEqual(await decodeGuide(rawToken(input)), validateGuide(guide()));
  input.ignoredPadding += "x";
  const token = rawToken(input);
  assert.ok(token.length < GUIDE_LIMITS.url);
  await assert.rejects(decodeGuide(token), /256 KB safety limit/i);
  input.ignoredPadding = "x".repeat(2 * 1024 * 1024);
  await assert.rejects(decodeGuide(rawToken(input)), /256 KB safety limit/i);
});

test("bounds UTF-8 encoding size and rejects oversize compressed output", async () => {
  await assert.rejects(encodeGuide(guide({
    steps: distinctSteps(20, { description: "🌏".repeat(4000) }),
  })), /too much session data.*shorten notes or use fewer sessions/i);
  const noise = noisyText(16000);
  const input = guide({
    steps: [
      { session: session({ description: noise.slice(0, 8000) }), note: "" },
      { session: session({ id: "other", sessionId: "other", description: noise.slice(8000) }), note: "" },
    ],
  });
  await assert.rejects(encodeGuide(input), /too long.*shorten notes or use fewer sessions/i);
  await assert.rejects(createShareURL("https://example.github.io/ignite/", input),
    /too long.*shorten notes or use fewer sessions/i);
});

test("share URLs preserve GitHub Pages origins and subpaths while clearing all old state", async () => {
  const base = new URL("https://example.github.io/2026_microsoft_ignite_guide/?q=ai&guide=stale&day=17#old");
  const original = base.href;
  const shared = new URL(await createShareURL(base, guide()));
  assert.equal(base.href, original);
  assert.equal(shared.origin, base.origin);
  assert.equal(shared.pathname, "/2026_microsoft_ignite_guide/");
  assert.equal(shared.hash, "#my-guide");
  assert.deepEqual([...shared.searchParams.keys()], ["guide"]);
  assert.deepEqual(await decodeGuide(shared.searchParams.get("guide")), validateGuide(guide()));
  assert.ok(shared.href.length <= GUIDE_LIMITS.url);
  const local = new URL(await createShareURL("http://127.0.0.1:1313/nested/index.html?debug=true#agenda", guide()));
  assert.equal(local.origin, "http://127.0.0.1:1313");
  assert.equal(local.pathname, "/nested/index.html");
  assert.equal(local.hash, "#my-guide");
});

test("checks the full serialized URL length, allowing the exact 7500-character boundary", async () => {
  const input = guide();
  const token = await encodeGuide(input);
  const origin = "https://example.github.io/";
  const suffix = `?guide=${token}#my-guide`;
  const base = origin + "a".repeat(GUIDE_LIMITS.url - origin.length - suffix.length);
  assert.equal((await createShareURL(base, input)).length, GUIDE_LIMITS.url);
  await assert.rejects(createShareURL(`${base}a`, input), /too long.*shorten notes or use fewer sessions/i);
  const legacy = new URL(await createShareURL(base, input));
  legacy.pathname += "/events/ignite-2026/";
  assert.ok(legacy.href.length > GUIDE_LIMITS.url);
  assert.deepEqual(await decodeGuide(legacy.searchParams.get("guide")), validateGuide(input));
});

test("rejects invalid, non-web, and credential-bearing base URLs", async () => {
  await assert.rejects(createShareURL("/relative/", guide()), /valid absolute site URL/i);
  await assert.rejects(createShareURL("not a url", guide()), /valid absolute site URL/i);
  for (const base of ["javascript:alert(1)", "file:///local/index.html", "https://user:password@example.com/"]) {
    await assert.rejects(createShareURL(base, guide()), /HTTP or HTTPS site URL without account credentials/i);
  }
});

test("explicitly reports unsupported native browser compression", async (t) => {
  t.mock.property(globalThis, "CompressionStream", undefined);
  await assert.rejects(encodeGuide(guide()), /browser.*native compression is unavailable/i);
});

test("explicitly reports unsupported native browser decompression", async (t) => {
  const token = await encodeGuide(guide());
  t.mock.property(globalThis, "DecompressionStream", undefined);
  await assert.rejects(decodeGuide(token), /browser.*native decompression is unavailable/i);
});
