// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { readdir, readFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { validateEventId } from "../assets/js/event-context.js";

const output = resolve(process.argv[2] || "public");
const directory = join(output, "data", "events");
const manifests = (await readdir(directory)).filter((name) => /^manifest\.[a-f0-9]+\.json$/.test(name));
if (manifests.length !== 1) throw new Error("Build into a clean destination; expected exactly one event manifest.");
const manifest = JSON.parse(await readFile(join(directory, manifests[0]), "utf8"));
const dimensions = [];
for (const event of manifest.events) {
  validateEventId(event.id);
  const catalogs = (await readdir(join(directory, event.id))).filter((name) => /^catalog\.[a-f0-9]+\.json$/.test(name));
  if (catalogs.length !== 1) throw new Error(`Expected one generated catalog for ${event.id}.`);
  const catalog = JSON.parse(await readFile(join(directory, event.id, catalogs[0]), "utf8"));
  if (catalog.event?.id !== event.id || catalog.event.catalogVersion !== event.catalogVersion) {
    throw new Error(`Catalog identity/version mismatch for ${event.id}.`);
  }
  const seen = new Set();
  for (const instance of catalog.instances) {
    if (seen.has(instance.sessionId)) continue;
    seen.add(instance.sessionId);
    dimensions.push({
      eventId: event.id, eventName: event.name, catalogVersion: event.catalogVersion,
      sessionId: instance.sessionId, sessionCode: instance.code, sessionTitle: instance.title,
    });
  }
}
process.stdout.write(`${JSON.stringify({ version: 1, sessions: dimensions }, null, 2)}\n`);
