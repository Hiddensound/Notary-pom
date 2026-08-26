// SPDX-License-Identifier: Apache-2.0

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
