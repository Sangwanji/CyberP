import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe('aiService', () => {
  it('returns a fallback overview when GROQ_API_KEY is missing', async () => {
    vi.stubEnv('GROQ_API_KEY', '');
    const ai = await import('../../src/services/aiService.js');

    const result = await ai.generateZapOverview([], 'http://example.com');

    expect(result.source).toBe('fallback');
    expect(result.title).toBe('ZAP scan summary');
  });

  it('rejects direct Groq calls when GROQ_API_KEY is missing', async () => {
    vi.stubEnv('GROQ_API_KEY', '');
    const ai = await import('../../src/services/aiService.js');

    await expect(ai.callGroq('hello')).rejects.toThrow('Groq API key is not configured');
  });

  it('calls Groq chat completions and returns generated content', async () => {
    vi.stubEnv('GROQ_API_KEY', 'test-key');
    vi.stubEnv('GROQ_MODEL', 'test-model');
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: '{"ok":true}' } }] }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const ai = await import('../../src/services/aiService.js');
    const result = await ai.callGroq('Return JSON', { jsonMode: true });

    expect(result).toBe('{"ok":true}');
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.groq.com/openai/v1/chat/completions',
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('"model":"test-model"'),
      }),
    );
  });
});
