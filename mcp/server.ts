// SPDX-License-Identifier: Apache-2.0

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { chromium } from 'playwright';
import { loadConfig, withDefaults } from '../src/config.js';
import { crawlSite, formatUnstable } from '../src/crawl/crawl.js';
import type { UnstablePage } from '../src/crawl/crawl.js';
import { readNotebook, writeNotebook } from '../src/io/notebookStore.js';
import { writeGenerated } from '../src/io/writeOutput.js';
import { formatDrift } from '../src/diff/notebook.js';
import { refinedDiff } from '../src/diff/run.js';
import { formatWeakNaming, refineNotebookNames } from '../src/name/llm.js';

export const TOOL_NAMES = ['pombuilder_crawl', 'pombuilder_generate', 'pombuilder_diff'] as const;

const text = (s: string) => ({ content: [{ type: 'text' as const, text: s }] });

export function buildServer(): McpServer {
  const server = new McpServer({ name: 'pombuilder', version: '0.1.0' });

  server.tool('pombuilder_crawl',
    'Crawl a site and write the POMBuilder notebook of verified locators.',
    {
      url: z.string().url(),
      irDir: z.string().optional(),
      maxPages: z.number().optional(),
      config: z.string().optional(),
    },
    async ({ url, irDir, maxPages, config: configPath }) => {
      const config = await loadConfig(configPath, { seed: url, irDir, maxPages });
      const browser = await chromium.launch();
      try {
        const unstable: UnstablePage[] = [];
        const nb = await crawlSite(browser, config, undefined, (u) => unstable.push(u));
        await writeNotebook(config.irDir, await refineNotebookNames(nb, config));
        const unresolved = nb.pages.reduce(
          (n, p) => n + p.elements.filter((e) => e.status === 'unresolved').length, 0);
        const warning = unstable.length ? `\n\n${formatUnstable(unstable)}` : '';
        // Checked against `nb` as first built, before `refineNotebookNames` -- see the
        // matching comment in src/cli.ts's `crawl` action for why.
        const weakNaming = formatWeakNaming(nb);
        const weakWarning = weakNaming ? `\n\n${weakNaming}` : '';
        return text(
          `Crawled ${nb.pages.length} routes. ${unresolved} elements unresolved.${warning}${weakWarning}`);
      } finally {
        await browser.close();
      }
    });

  server.tool('pombuilder_generate',
    'Turn the stored notebook into Playwright page objects and smoke specs.',
    { outDir: z.string().optional(), irDir: z.string().optional() },
    async ({ outDir, irDir }) => {
      const config = withDefaults({ seed: 'https://placeholder.invalid', outDir, irDir });
      const nb = await readNotebook(config.irDir);
      if (!nb) return text('No notebook found. Run pombuilder_crawl first.');
      const { written, skipped } = await writeGenerated(config.outDir, nb);
      return text(`Wrote ${written.length} files, left ${skipped.length} hand-owned files untouched.`);
    });

  server.tool('pombuilder_diff',
    'Re-crawl and report locator drift against the stored notebook.',
    { url: z.string().url(), irDir: z.string().optional(), config: z.string().optional() },
    async ({ url, irDir, config: configPath }) => {
      const config = await loadConfig(configPath, { seed: url, irDir });
      const previous = await readNotebook(config.irDir);
      if (!previous) return text('No stored notebook to compare against.');
      const browser = await chromium.launch();
      try {
        const unstable: UnstablePage[] = [];
        const next = await crawlSite(browser, config, undefined, (u) => unstable.push(u));
        const warning = unstable.length ? `\n\n${formatUnstable(unstable)}` : '';
        return text(`${formatDrift(await refinedDiff(previous, next, config))}${warning}`);
      } finally {
        await browser.close();
      }
    });

  return server;
}

if (process.argv[1]?.endsWith('server.js')) {
  await buildServer().connect(new StdioServerTransport());
}
