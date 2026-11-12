import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import full from "../playwright.config.mjs";
import smoke from "../playwright.smoke.config.mjs";

test("smoke is Chromium-only and cannot overwrite full-suite evidence", () => {
  assert.deepEqual(smoke.projects.map((project) => project.name), ["chromium"]);
  assert.equal(smoke.metadata.tier, "smoke");
  assert.equal(smoke.webServer.env.E2E_TIER, "smoke");
  assert.equal(full.metadata.tier, "full");
  assert.equal(full.webServer.env.E2E_TIER, "full");
  assert.notEqual(smoke.outputDir, full.outputDir);
  assert.notEqual(smoke.reporter.find(([name]) => name === "json")[1].outputFile,
    full.reporter.find(([name]) => name === "json")[1].outputFile);
  assert.equal(smoke.webServer.reuseExistingServer, false);
  assert.equal(full.webServer.reuseExistingServer, false);
  assert.equal(smoke.retries, 0);
  assert.equal(full.use.contextOptions.reducedMotion, "reduce");
});

function discover(config) {
  const report = JSON.parse(execFileSync(process.execPath, [
    "node_modules/@playwright/test/cli.js", "test", `--config=${config}`, "--list", "--reporter=json",
  ], { encoding: "utf8", timeout: 30_000 }));
  assert.deepEqual(report.errors, []);
  const tests = [];
  function visit(suite) {
    for (const spec of suite.specs || []) {
      for (const project of spec.tests) tests.push({ title: spec.title, project: project.projectName });
    }
    for (const child of suite.suites || []) visit(child);
  }
  for (const suite of report.suites) visit(suite);
  return tests;
}

test("actual smoke discovery stays small and selects genuine full-suite journeys", () => {
  const quick = discover("playwright.smoke.config.mjs");
  const complete = discover("playwright.config.mjs");
  assert.ok(quick.length >= 8 && quick.length <= 15, `Expected 8-15 smoke tests, got ${quick.length}`);
  assert.ok(complete.length > quick.length);
  assert.deepEqual(new Set(complete.map((entry) => entry.project)),
    new Set(["chromium", "firefox", "webkit", "mobile-chromium", "mobile-webkit"]));
  for (const entry of quick) {
    assert.equal(entry.project, "chromium");
    assert.ok(complete.some((candidate) => candidate.project === entry.project && candidate.title === entry.title));
  }
  for (const id of ["001", "010", "011", "012", "018", "022", "033", "050", "070", "073", "080", "082", "090"]) {
    assert.ok(quick.some((entry) => entry.title.includes(`E2E-${id}`)), `Missing critical E2E-${id}`);
  }
});

test("fast PR job combines code regressions with smoke, separate from the full browser matrix", async () => {
  const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  assert.equal(pkg.scripts["test:pr"], "npm test && npm run test:e2e:smoke");
  const workflow = await readFile(new URL("../.github/workflows/pages.yml", import.meta.url), "utf8");
  assert.match(workflow, /build:\n\s+runs-on: ubuntu-24\.04/);
  assert.match(workflow, /name: Code checks, Chromium smoke and build/);
  assert.match(workflow, /pull_request:/);
  assert.match(workflow, /run: npm test/);
  assert.match(workflow, /run: npm run test:e2e:smoke/);
  assert.doesNotMatch(workflow, /run: npm run test:e2e(?::full)?\s*$/m);
  assert.match(workflow, /npx playwright install --with-deps chromium\s*$/m);
});

test("full matrix reports native PR checks or runs on demand, never on a schedule", async () => {
  const workflow = await readFile(new URL("../.github/workflows/e2e.yml", import.meta.url), "utf8");
  assert.match(workflow, /regression:\n\s+runs-on: ubuntu-24\.04/);
  const triggers = workflow.split(/^on:\s*$/m)[1]?.split(/^permissions:/m)[0];
  assert.deepEqual([...triggers.matchAll(/^  ([a-z_]+):/gm)].map(([, event]) => event),
    ["pull_request", "workflow_dispatch"]);
  assert.match(workflow, /name: Browser E2E \(\$\{\{ matrix\.project \}\}\)/);
  assert.match(workflow, /run: npm run test:e2e:full/);
  assert.match(workflow, /contents: read/);
  assert.doesNotMatch(workflow, /pages: write|id-token: write|deploy-pages|pull_request_target/);
});

test("hosted full coverage isolates projects and bounds browser workers per runner", async () => {
  const workflow = await readFile(new URL("../.github/workflows/e2e.yml", import.meta.url), "utf8");
  const projects = [...workflow.matchAll(/- project: (\S+)\n\s+browser: (\S+)/g)]
    .map(([, project, browser]) => ({ project, browser }));
  assert.deepEqual(projects, full.projects.map((project) => ({
    project: project.name, browser: project.use.defaultBrowserType,
  })));
  assert.match(workflow, /fail-fast: false/);
  assert.match(workflow, /npx playwright install --with-deps \$\{\{ matrix\.browser \}\}/);
  assert.match(workflow, /--project=\$\{\{ matrix\.project \}\} --workers=2/);
  assert.match(workflow, /name: e2e-full-\$\{\{ matrix\.project \}\}-\$\{\{ github\.run_id \}\}/);
  assert.match(workflow, /if: matrix\.project == 'chromium' && github\.event_name == 'workflow_dispatch'\n\s+run: npm test/);
});
