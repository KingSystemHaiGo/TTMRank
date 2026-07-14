import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/web',
  testMatch: /.*\.spec\.js/,
  use: {
    baseURL: 'http://127.0.0.1:4173',
    viewport: { width: 1280, height: 720 },
  },
  webServer: {
    command: 'python -m http.server 4173 --directory app --bind 127.0.0.1',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: true,
  },
});
