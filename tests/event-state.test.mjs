import test from "node:test";
import assert from "node:assert/strict";
import {
  eventStorageKeys, eventStorageLockName, migrateLegacyStorage, withEventStorageLock,
  validateStoredAgenda, validateStoredDraft,
} from "../assets/js/event-state.js";

class Storage {
  constructor(entries = {}) { this.data = new Map(Object.entries(entries)); this.fail = new Set(); }
  getItem(key) { return this.data.has(key) ? this.data.get(key) : null; }
  setItem(key, value) {
    if (this.fail.has(key)) throw Object.assign(new Error("quota"), { name: "QuotaExceededError" });
    this.data.set(key, String(value));
  }
  removeItem(key) { this.data.delete(key); }
}

class Locks {
  constructor() { this.tails = new Map(); }
  request(name, options, callback) {
    assert.equal(options.mode, "exclusive");
    const previous = this.tails.get(name) || Promise.resolve();
    const next = previous.catch(() => {}).then(callback);
    this.tails.set(name, next);
    return next;
  }
}

const oldAgenda = "ignite-field-guide:agenda:v1";
const oldDraft = "ignite-field-guide:draft:v1";
const agenda = JSON.stringify({ version: 1, ids: ["one", "repeat"] });
const emptyAgenda = JSON.stringify({ version: 1, ids: [] });
const draft = JSON.stringify({
  version: 1, title: "", summary: "Notes", steps: [{
    session: { id: "one", sessionId: "one", code: "BRK01", title: "Test", description: "",
      speakers: "", type: "", level: "", topics: [], delivery: [], viewing: [],
      start: "", end: "", duration: 0, location: "" }, note: "Keep",
  }],
});

test("untitled stored drafts preserve sessions and notes while enforcing event identity", () => {
  for (const title of ["", "   "]) {
    const input = { ...JSON.parse(draft), version: 2, eventId: "other-2027", title };
    const restored = validateStoredDraft(JSON.stringify(input), "other-2027");
    assert.deepEqual(restored, input);
    assert.equal(restored.steps[0].note, "Keep");
    assert.throws(() => validateStoredDraft(JSON.stringify(input), "ignite-2026"), /another event/);
  }
  assert.equal(validateStoredDraft(draft, "ignite-2026").title, "");
});

test("event storage names isolate events and reject invalid identifiers", () => {
  const ignite = eventStorageKeys("ignite-2026");
  const other = eventStorageKeys("other-2027");
  assert.equal(new Set([...Object.values(ignite), ...Object.values(other)]).size, 8);
  assert.notEqual(eventStorageLockName("ignite-2026"), eventStorageLockName("other-2027"));
  assert.throws(() => eventStorageKeys("../bad"), /slug/);
});

test("migration copies validated Ignite keys once, preserves originals and does not resurrect cleared data", async () => {
  const storage = new Storage({ [oldAgenda]: agenda, [oldDraft]: draft });
  const locks = new Locks();
  const keys = eventStorageKeys("ignite-2026");
  assert.deepEqual(await migrateLegacyStorage("ignite-2026", storage, { locks }),
    { agenda: "migrated", draft: "migrated" });
  assert.equal(storage.getItem(oldAgenda), agenda);
  assert.equal(storage.getItem(oldDraft), draft);
  assert.equal(storage.getItem(keys.agenda), agenda);
  assert.equal(storage.getItem(keys.draft), draft);
  storage.removeItem(keys.agenda);
  storage.removeItem(keys.draft);
  assert.deepEqual(await migrateLegacyStorage("ignite-2026", storage, { locks }),
    { agenda: "already-migrated", draft: "already-migrated" });
  assert.equal(storage.getItem(keys.agenda), null);
  assert.equal(storage.getItem(keys.draft), null);
});

test("foreign events do not import Ignite data even when IDs overlap", async () => {
  const storage = new Storage({ [oldAgenda]: agenda, [oldDraft]: draft });
  const result = await migrateLegacyStorage("other-2027", storage, { locks: new Locks() });
  assert.deepEqual(result, { agenda: "not-applicable", draft: "not-applicable" });
  assert.equal(storage.getItem(eventStorageKeys("other-2027").agenda), null);
});

test("existing empty destination state wins and receives durable markers", async () => {
  const keys = eventStorageKeys("ignite-2026");
  const emptyDraft = JSON.stringify({ version: 1, title: "", summary: "", steps: [] });
  const storage = new Storage({ [oldAgenda]: agenda, [oldDraft]: draft,
    [keys.agenda]: emptyAgenda, [keys.draft]: emptyDraft });
  const locks = new Locks();
  assert.deepEqual(await migrateLegacyStorage("ignite-2026", storage, { locks }),
    { agenda: "existing", draft: "existing" });
  assert.equal(storage.getItem(keys.agenda), emptyAgenda);
  assert.equal(storage.getItem(keys.draft), emptyDraft);
  storage.removeItem(keys.agenda);
  storage.removeItem(keys.draft);
  await migrateLegacyStorage("ignite-2026", storage, { locks });
  assert.equal(storage.getItem(keys.agenda), null);
  assert.equal(storage.getItem(keys.draft), null);
});

