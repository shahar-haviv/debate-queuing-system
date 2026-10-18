import { defineConfig, devices } from '@playwright/test'
// Loads `.env` as a side effect, and shares the same credentials the other
// test layers use.
import './tests/db/env.mjs'

const BASE_URL = process.env.E2E_BASE_URL || 'http://localhost:5173'

export default defineConfig({
  testDir: './tests/e2e',
  // These specs run against the real deployment target, one at a time, and are
  // deliberately read-only: anything that writes to the board belongs in the
  // database suite (tests/db), which creates and cleans up its own rows.
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  reporter: [['list']],
  use: {
    baseURL: BASE_URL,
    headless: true,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    video: 'off',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'npm run dev',
    url: BASE_URL,
    reuseExistingServer: true,
    timeout: 180_000,
  },
})
