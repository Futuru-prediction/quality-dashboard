import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, devices } from "@playwright/test";

const PREVIEW_HOST = "127.0.0.1";
const PREVIEW_PORT = 4173;
const DEFAULT_BASE_URL = `http://${PREVIEW_HOST}:${PREVIEW_PORT}`;
const E2E_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = resolve(E2E_DIR, "..");

export default defineConfig({
  testDir: "./tests",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: [
    ["html", { outputFolder: "report/html", open: "never" }],
    ["json", { outputFile: "report/results.json" }],
    ["list"],
  ],
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL || DEFAULT_BASE_URL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  webServer: process.env.PLAYWRIGHT_BASE_URL
    ? undefined
    : {
      command:
        `npm --prefix "${ROOT_DIR}" run build && ` +
        `npm --prefix "${ROOT_DIR}" run preview -- --host ${PREVIEW_HOST} --port ${PREVIEW_PORT}`,
      url: DEFAULT_BASE_URL,
      reuseExistingServer: !process.env.CI,
      timeout: 120000,
      stdout: "pipe",
      stderr: "pipe",
    },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
  ],
});
