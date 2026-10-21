import { defineConfig, devices } from '@playwright/test';
import path from 'node:path';

/**
 * End-to-end tests start their own API (port 4100) and web dev server (port 5174)
 * against a dedicated database, so they never touch development data.
 */
const API_PORT = 4100;
const WEB_PORT = 5174;
const WEB_URL = `http://localhost:${WEB_PORT}`;
export const E2E_OUTBOX = path.resolve('test-results/e2e-outbox');
const DATABASE_URL = process.env.E2E_DATABASE_URL ?? 'postgresql://vaultledger:vaultledger_dev@localhost:5432/vaultledger_e2e';
const chromiumPath = process.env.PLAYWRIGHT_CHROMIUM_PATH;

export default defineConfig({
  testDir: 'e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: WEB_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    launchOptions: chromiumPath ? { executablePath: chromiumPath } : {},
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] }, testIgnore: /mobile\.spec\.ts/ },
    { name: 'mobile', use: { ...devices['Pixel 7'] }, testMatch: /mobile\.spec\.ts/ },
  ],
  webServer: [
    {
      command: 'npm run db:deploy --workspace @vaultledger/api && npx tsx apps/api/src/index.ts',
      url: `http://localhost:${API_PORT}/api/ready`,
      timeout: 120_000,
      reuseExistingServer: false,
      env: {
        NODE_ENV: 'development',
        PORT: String(API_PORT),
        DATABASE_URL,
        APP_URL: WEB_URL,
        TOKEN_PEPPER: 'e2e-only-pepper-0123456789abcdef0123456789',
        EMAIL_TRANSPORT: 'outbox',
        MAIL_OUTBOX_DIR: E2E_OUTBOX,
        SMS_PROVIDER: 'outbox',
        SMS_OUTBOX_DIR: E2E_OUTBOX,
        RATE_LIMIT_ENABLED: 'false',
        LOG_LEVEL: 'warn',
      },
    },
    {
      command: `npm run dev --workspace @vaultledger/web -- --port ${WEB_PORT}`,
      url: WEB_URL,
      timeout: 120_000,
      reuseExistingServer: false,
      env: { VITE_API_PROXY: `http://localhost:${API_PORT}` },
    },
  ],
});
