import { describe, it, expect } from 'vitest';
import { buildServer, TOOL_NAMES } from '../../mcp/server.js';

describe('mcp server', () => {
  it('exposes exactly the three documented tools', () => {
    expect(TOOL_NAMES).toEqual(['pombuilder_crawl', 'pombuilder_generate', 'pombuilder_diff']);
  });

  it('constructs without touching a browser', () => {
    expect(buildServer()).toBeDefined();
  });
});
