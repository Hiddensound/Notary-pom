// SPDX-License-Identifier: Apache-2.0

import type { PageIR } from '../types.js';

export function emitSubclass(page: PageIR): string {
  return [
    `// Owned by you. POMBuilder writes this once and never touches it again.`,
    `// Locators and single-element actions live in ./generated/${page.className}.generated.js`,
    '',
    `import { ${page.className}Base } from './generated/${page.className}.generated.js';`,
    '',
    `export class ${page.className} extends ${page.className}Base {`,
    `  // Add multi-step flows here.`,
    '}',
    '',
  ].join('\n');
}
