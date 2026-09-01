// SPDX-License-Identifier: Apache-2.0

import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import type { PomBuilderConfig } from './types.js';

export function withDefaults(input: Partial<PomBuilderConfig>): PomBuilderConfig {
  if (!input.seed) throw new Error('config: `seed` is required');
  return {
    seed: input.seed,
    outDir: input.outDir ?? 'tests',
    irDir: input.irDir ?? '.pombuilder',
    maxDepth: input.maxDepth ?? 3,
    maxPages: input.maxPages ?? 50,
    include: input.include ?? [],
    exclude: input.exclude ?? [],
    testIdAttribute: input.testIdAttribute ?? 'data-testid',
    loginUrlPattern: input.loginUrlPattern ?? null,
    respectRobots: input.respectRobots ?? true,
    contextOptions: input.contextOptions ?? {},
  };
}

// Layers three levels, in order: built-in defaults (applied last, by `withDefaults`
// itself), the config file's own values, then `overrides` -- values the caller supplied
// directly (e.g. a CLI flag or an MCP tool-call argument). `overrides` commonly arrives
// with `undefined`-valued keys (an optional Zod field the caller omitted); spreading
// those directly over the file-loaded config would create own-properties that shadow the
// file's values and fall through to `withDefaults`'s `??` built-in default instead --
// silently discarding whatever the config file set. Filtering them out first keeps a
// config-file value intact when the caller didn't actually override it.
export async function loadConfig(
  path: string | undefined,
  overrides: Partial<PomBuilderConfig> = {},
): Promise<PomBuilderConfig> {
  const fileConfig = path
    ? ((await import(pathToFileURL(resolve(path)).href)) as {
        default?: Partial<PomBuilderConfig>;
      } & Partial<PomBuilderConfig>)
    : undefined;
  const base: Partial<PomBuilderConfig> = fileConfig ? (fileConfig.default ?? fileConfig) : {};
  const defined = Object.fromEntries(Object.entries(overrides).filter(([, v]) => v !== undefined));
  return withDefaults({ ...base, ...defined });
}
