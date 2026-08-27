// SPDX-License-Identifier: Apache-2.0

// Separate Playwright config for running the smoke specs POMBuilder generates
// (`<outDir>/smoke/*.smoke.spec.ts`, e.g. `tests/smoke/` with the default `outDir`).
//
// `playwright.config.ts` sets `testDir: 'tests/browser'` for this project's own 29 browser
// tests. Playwright's CLI resolves bare file-path arguments (e.g. `npx playwright test
// tests/smoke`) relative to `testDir`, so running the default config against `tests/smoke`
// finds zero tests — `tests/browser/tests/smoke` does not exist. Rather than widen
// `testDir` on the project's own config (which would risk pulling generated specs into the
// project's own test run), generated smoke specs get their own minimal config:
//
//   npx playwright test --config playwright.smoke.config.ts
import { defineConfig } from '@playwright/test';
export default defineConfig({ testDir: 'tests/smoke', use: { headless: true } });
