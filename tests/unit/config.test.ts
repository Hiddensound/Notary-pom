import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { withDefaults, loadConfig } from '../../src/config.js';

describe('withDefaults', () => {
  it('fills defaults around a bare seed', () => {
    const c = withDefaults({ seed: 'https://shop.test' });
    expect(c.maxDepth).toBe(3);
    expect(c.maxPages).toBe(50);
    expect(c.testIdAttribute).toBe('data-testid');
    expect(c.respectRobots).toBe(true);
  });

  it('rejects a missing seed', () => {
    expect(() => withDefaults({} as never)).toThrow(/seed/i);
  });

  it('preserves caller overrides', () => {
    expect(withDefaults({ seed: 'https://s.test', maxPages: 5 }).maxPages).toBe(5);
  });

  // Before this fix, a typo'd seed died deep inside `crawlSite` at `new URL(config.seed).origin`
  // as a bare `TypeError: Invalid URL` that never named `seed` or the offending value.
  it('rejects a seed that is not a URL', () => {
    expect(() => withDefaults({ seed: 'not a url' })).toThrow(/seed/i);
  });

  it('still accepts a valid URL seed unchanged', () => {
    expect(withDefaults({ seed: 'https://shop.test/path' }).seed).toBe('https://shop.test/path');
  });

  it('defaults loginDetection to identifier-first', () => {
    expect(withDefaults({ seed: 'https://shop.test' }).loginDetection).toBe('identifier-first');
  });

  it.each(['identifier-first', 'password-only', 'off'] as const)(
    'round-trips loginDetection: %s',
    (loginDetection) => {
      expect(withDefaults({ seed: 'https://shop.test', loginDetection }).loginDetection).toBe(loginDetection);
    },
  );

  it('rejects an unrecognized loginDetection value', () => {
    expect(() =>
      withDefaults({ seed: 'https://shop.test', loginDetection: 'lax' as never }),
    ).toThrow(/loginDetection/);
  });
});

describe('loadConfig', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'pb-config-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('falls back to built-in defaults with no config file and no overrides', async () => {
    const config = await loadConfig(undefined, { seed: 'https://s.test' });
    expect(config.maxPages).toBe(50);
    expect(config.irDir).toBe('.pombuilder');
  });

  it('layers a config file value over the built-in default', async () => {
    const file = join(dir, 'pombuilder.config.mjs');
    await writeFile(file, "export default { seed: 'https://s.test', irDir: 'custom' };\n");
    const config = await loadConfig(file);
    expect(config.irDir).toBe('custom');
    expect(config.seed).toBe('https://s.test');
  });

  it('layers an explicit override over a config file value', async () => {
    const file = join(dir, 'pombuilder.config.mjs');
    await writeFile(file, "export default { seed: 'https://s.test', maxPages: 10 };\n");
    const config = await loadConfig(file, { maxPages: 25 });
    expect(config.maxPages).toBe(25);
  });

  // The footgun this test guards against: an MCP tool call whose caller didn't pass
  // `irDir` arrives here as `overrides: { irDir: undefined }` (an optional Zod field left
  // unset), not as `overrides: {}`. Spreading that object over the file-loaded config
  // as-is would create an own property `irDir: undefined`, which then loses to
  // `withDefaults`'s `??` built-in default -- silently discarding the config file's own
  // `irDir`. `loadConfig` must filter the undefined-valued override out first.
  it('an undefined-valued override does not clobber a config-file-set value', async () => {
    const file = join(dir, 'pombuilder.config.mjs');
    await writeFile(file, "export default { seed: 'https://s.test', irDir: 'custom' };\n");
    const config = await loadConfig(file, { seed: undefined, irDir: undefined, maxPages: undefined });
    expect(config.irDir).toBe('custom');
  });

  // 4.3: this is the specific value MCP had no way to supply at all -- a config file's
  // `contextOptions.storageState` is how an authenticated crawl is possible. Proving it
  // survives into the returned `PomBuilderConfig` here, combined with
  // `tests/browser/browser.spec.ts`'s existing coverage that `createContext` threads
  // `config.contextOptions` into `browser.newContext(...)`, closes the loop: `crawlSite`
  // calls `createContext(browser, config)` with this exact object, unmodified.
  it('a config file storageState reaches the returned config untouched', async () => {
    const file = join(dir, 'pombuilder.config.mjs');
    await writeFile(
      file,
      "export default { seed: 'https://s.test', contextOptions: { storageState: { cookies: [], origins: [] } } };\n",
    );
    const config = await loadConfig(file, { seed: undefined, irDir: undefined, maxPages: undefined });
    expect(config.contextOptions).toEqual({ storageState: { cookies: [], origins: [] } });
  });

  it('an explicit seed override wins over the config file seed', async () => {
    const file = join(dir, 'pombuilder.config.mjs');
    await writeFile(file, "export default { seed: 'https://file.test' };\n");
    const config = await loadConfig(file, { seed: 'https://override.test' });
    expect(config.seed).toBe('https://override.test');
  });
});
