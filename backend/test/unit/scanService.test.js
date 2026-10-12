import { describe, it, expect } from 'vitest';
import * as scanService from '../../src/services/scanService.js';

describe('scanService utilities', () => {
  it('validateTargetUrl accepts https and http and rejects invalid', () => {
    expect(scanService.validateTargetUrl('https://example.com')).toBeNull();
    expect(scanService.validateTargetUrl('http://example.com')).toBeNull();
    expect(typeof scanService.validateTargetUrl('')).toBe('string');
    expect(typeof scanService.validateTargetUrl('not-a-url')).toBe('string');
  });

  it('stripCodeFences removes markdown code fences', () => {
    const src = '```json\n{ "a": 1 }\n```';
    expect(scanService.stripCodeFences(src)).toBe('{ "a": 1 }');
  });

  it('buildVaptPrompt includes target facts', () => {
    const prompt = scanService.buildVaptPrompt({ targetUrl: 'https://a', upstreamStatus: 200, nmap: { ports: [] }, headers: [] }, []);
    expect(prompt).toContain('Target: https://a');
    expect(prompt).toContain('Open ports: 0');
  });
});
