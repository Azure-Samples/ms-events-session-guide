// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { publishedEventPaths, removedPublishedEvents } from "../scripts/check-event-identities.mjs";

test("published identity guard excludes drafts but rejects removal or renaming", () => {
  const a = "content/events/one-2026/index.md";
  const b = "content/events/two-2027/index.md";
  const sources = new Map([
    [a, "---\ntitle: One\nparams:\n  eventId: one-2026\n---\n"],
    [b, "---\ntitle: Draft\ndraft: true # not published\n---\n"],
  ]);
  const previous = publishedEventPaths([a, b, "content/events/_index.md"], (path) => sources.get(path));
  assert.deepEqual(previous, [a]);
  assert.deepEqual(removedPublishedEvents(previous, [a, "content/events/new-event/index.md"]), []);
  assert.deepEqual(removedPublishedEvents(previous, [b]), [a]);
  assert.throws(() => publishedEventPaths([a], () => "invalid front matter"), /front matter/);
});

test("analytics catalog export deduplicates sessions and preserves event/version identity", async () => {
  const root = await mkdtemp(join(tmpdir(), "events-analytics-"));
  try {
    const directory = join(root, "data", "events");
    await mkdir(join(directory, "one-2026"), { recursive: true });
    const event = { id: "one-2026", name: "One", catalogVersion: "abc123" };
    await writeFile(join(directory, "manifest.abc123.json"), JSON.stringify({ events: [event] }));
    await writeFile(join(directory, "one-2026", "catalog.abc123.json"), JSON.stringify({
      event,
      instances: [
        { id: "a", sessionId: "s1", code: "ONE1", title: "First" },
        { id: "b", sessionId: "s1", code: "ONE1", title: "First" },
        { id: "c", sessionId: "s2", code: "ONE2", title: "Second" },
      ],
    }));
    const script = fileURLToPath(new URL("../scripts/export-analytics-catalog.mjs", import.meta.url));
    const output = JSON.parse(execFileSync(process.execPath, [script, root], { encoding: "utf8" }));
    assert.equal(output.sessions.length, 2);
    assert.deepEqual(output.sessions[0], {
      eventId: event.id, eventName: event.name, catalogVersion: event.catalogVersion,
      sessionId: "s1", sessionCode: "ONE1", sessionTitle: "First",
    });

    test("the privacy DCR strips profile columns only from AppEvents without filtering business actions", async () => {
      const template = JSON.parse(await readFile(new URL("../infra/privacy-transform.json", import.meta.url), "utf8"));
      assert.equal(template.resources.length, 1);
      const rule = template.resources[0];
      assert.equal(rule.type, "Microsoft.Insights/dataCollectionRules");
      assert.equal(rule.kind, "WorkspaceTransforms");
      assert.deepEqual(rule.properties.dataSources, {});
      const [flow] = rule.properties.dataFlows;
      assert.deepEqual(flow.streams, ["Microsoft-Table-AppEvents"]);
      for (const column of ["ClientBrowser", "ClientOS", "ClientModel", "UserId", "SessionId", "OperationId"]) {
        assert.ok(flow.transformKql.includes(column));
      }
      assert.ok(!flow.transformKql.includes("| where"));
      assert.ok(!flow.transformKql.includes("Properties"));
      const core = JSON.parse(await readFile(new URL("../infra/monitoring.json", import.meta.url), "utf8"));
      const workspace = core.resources.find((resource) => resource.type === "Microsoft.OperationalInsights/workspaces");
      assert.ok(workspace.properties.includes("defaultDataCollectionRuleResourceId"));
    });
    await writeFile(join(directory, "manifest.def456.json"), "{}");
    assert.throws(() => execFileSync(process.execPath, [script, root], { stdio: "pipe" }), /Command failed/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
