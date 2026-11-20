import '../runtime-env.mjs';
import { chromium, devices } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';

const targets = [
  ['web', 'http://127.0.0.1:8811', ['/', '/login', '/account']],
  ['club', 'http://127.0.0.1:8812', ['/', '/login', '/auth/forgot', '/auth/set-password']],
];
const samples = 5;
const browser = await chromium.launch();
const results = [];

async function load(context, origin, path) {
  const page = await context.newPage();
  await page.addInitScript(() => {
    window.measurements = { lcp: 0, shifts: [], longTasks: [] };
    new PerformanceObserver(list => {
      window.measurements.lcp = list.getEntries().at(-1).startTime;
    }).observe({ type: 'largest-contentful-paint', buffered: true });
    new PerformanceObserver(list => {
      for (const item of list.getEntries()) {
        if (!item.hadRecentInput) window.measurements.shifts.push([item.startTime, item.value]);
      }
    }).observe({ type: 'layout-shift', buffered: true });
    new PerformanceObserver(list => {
      window.measurements.longTasks.push(...list.getEntries().map(item => item.duration));
    }).observe({ type: 'longtask', buffered: true });
  });
  try {
    const response = await page.goto(origin + path, { waitUntil: 'load' });
    if (response?.status() !== 200) throw Error('Static route did not load: ' + origin + path);
    await page.waitForTimeout(500);
    return await page.evaluate(() => {
      const nav = performance.getEntriesByType('navigation')[0];
      const entries = performance.getEntriesByType('resource').filter(entry => new URL(entry.name).origin === location.origin);
      const chunks = entries.filter(entry => new URL(entry.name).pathname.startsWith('/_next/static/'));
      const { lcp, shifts, longTasks } = window.measurements;
      let cls = 0;
      let score = 0;
      let start = -Infinity;
      let last = -Infinity;
      for (const [time, value] of shifts) {
        if (time - last >= 1000 || time - start >= 5000) {
          start = time;
          score = 0;
        }
        last = time;
        score += value;
        cls = Math.max(cls, score);
      }
      const sum = (items, property) => items.reduce((total, item) => total + item[property], 0);
      return {
        ttfb: nav.responseStart, fcp: performance.getEntriesByName('first-contentful-paint')[0]?.startTime ?? null,
        lcp: lcp || null, cls, longTasks: longTasks.length, networkBytes: nav.transferSize + sum(entries, 'transferSize'),
        chunks: chunks.length, chunkNetworkRequests: chunks.filter(entry => entry.transferSize > 0).length,
        chunkNetworkBytes: sum(chunks, 'transferSize'), chunkDecodedBytes: sum(chunks, 'decodedBodySize'),
      };
    });
  } finally {
    await page.close();
  }
}

try {
  for (const [app, origin, paths] of targets) {
    for (const [device, options] of [['desktop', {}], ['mobile', devices['Pixel 7']]]) {
      for (const path of paths) {
        for (let trial = 1; trial <= samples; trial++) {
          const context = await browser.newContext(options);
          try {
            results.push({ app, device, path, trial, cold: await load(context, origin, path), warm: await load(context, origin, path) });
          } finally {
            await context.close();
          }
        }
      }
    }
  }
  mkdirSync('.test-artifacts', { recursive: true });
  writeFileSync('.test-artifacts/static-performance.json', JSON.stringify(results, null, 2) + '\n');
  console.log('Recorded ' + results.length + ' pairs in .test-artifacts/static-performance.json');
} finally {
  await browser.close();
}
