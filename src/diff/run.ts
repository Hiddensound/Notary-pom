// SPDX-License-Identifier: Apache-2.0

import { diffNotebooks, type DriftReport } from './notebook.js';
import { refineNotebookNames } from '../name/llm.js';
import type { Notebook, PomBuilderConfig } from '../types.js';

// `crawl` stores LLM-refined names (`writeNotebook(..., await refineNotebookNames(nb,
// config))`), but a bare `diffNotebooks(previous, next)` compares that refined `previous`
// against a freshly-crawled `next` that never went through refinement -- every refined
// element then reports `renamed` on every diff run forever, with nothing having actually
// changed. Refining `next` here before comparing keeps `diff` symmetric with what `crawl`
// itself would produce, and costs an LLM call only for elements not already in
// `names.json` -- for an otherwise-unchanged site this is nearly free.
export async function refinedDiff(
  previous: Notebook,
  next: Notebook,
  config: PomBuilderConfig,
): Promise<DriftReport> {
  return diffNotebooks(previous, await refineNotebookNames(next, config));
}
