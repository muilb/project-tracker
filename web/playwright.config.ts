// End-to-end tests: the production build (`vite build`, served by `vite preview`) in a real Chromium,
// against the local API with the sample data and its clock at the sample's "now" (SAMPLE_NOW=1).
// Run from the repo root with `npm run e2e`.
import { defineConfig, devices } from '@playwright/test';

const API_PORT = 3101;
const WEB_PORT = 4317;

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: false,
  workers: 1, // one API process with one in-memory store: tests run in order and clean up after themselves
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://localhost:${WEB_PORT}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    // Machines with a preinstalled Chromium (cloud sessions) point at it instead of `playwright install`.
    launchOptions: process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {},
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] }, testIgnore: /mobile/ },
    { name: 'phone', use: { ...devices['Pixel 7'], viewport: { width: 390, height: 844 } }, testMatch: /mobile/ },
  ],
  webServer: [
    {
      command: 'npx tsx src/local.ts',
      cwd: '../api',
      env: { PORT: String(API_PORT), SAMPLE_NOW: '1', WEB_URL: `http://localhost:${WEB_PORT}` },
      url: `http://localhost:${API_PORT}/health`,
      reuseExistingServer: false,
    },
    {
      command: `npx vite preview --port ${WEB_PORT} --strictPort`,
      env: { API_PORT: String(API_PORT) },
      url: `http://localhost:${WEB_PORT}`,
      reuseExistingServer: false,
    },
  ],
});
