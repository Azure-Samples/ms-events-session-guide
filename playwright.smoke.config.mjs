import { defineConfig } from "@playwright/test";
import full from "./playwright.config.mjs";

export default defineConfig({
  ...full,
  metadata: { tier: "smoke" },
  grep: /@smoke/,
  projects: full.projects.filter((project) => project.name === "chromium"),
  outputDir: "test-results/e2e-smoke",
  reporter: [
    ["list"], ["html", { open: "never", outputFolder: "test-results/e2e-smoke-report" }],
    ["json", { outputFile: "test-results/e2e-smoke-results.json" }],
    ["./tests/e2e/coverage-reporter.mjs"],
  ],
  webServer: { ...full.webServer, env: { E2E_TIER: "smoke" } },
});
