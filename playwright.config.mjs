import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  metadata: { tier: "full" },
  testDir: "./tests/e2e",
  testMatch: "**/*.spec.mjs",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  workers: 4,
  timeout: 45_000,
  expect: { timeout: 10_000 },
  outputDir: "test-results/e2e",
  reporter: [
    ["list"], ["html", { open: "never" }],
    ["json", { outputFile: "test-results/e2e-results.json" }],
    ["./tests/e2e/coverage-reporter.mjs"],
  ],
  use: {
    baseURL: "http://127.0.0.1:1414",
    timezoneId: "America/New_York",
    colorScheme: "light",
    acceptDownloads: true,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 900 } } },
    { name: "firefox", grepInvert: /E2E-084/, testIgnore: ["**/presentation.spec.mjs", "**/clipboard.spec.mjs"], use: { ...devices["Desktop Firefox"], viewport: { width: 1280, height: 900 } } },
    { name: "webkit", grepInvert: /E2E-084/, testIgnore: ["**/presentation.spec.mjs", "**/clipboard.spec.mjs"], use: { ...devices["Desktop Safari"], viewport: { width: 1280, height: 900 } } },
    { name: "mobile-chromium", grepInvert: /E2E-084/, testIgnore: ["**/presentation.spec.mjs", "**/clipboard.spec.mjs"], use: { ...devices["Pixel 7"], viewport: { width: 390, height: 844 } } },
    { name: "mobile-webkit", grepInvert: /E2E-084/, testIgnore: ["**/presentation.spec.mjs", "**/clipboard.spec.mjs"], use: { ...devices["iPhone 13"], viewport: { width: 390, height: 844 } } },
  ],
  webServer: {
    env: { E2E_TIER: "full" },
    command: "node tests/e2e/server.mjs",
    url: "http://127.0.0.1:1414",
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
