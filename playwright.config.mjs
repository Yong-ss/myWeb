import './tests/runtime-env.mjs';
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir:'./tests/browser',
  timeout:30000,
  globalTimeout:180000,
  fullyParallel:false,
  forbidOnly:Boolean(process.env.CI),
  retries:0,
  workers:1,
  reporter:'list',
  outputDir:'.test-artifacts/playwright',
  use:{ baseURL:'http://127.0.0.1:8791', browserName:'chromium', trace:'retain-on-failure', screenshot:'only-on-failure', video:'off', serviceWorkers:'block' },
  webServer:{ command:'node tests/browser/server.mjs', url:'http://127.0.0.1:8791/health', reuseExistingServer:false, timeout:15000 },
});
