import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('axios');
import axios from 'axios';

import * as zapService from '../../src/services/zapService.js';

describe('zapService', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('startZapScan returns scan id on success', async () => {
    axios.get.mockResolvedValue({ data: { scan: '123' } });
    const id = await zapService.startZapScan('http://example.com');
    expect(id).toBe('123');
    expect(axios.get).toHaveBeenCalled();
  });

  it('getZapScanStatus returns numeric status', async () => {
    axios.get.mockResolvedValue({ data: { status: '42' } });
    const status = await zapService.getZapScanStatus('123');
    expect(status).toBe(42);
    expect(axios.get).toHaveBeenCalled();
  });

  it('getZapAlerts returns alerts array', async () => {
    axios.get.mockResolvedValue({ data: { alerts: [{ alert: 'X', risk: 'High' }] } });
    const alerts = await zapService.getZapAlerts('http://example.com');
    expect(Array.isArray(alerts)).toBe(true);
    expect(alerts.length).toBe(1);
  });
});