test("partial failures retry independently without overwriting a newer destination", async () => {
  const keys = eventStorageKeys("ignite-2026");
  const storage = new Storage({ [oldAgenda]: agenda, [oldDraft]: draft });
  const locks = new Locks();
  const warnings = [];
  storage.fail.add(keys.agenda);
  assert.deepEqual(await migrateLegacyStorage("ignite-2026", storage, { locks, onWarning: (x) => warnings.push(x) }),
    { agenda: "failed", draft: "migrated" });
  assert.equal(storage.getItem(keys.agendaMigration), null);
  assert.match(warnings[0], /quotaexceedederror/i);
  storage.fail.delete(keys.agenda);
  storage.setItem(keys.agenda, emptyAgenda);
  assert.deepEqual(await migrateLegacyStorage("ignite-2026", storage, { locks }),
    { agenda: "existing", draft: "already-migrated" });
  assert.equal(storage.getItem(keys.agenda), emptyAgenda);
});

test("marker failures retry without replacing the destination", async () => {
  const keys = eventStorageKeys("ignite-2026");
  const storage = new Storage({ [oldAgenda]: agenda });
  const locks = new Locks();
  storage.fail.add(keys.agendaMigration);
  const warnings = [];
  const result = await migrateLegacyStorage("ignite-2026", storage, { locks, onWarning: (x) => warnings.push(x) });
  assert.equal(result.agenda, "failed");
  assert.equal(storage.getItem(keys.agenda), agenda);
  storage.setItem(keys.agenda, emptyAgenda);
  storage.fail.delete(keys.agendaMigration);
  assert.equal((await migrateLegacyStorage("ignite-2026", storage, { locks })).agenda, "existing");
  assert.equal(storage.getItem(keys.agenda), emptyAgenda);
  assert.equal(warnings.length, 1);
});

test("invalid sources and destinations warn and remain untouched", async () => {
  const keys = eventStorageKeys("ignite-2026");
  const storage = new Storage({ [oldAgenda]: "{bad", [oldDraft]: draft, [keys.draft]: "{bad" });
  const warnings = [];
  assert.deepEqual(await migrateLegacyStorage("ignite-2026", storage,
    { locks: new Locks(), onWarning: (x) => warnings.push(x) }), { agenda: "failed", draft: "failed" });
  assert.equal(warnings.length, 2);
  assert.equal(storage.getItem(keys.agenda), null);
  assert.equal(storage.getItem(keys.draft), "{bad");
  assert.equal(storage.getItem(keys.draftMigration), null);
  assert.throws(() => validateStoredAgenda('{"version":1,"ids":[null]}'), /expected format/);
  assert.throws(() => validateStoredDraft(JSON.stringify({ version: 2, eventId: "other", title: "",
    summary: "", steps: [] })), /another event/);
});

test("without coordination migration refuses to overwrite and surfaces a warning", async () => {
  const storage = new Storage({ [oldAgenda]: agenda });
  const warnings = [];
  assert.deepEqual(await migrateLegacyStorage("ignite-2026", storage,
    { locks: null, onWarning: (x) => warnings.push(x) }), { agenda: "uncoordinated", draft: "uncoordinated" });
  assert.match(warnings[0], /coordination is unavailable/);
  assert.equal(storage.getItem(eventStorageKeys("ignite-2026").agenda), null);
});

test("coordinated concurrent migration and writes never overwrite newer state", async () => {
  const locks = new Locks();
  const keys = eventStorageKeys("ignite-2026");
  const storage = new Storage({ [oldAgenda]: agenda });
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  let started;
  const entered = new Promise((resolve) => { started = resolve; });
  const write = withEventStorageLock("ignite-2026", async () => {
    started();
    await gate;
    storage.setItem(keys.agenda, emptyAgenda);
  }, { locks });
  await entered;
  const migration = migrateLegacyStorage("ignite-2026", storage, { locks });
  release();
  await write;
  assert.equal((await migration).agenda, "existing");
  assert.equal(storage.getItem(keys.agenda), emptyAgenda);
});

test("lock and storage failures are explicit and retryable", async () => {
  const warnings = [];
  const locks = { request: () => Promise.reject(new Error("lock failure")) };
  assert.deepEqual(await migrateLegacyStorage("ignite-2026", new Storage(), { locks, onWarning: (x) => warnings.push(x) }),
    { agenda: "failed", draft: "failed" });
  assert.match(warnings[0], /could not be migrated safely/);
  await assert.rejects(withEventStorageLock("ignite-2026", () => {}, { locks }), /lock failure/);
});
