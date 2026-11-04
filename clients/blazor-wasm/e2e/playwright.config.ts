import { defineConfig } from '@playwright/test';
import * as dotenv from 'dotenv';
import * as path from 'path';

// Each client folder has its own e2e/.env.client (not committed):
//   CLIENT_URL=http://localhost:16031
//   API_URL=http://localhost:16030
//   CLIENT_START=npm run dev -- --port 16031 --strictPort   (optional; run from the client root)
dotenv.config({ path: path.join(__dirname, '.env.client'), quiet: true } as dotenv.DotenvConfigOptions);

const clientUrl = process.env.CLIENT_URL;
const apiUrl = process.env.API_URL;
if (!clientUrl || !apiUrl) {
  throw new Error('CLIENT_URL and API_URL must be set (e2e/.env.client or the environment).');
}
process.env.API_URL = apiUrl.replace(/\/+$/, '');

export default defineConfig({
  testDir: './tests',
  workers: 1,
  fullyParallel: false,
  retries: 0,
  timeout: 60000,
  expect: { timeout: 10000 },
  reporter: [['list'], ['json', { outputFile: process.env.E2E_JSON || 'results.json' }]],
  use: {
    baseURL: clientUrl,
    channel: 'chrome',
    viewport: { width: 1366, height: 768 },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: process.env.CLIENT_START
    ? {
        command: process.env.CLIENT_START,
        url: clientUrl,
        reuseExistingServer: true,
        timeout: 180000,
        cwd: '..',
      }
    : undefined,
});
