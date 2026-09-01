import { describe, it, expect } from 'vitest';
import { buildServer, TOOL_NAMES } from '../../mcp/server.js';
import { compareStrings } from '../../src/util/order.js';

describe('mcp server', () => {
  it('exposes exactly the three documented tools', () => {
    expect(TOOL_NAMES).toEqual(['pombuilder_crawl', 'pombuilder_generate', 'pombuilder_diff']);
  });

  // TOOL_NAMES is a hardcoded literal array, not derived from what buildServer actually
  // registers, so it could silently drift from reality (a tool renamed or removed in
  // buildServer() without updating TOOL_NAMES to match) and the test above would still
  // pass, checking nothing real. This derives the expected list from the server's own
  // registrations so the two can no longer silently diverge.
  it('TOOL_NAMES matches what buildServer actually registers', () => {
    const server = buildServer();
    const registered = Object.keys(server['_registeredTools']).sort(compareStrings);
    expect(registered).toEqual([...TOOL_NAMES].sort(compareStrings));
  });

  it('constructs without touching a browser', () => {
    expect(buildServer()).toBeDefined();
  });

  // 4.3: MCP had no way to point pombuilder_crawl/pombuilder_diff at a config file, so
  // storageState/contextOptions -- and therefore any authenticated crawl -- was
  // unreachable from this entry point. These check the registered tool's own input
  // schema accepts an optional `config` field; invoking the tool would need a real or
  // mocked browser, which stays out of scope for this test file.
  it('pombuilder_crawl accepts an optional config path', () => {
    const server = buildServer();
    const tool = server['_registeredTools']['pombuilder_crawl'];
    expect(tool.inputSchema.shape.config).toBeDefined();
    expect(tool.inputSchema.shape.config.isOptional()).toBe(true);
  });

  it('pombuilder_diff accepts an optional config path', () => {
    const server = buildServer();
    const tool = server['_registeredTools']['pombuilder_diff'];
    expect(tool.inputSchema.shape.config).toBeDefined();
    expect(tool.inputSchema.shape.config.isOptional()).toBe(true);
  });

  // pombuilder_generate had no equivalent check at all -- its registration could be
  // deleted entirely and no test would notice. Checks a real, identifying field on its
  // schema (outDir), not just existence of the tool, so this isn't vacuous either.
  it('pombuilder_generate accepts an optional outDir', () => {
    const server = buildServer();
    const tool = server['_registeredTools']['pombuilder_generate'];
    expect(tool.inputSchema.shape.outDir).toBeDefined();
    expect(tool.inputSchema.shape.outDir.isOptional()).toBe(true);
  });
});
