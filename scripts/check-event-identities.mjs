// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { execFileSync } from "node:child_process";
import { access, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

export function publishedEventPaths(paths, readSource) {
  return paths.filter((path) => /^content\/events\/[a-z0-9]+(?:-[a-z0-9]+)*\/index\.md$/.test(path))
    .filter((path) => {
      const source = readSource(path);
      const delimiter = source.startsWith("---") ? "---" : source.startsWith("+++") ? "+++" : null;
      if (!delimiter) throw new Error(`Unsupported front matter in historical event ${path}.`);
      const end = source.indexOf(`\n${delimiter}`, delimiter.length);
      if (end < 0) throw new Error(`Invalid historical front matter in ${path}.`);
      const frontMatter = source.slice(delimiter.length, end);
      return !/^\s*draft\s*[:=]\s*true\s*(?:#.*)?$/m.test(frontMatter);
    });
}

export function removedPublishedEvents(previous, current) {
  const present = new Set(current);
  return previous.filter((path) => !present.has(path));
}

async function main() {
  const base = process.env.EVENTS_BASE_REF;
  if (!base || !/^[a-f0-9]{40}$/i.test(base)) throw new Error("EVENTS_BASE_REF must be the full base commit SHA.");
  if (/^0{40}$/.test(base)) {
    console.log("Initial push: no previously published event identities.");
    return;
  }
  const root = fileURLToPath(new URL("../", import.meta.url));
  const git = (args) => execFileSync("git", args, { cwd: root, encoding: "utf8" });
  const paths = git(["ls-tree", "-r", "--name-only", base, "--", "content/events"]).split("\n").filter(Boolean);
  const previous = publishedEventPaths(paths, (path) => git(["show", `${base}:${path}`]));
  const current = [];
  for (const path of previous) {
    try { await access(resolve(root, path)); current.push(path); }
    catch (error) { if (error.code !== "ENOENT") throw error; }
  }
  const removed = removedPublishedEvents(previous, current);
  if (removed.length) throw new Error(`Published event identities cannot be deleted or renamed; archive them in place: ${removed.join(", ")}`);
  for (const path of current) {
    const source = await readFile(resolve(root, path), "utf8");
    if (/^\s*draft\s*[:=]\s*true\s*(?:#.*)?$/m.test(source)) {
      throw new Error(`Published event ${path} cannot be hidden by marking it as a draft.`);
    }
  }
  console.log(`Preserved ${previous.length} existing published event identities.`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
