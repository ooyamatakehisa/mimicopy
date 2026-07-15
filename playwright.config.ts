import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  expect: {
    timeout: 10_000
  },
  fullyParallel: false,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  retries: process.env.CI ? 2 : 0,
  testDir: "./e2e",
  timeout: 45_000,
  use: {
    baseURL: "http://127.0.0.1:8090",
    trace: "on-first-retry"
  },
  webServer: {
    command:
      "rm -rf .playwright-storage && PORT=5184 MIMICOPY_API_PORT=5184 MIMICOPY_CLIENT_PORT=8090 MIMICOPY_STORAGE_DIR=.playwright-storage pnpm dev",
    reuseExistingServer: false,
    timeout: 30_000,
    url: "http://127.0.0.1:8090"
  },
  workers: 1,
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] }
    }
  ]
});
