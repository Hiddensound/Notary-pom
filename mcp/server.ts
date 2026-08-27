// SPDX-License-Identifier: Apache-2.0

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { chromium } from 'playwright';
import { withDefaults } from '../src/config.js';
import { crawlSite } from '../src/crawl/crawl.js';
import { readNotebook, writeNotebook } from '../src/io/notebookStore.js';
import { writeGenerated } from '../src/io/writeOutput.js';
import { diffNotebooks, formatDrift } from '../src/diff/notebook.js';
import { refineNotebookNames } from '../src/name/llm.js';

export const TOOL_NAMES = ['pombuilder_crawl', 'pombuilder_generate', 'pombuilder_diff'] as const;

const text = (s: string) => ({ content: [{ type: 'text' as const, text: s }] });

export function buildServer(): McpServer {
  const server = new McpServer({ name: 'pombuilder', version: '0.1.0' });

  server.tool('pombuilder_crawl',
    'Crawl a site and write the POMBuilder notebook of verified locators.',
    { url: z.string().url(), irDir: z.string().optional(), maxPages: z.number().optional() },
    async ({ url, irDir, maxPages }) => {
      const config = withDefaults({ seed: url, irDir, maxPages });
      const browser = await chromium.launch();
      try {
        const nb = await crawlSite(browser, config);
        await writeNotebook(config.irDir, await refineNotebookNames(nb, config));
        const unresolved = nb.pages.reduce(
          (n, p) => n + p.elements.filter((e) => e.status === 'unresolved').length, 0);
        return text(`Crawled ${nb.pages.length} routes. ${unresolved} elements unresolved.`);
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
    { url: z.string().url(), irDir: z.string().optional() },
    async ({ url, irDir }) => {
      const config = withDefaults({ seed: url, irDir });
      const previous = await readNotebook(config.irDir);
      if (!previous) return text('No stored notebook to compare against.');
      const browser = await chromium.launch();
      try {
        return text(formatDrift(diffNotebooks(previous, await crawlSite(browser, config))));
      } finally {
        await browser.close();
      }
    });

  return server;
}

if (process.argv[1]?.endsWith('server.js')) {
  await buildServer().connect(new StdioServerTransport());
}
