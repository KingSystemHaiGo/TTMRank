import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/performance',
  testMatch: /.*\.spec\.js/,
  timeout: 45_000,
  use: {
    baseURL: 'http://127.0.0.1:4174',
    viewport: { width: 1280, height: 720 },
  },
  webServer: {
    command: 'python -m http.server 4174 --directory work/site --bind 127.0.0.1',
    url: 'http://127.0.0.1:4174',
    reuseExistingServer: true,
  },
});
