// SPDX-License-Identifier: Apache-2.0

// Artifact ordering must be identical across machines and locales.
// localeCompare is locale-sensitive and produces different orderings
// depending on the runtime's ICU data and default locale; compareStrings
// performs ordinal comparison for reproducible, deterministic results.
export function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
