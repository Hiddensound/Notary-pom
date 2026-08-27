#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0

import { chromium } from 'playwright';
import { Command } from 'commander';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { withDefaults } from './config.js';
import { crawlSite } from './crawl/crawl.js';
import { readNotebook, writeNotebook } from './io/notebookStore.js';
import { writeGenerated } from './io/writeOutput.js';
import { diffNotebooks, formatDrift } from './diff/notebook.js';
import { refineNotebookNames } from './name/llm.js';
import type { PomBuilderConfig } from './types.js';

async function loadConfig(path: string | undefined, seed?: string): Promise<PomBuilderConfig> {
  if (!path) return withDefaults({ seed: seed! });
  const mod = await import(pathToFileURL(resolve(path)).href);
  return withDefaults({ ...(mod.default ?? mod), ...(seed ? { seed } : {}) });
}

const program = new Command();
program.name('pombuilder').description('Generate verified Playwright page objects').version('0.1.0');

program.command('crawl').argument('[url]').option('-c, --config <path>')
  .description('crawl and write the notebook')
  .action(async (url: string | undefined, opts: { config?: string }) => {
    const config = await loadConfig(opts.config, url);
    const browser = await chromium.launch();
    try {
      const nb = await crawlSite(browser, config);
      await writeNotebook(config.irDir, await refineNotebookNames(nb, config));
      const total = nb.pages.reduce((n, p) => n + p.elements.length, 0);
      const unresolved = nb.pages.reduce(
        (n, p) => n + p.elements.filter((e) => e.status === 'unresolved').length, 0);
      console.log(`${nb.pages.length} pages, ${total} elements, ${unresolved} unresolved.`);
    } finally {
      await browser.close();
    }
  });

program.command('generate').option('-c, --config <path>')
  .description('notebook -> TypeScript')
  .action(async (opts: { config?: string }) => {
    const config = await loadConfig(opts.config, 'https://placeholder.invalid');
    const nb = await readNotebook(config.irDir);
    if (!nb) throw new Error(`No notebook at ${config.irDir}. Run \`pombuilder crawl\` first.`);
    const { written, skipped } = await writeGenerated(config.outDir, nb);
    console.log(`Wrote ${written.length} files. Left ${skipped.length} hand-owned files untouched.`);
  });

program.command('build').argument('[url]').option('-c, --config <path>')
  .description('crawl then generate')
  .action(async (url: string | undefined, opts: { config?: string }) => {
    await program.parseAsync(['crawl', ...(url ? [url] : []), ...(opts.config ? ['-c', opts.config] : [])],
      { from: 'user' });
    await program.parseAsync(['generate', ...(opts.config ? ['-c', opts.config] : [])], { from: 'user' });
  });

program.command('diff').argument('[url]').option('-c, --config <path>')
  .description('compare a fresh crawl against the stored notebook')
  .action(async (url: string | undefined, opts: { config?: string }) => {
    const config = await loadConfig(opts.config, url);
    const previous = await readNotebook(config.irDir);
    if (!previous) throw new Error('No stored notebook to compare against.');
    const browser = await chromium.launch();
    try {
      const next = await crawlSite(browser, config);
      console.log(formatDrift(diffNotebooks(previous, next)));
    } finally {
      await browser.close();
    }
  });

program.parseAsync().catch((err) => {
  console.error(String(err instanceof Error ? err.message : err));
  process.exit(1);
});
