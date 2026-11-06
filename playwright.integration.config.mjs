import './tests/runtime-env.mjs';
import { defineConfig } from '@playwright/test';
import { baseURL } from './tests/integration/local.mjs';

export default defineConfig({
  testDir:'tests/integration',testMatch:'**/*.spec.mjs',workers:1,fullyParallel:false,retries:0,forbidOnly:Boolean(process.env.CI),
  timeout:45000,globalTimeout:480000,reporter:'list',outputDir:'.test-artifacts/integration',
  use:{baseURL,browserName:'chromium',ignoreHTTPSErrors:true,trace:'retain-on-failure',screenshot:'only-on-failure',video:'off',serviceWorkers:'block'},
  webServer:{command:'node tests/integration/worker.mjs',url:baseURL,ignoreHTTPSErrors:true,reuseExistingServer:false,timeout:45000},
});
