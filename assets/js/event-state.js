// Copyright (c) Microsoft Corporation. Licensed under the MIT license.

import { LEGACY_EVENT_ID, validateEventId } from "./event-context.js";
import { GUIDE_LIMITS, getGuideEventId, validateGuide } from "./guides.js";

const LEGACY_KEYS = Object.freeze({
  agenda: "ignite-field-guide:agenda:v1",
  draft: "ignite-field-guide:draft:v1",
});

export function eventStorageKeys(eventId) {
  validateEventId(eventId);
  const prefix = `ms-events-guide:${eventId}`;
  return {
    agenda: `${prefix}:agenda:v1`,
    draft: `${prefix}:draft:v1`,
    agendaMigration: `${prefix}:agenda:legacy-migrated:v1`,
    draftMigration: `${prefix}:draft:legacy-migrated:v1`,
  };
}

export function eventStorageLockName(eventId) {
  validateEventId(eventId);
  return `ms-events-guide:${eventId}:storage`;
}

const defaultWarning = (message) => console.warn(message);

// Writers must use the same lock as migration; localStorage has no compare-and-set.
export async function withEventStorageLock(eventId, callback, {
  locks = globalThis.navigator?.locks, onWarning = defaultWarning,
} = {}) {
  const name = eventStorageLockName(eventId);
  if (!locks || typeof locks.request !== "function") {
    onWarning("Safe cross-tab storage coordination is unavailable. Changes may conflict with another tab.");
    return callback();
  }
  return locks.request(name, { mode: "exclusive" }, callback);
}

export function validateStoredAgenda(raw) {
  const parsed = JSON.parse(raw);
  if (!parsed || typeof parsed !== "object" || parsed.version !== 1 ||
      !Array.isArray(parsed.ids) || parsed.ids.some((id) => typeof id !== "string")) {
    throw new Error("Saved agenda data is not in the expected format.");
  }
  return parsed;
}

export function validateStoredDraft(raw, eventId = LEGACY_EVENT_ID) {
  const parsed = JSON.parse(raw);
  if (!parsed || typeof parsed !== "object" || typeof parsed.title !== "string" ||
      parsed.title.length > GUIDE_LIMITS.title) {
    throw new Error("Saved guide draft is not in the expected format.");
  }
  const guide = validateGuide({ ...parsed, title: parsed.title.trim() ? parsed.title : "Untitled guide" });
  if (getGuideEventId(guide) !== eventId) throw new Error("Saved guide belongs to another event.");
  return parsed;
}

export async function migrateLegacyStorage(eventId, storage, {
  locks = globalThis.navigator?.locks, onWarning = defaultWarning,
} = {}) {
  const keys = eventStorageKeys(eventId);
  const result = { agenda: "not-applicable", draft: "not-applicable" };
  if (eventId !== LEGACY_EVENT_ID) return result;
  if (!locks || typeof locks.request !== "function") {
    onWarning("Legacy Ignite data was not migrated because safe cross-tab storage coordination is unavailable.");
    return { agenda: "uncoordinated", draft: "uncoordinated" };
  }
  try {
    return await locks.request(eventStorageLockName(eventId), { mode: "exclusive" }, () => {
      for (const kind of ["agenda", "draft"]) {
        try {
          if (storage.getItem(keys[`${kind}Migration`]) !== null) {
            result[kind] = "already-migrated";
            continue;
          }
          const destination = storage.getItem(keys[kind]);
          const validate = kind === "agenda" ? validateStoredAgenda : validateStoredDraft;
          if (destination !== null) {
            validate(destination);
            storage.setItem(keys[`${kind}Migration`], "1");
            result[kind] = "existing";
            continue;
          }
          const source = storage.getItem(LEGACY_KEYS[kind]);
          if (source === null) {
            result[kind] = "no-source";
            continue;
          }
          const parsed = validate(source);
          if (parsed.version !== 1) throw new Error("Legacy data must use version 1.");
          storage.setItem(keys[kind], source);
          if (storage.getItem(keys[kind]) !== source) throw new Error("The destination could not be verified.");
          storage.setItem(keys[`${kind}Migration`], "1");
          result[kind] = "migrated";
        } catch (error) {
          result[kind] = "failed";
          onWarning(`Your previous ${kind} could not be migrated (${error.name}). The original data was preserved; migration can be retried.`);
        }
      }
      return result;
    });
  } catch (error) {
    onWarning(`Legacy Ignite data could not be migrated safely (${error.name}). The original data was preserved.`);
    return { agenda: "failed", draft: "failed" };
  }
}
