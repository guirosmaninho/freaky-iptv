const { defineConfig } = require('playwright/test');

module.exports = defineConfig({
  testDir: './e2e',
  timeout: 45_000,
  expect: { timeout: 8_000 },
  workers: 1,
  fullyParallel: false,
  outputDir: 'artifacts/playwright',
  snapshotPathTemplate: '{testDir}/snapshots/{arg}{ext}',
  use: {
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure'
  }
});
