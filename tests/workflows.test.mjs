import test from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";

function assertPinnedActions(source, filename) {
  const references = [...source.matchAll(/^\s*(?:-\s*)?uses:\s*(\S+)/gm)]
    .map((match) => match[1].replace(/^(['"])(.*)\1$/, "$2"));
  for (const reference of references) {
    if (reference.startsWith("./")) continue;
    const pinned = reference.startsWith("docker://") ?
      /^docker:\/\/[^@\s]+@sha256:[a-f0-9]{64}$/.test(reference) :
      /^[^@\s]+@[a-f0-9]{40}$/.test(reference);
    assert.ok(pinned, `${filename}: action ${reference} must use a full commit SHA (or a Docker SHA-256 digest)`);
  }
  return references.length;
}

test("all workflow and local composite action references are immutable", async () => {
  const root = new URL("../.github/", import.meta.url);
  const files = await readdir(root, { recursive: true });
  let count = 0;
  for (const file of files.filter((file) => /\.ya?ml$/.test(file))) {
    count += assertPinnedActions(await readFile(new URL(file, root), "utf8"), file);
  }
  assert.ok(count > 0, "Expected at least one action reference");
});

test("action pinning guard rejects mutable and abbreviated refs", () => {
  for (const reference of [
    "actions/checkout@v4", "actions/checkout@main", "actions/checkout@latest",
    "actions/checkout@11d5960", "actions/checkout", "docker://alpine:latest",
  ]) {
    assert.throws(() => assertPinnedActions(`  - uses: ${reference}`, "example.yml"), /must use a full commit SHA/);
  }
  const sha = "a".repeat(40);
  assert.equal(assertPinnedActions(`- uses: "actions/checkout@${sha}" # version\n- uses: ./.github/actions/local`, "example.yml"), 2);
  assert.equal(assertPinnedActions(`- uses: docker://alpine@sha256:${"b".repeat(64)}`, "example.yml"), 1);
});
