import { readFile, mkdir, writeFile } from "node:fs/promises";

export default class CoverageReporter {
  records = new Map();
  tier = "full";

  onBegin(config, suite) {
    this.tier = config.metadata.tier;
    for (const test of suite.allTests()) {
      this.records.set(test.id, {
        caseId: test.title.match(/E2E-\d{3}/)?.[0],
        title: test.title,
        project: test.parent.project()?.name,
        file: test.location.file.replace(`${config.rootDir}/`, ""),
        status: "not-run",
      });
    }
  }

  onTestEnd(test, result) {
    Object.assign(this.records.get(test.id), {
      status: result.status,
      durationMs: result.duration,
      errors: result.errors.map((error) => error.message),
    });
  }

  async onEnd(result) {
    const specification = await readFile("tests/e2e/e2e-tests.md", "utf8");
    const cases = [...specification.matchAll(/^### (E2E-\d{3}) \[([^\]]+)\] (.+)$/gm)]
      .map(([, id, priority, title]) => {
        const tests = [...this.records.values()].filter((test) => test.caseId === id);
        const clientRequired = /client|manual/.test(priority);
        return {
          id, priority, title, clientRequired,
          automation: tests.length ? "implemented" : clientRequired ? "not-implemented" : "not-selected-or-not-implemented",
          clientImport: clientRequired ? "blocked: requires authorized isolated calendar client; not executed by browser suite" : undefined,
          // A passing browser subset never certifies every prose variant/project or a client import.
          tests,
        };
      });
    await mkdir("test-results", { recursive: true });
    const prefix = this.tier === "smoke" ? "e2e-smoke" : "e2e";
    await writeFile(`test-results/${prefix}-coverage.json`, JSON.stringify({
      tier: this.tier,
      status: result.status,
      generatedAt: new Date().toISOString(),
      scope: "Listed executable variants only; the specification's full coverage matrix is not a pass claim.",
      cases,
    }, null, 2));
  }
}
