import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  validateTargetUrl: vi.fn(() => null),
  runRegularScan: vi.fn(),
  generateSummary: vi.fn(),
  generateVaptReport: vi.fn(),
  isGroqConfigured: vi.fn(() => true),
  enrichZapAlerts: vi.fn((alerts) => alerts),
  generateZapOverview: vi.fn(),
  startZapScan: vi.fn(),
  getZapScanStatus: vi.fn(),
  getZapAlerts: vi.fn(),
}));

vi.mock('../../src/services/scanService.js', () => ({
  validateTargetUrl: mocks.validateTargetUrl,
  runRegularScan: mocks.runRegularScan,
}));

vi.mock('../../src/services/aiService.js', () => ({
  generateSummary: mocks.generateSummary,
  generateVaptReport: mocks.generateVaptReport,
  isGroqConfigured: mocks.isGroqConfigured,
  enrichZapAlerts: mocks.enrichZapAlerts,
  generateZapOverview: mocks.generateZapOverview,
}));

vi.mock('../../src/services/zapService.js', () => ({
  startZapScan: mocks.startZapScan,
  getZapScanStatus: mocks.getZapScanStatus,
  getZapAlerts: mocks.getZapAlerts,
}));

import { createAiSummary, createAiVaptReport } from '../../src/controllers/scanController.js';
import { getZapAlerts } from '../../src/controllers/zapController.js';

function makeResponse() {
  const res = {
    status: vi.fn(),
    json: vi.fn(),
  };
  res.status.mockReturnValue(res);
  return res;
}

afterEach(() => {
  vi.clearAllMocks();
  mocks.isGroqConfigured.mockReturnValue(true);
});

describe('controllers', () => {
  it('returns the generated AI summary in the API response', async () => {
    mocks.generateSummary.mockResolvedValue('Summary text');
    const res = makeResponse();

    await createAiSummary({ body: {} }, res);

    expect(res.json).toHaveBeenCalledWith({ success: true, summary: 'Summary text' });
  });

  it('returns the generated VAPT report in the API response', async () => {
    const report = { findings: [] };
    mocks.generateVaptReport.mockResolvedValue(report);
    const res = makeResponse();

    await createAiVaptReport({ body: {} }, res);

    expect(res.json).toHaveBeenCalledWith({ success: true, report });
  });

  it('includes the enriched alerts and overview in the ZAP response', async () => {
    const alerts = [{ alert: 'Example' }];
    const overview = { title: 'Scan summary' };
    mocks.getZapAlerts.mockResolvedValue(alerts);
    mocks.enrichZapAlerts.mockReturnValue(alerts);
    mocks.generateZapOverview.mockResolvedValue(overview);
    const res = makeResponse();

    await getZapAlerts({ query: { url: 'https://example.com' } }, res);

    expect(res.json).toHaveBeenCalledWith({ success: true, alerts, overview });
  });
});
