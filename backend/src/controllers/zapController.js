import { validateTargetUrl } from '../services/scanService.js';
import {
  startZapScan as startZapScanService,
  getZapScanStatus as getZapScanStatusService,
  getZapAlerts as getZapAlertsService,
} from '../services/zapService.js';
import { enrichZapAlerts, generateZapOverview } from '../services/aiService.js';

export async function startZap(req, res, next) {
  try {
    const { url } = req.body ?? {};
    const validationError = validateTargetUrl(url);

    if (validationError) {
      return res.status(400).json({ success: false, error: validationError });
    }

    const scanId = await startZapScanService(url);
    return res.json({ success: true, scanId });
  } catch (error) {
    return next(error);
  }
}

export async function getZapStatus(req, res, next) {
  try {
    const { scanId } = req.params;
    const status = await getZapScanStatusService(scanId);
    return res.json({ success: true, status });
  } catch (error) {
    return next(error);
  }
}

export async function getZapAlerts(req, res) {
  try {
    const url = req.query.url ?? null;
    if (!url || typeof url !== 'string') {
      return res.status(400).json({ success: false, error: 'Target URL is required as a query parameter.' });
    }

    const alerts = enrichZapAlerts(await getZapAlertsService(url));
    const overview = await generateZapOverview(alerts, url);
    return res.json({ success: true, alerts, overview });
  } catch (error) {
    console.error('ZAP alert retrieval failed:', error);
    return res.status(502).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unable to retrieve ZAP alerts.',
    });
  }
}

export default { startZap, getZapStatus, getZapAlerts };
