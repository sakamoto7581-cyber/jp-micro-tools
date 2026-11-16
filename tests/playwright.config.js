// @ts-check
const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: '.',
  testMatch: /.*\.spec\.js/,
  timeout: 60_000,
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:4173',
    headless: true,
    acceptDownloads: true,
  },
  webServer: {
    command: 'node serve.js',
    url: 'http://127.0.0.1:4173/index.html',
    reuseExistingServer: true,
  },
});
