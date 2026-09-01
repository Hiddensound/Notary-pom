#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0

import { chromium } from 'playwright';
import { Command } from 'commander';
import { loadConfig } from './config.js';
import { crawlSite, formatUnstable } from './crawl/crawl.js';
import type { UnstablePage } from './crawl/crawl.js';
import { readNotebook, writeNotebook } from './io/notebookStore.js';
import { writeGenerated } from './io/writeOutput.js';
import { formatDrift } from './diff/notebook.js';
import { refinedDiff } from './diff/run.js';
import { formatWeakNaming, refineNotebookNames } from './name/llm.js';

const program = new Command();
program.name('pombuilder').description('Generate verified Playwright page objects').version('0.1.0');

program.command('crawl').argument('[url]').option('-c, --config <path>')
  .description('crawl and write the notebook')
  .action(async (url: string | undefined, opts: { config?: string }) => {
    const config = await loadConfig(opts.config, url ? { seed: url } : {});
    const browser = await chromium.launch();
    try {
      const unstable: UnstablePage[] = [];
      const nb = await crawlSite(browser, config, undefined, (u) => unstable.push(u));
      await writeNotebook(config.irDir, await refineNotebookNames(nb, config));
      const total = nb.pages.reduce((n, p) => n + p.elements.length, 0);
      const unresolved = nb.pages.reduce(
        (n, p) => n + p.elements.filter((e) => e.status === 'unresolved').length, 0);
      console.log(`${nb.pages.length} pages, ${total} elements, ${unresolved} unresolved.`);
      // A page sampled mid-flight is not recorded as if it were stable. The notebook
      // could carry the flag -- an optional `PageIR` field is additive and `readNotebook`
      // only rejects on a version mismatch -- but it would change the bytes of every
      // notebook on every site including the stable ones, so the crawl says it out loud
      // instead. See the README for what that does and does not cover.
      if (unstable.length) console.warn(formatUnstable(unstable));
      // Checked against the notebook as first built, before `refineNotebookNames` -- that
      // step only runs (and only fixes some elements) when `ANTHROPIC_API_KEY` is set, so
      // gating the warning on the post-refinement notebook would hide the exact sites this
      // exists to flag when a key happens to be configured too.
      const weakWarning = formatWeakNaming(nb);
      if (weakWarning) console.warn(weakWarning);
    } finally {
      await browser.close();
    }
  });

program.command('generate').option('-c, --config <path>')
  .description('notebook -> TypeScript')
  .action(async (opts: { config?: string }) => {
    const config = await loadConfig(opts.config, { seed: 'https://placeholder.invalid' });
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
    const config = await loadConfig(opts.config, url ? { seed: url } : {});
    const previous = await readNotebook(config.irDir);
    if (!previous) throw new Error('No stored notebook to compare against.');
    const browser = await chromium.launch();
    try {
      const unstable: UnstablePage[] = [];
      const next = await crawlSite(browser, config, undefined, (u) => unstable.push(u));
      console.log(formatDrift(await refinedDiff(previous, next, config)));
      // Drift reported off an unstable sample is exactly the spurious drift this warning
      // exists to explain, so it belongs on the diff path as much as on the crawl path.
      if (unstable.length) console.warn(formatUnstable(unstable));
    } finally {
      await browser.close();
    }
  });

program.parseAsync().catch((err) => {
  console.error(String(err instanceof Error ? err.message : err));
  process.exit(1);
});
