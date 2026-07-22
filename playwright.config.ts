import { defineConfig, devices } from "@playwright/test";

const reuseServer = process.env.MIMICOPY_E2E_REUSE_SERVER === "1";
const clientPort =
  process.env.MIMICOPY_CLIENT_PORT ?? (reuseServer ? "8080" : "8090");
const apiPort = process.env.MIMICOPY_API_PORT ?? "5184";
const baseURL = `http://127.0.0.1:${clientPort}`;

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
    baseURL,
    trace: "on-first-retry"
  },
  webServer: reuseServer
    ? undefined
    : {
        command: `rm -rf .playwright-storage && PORT=${apiPort} MIMICOPY_API_PORT=${apiPort} MIMICOPY_CLIENT_PORT=${clientPort} MIMICOPY_STORAGE_DIR=.playwright-storage pnpm dev`,
        reuseExistingServer: false,
        timeout: 30_000,
        url: baseURL
      },
  workers: 1,
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] }
    }
  ]
});
