import { describe, it, expect } from 'vitest';
import { buildServer, TOOL_NAMES } from '../../mcp/server.js';

describe('mcp server', () => {
  it('exposes exactly the three documented tools', () => {
    expect(TOOL_NAMES).toEqual(['pombuilder_crawl', 'pombuilder_generate', 'pombuilder_diff']);
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
});
