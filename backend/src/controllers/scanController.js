import {
  runRegularScan,
  validateTargetUrl,
} from '../services/scanService.js';
import {
  generateSummary,
  generateVaptReport,
  isGroqConfigured,
} from '../services/aiService.js';

export async function createScan(req, res, next) {
  try {
    const { url } = req.body ?? {};
    const validationError = validateTargetUrl(url);

    if (validationError) {
      return res.status(400).json({ success: false, error: validationError });
    }

    const result = await runRegularScan(url);
    return res.json({ success: true, ...result });
  } catch (error) {
    return next(error);
  }
}

export async function createAiSummary(req, res) {
  if (!isGroqConfigured()) {
    return res.status(503).json({
      success: false,
      error: 'AI service is not configured on this server.',
    });
  }

  try {
    const { scanResult, zapAlerts, zapOverview } = req.body ?? {};
    const summary = await generateSummary(scanResult, zapAlerts, zapOverview);

    return res.json({ success: true, summary });
  } catch (error) {
    console.error('AI summary generation failed:', error);
    return res.status(502).json({
      success: false,
      error: error instanceof Error ? error.message : 'AI summary failed.',
    });
  }
}

export async function createAiVaptReport(req, res) {
  if (!isGroqConfigured()) {
    return res.status(503).json({
      success: false,
      error: 'AI service is not configured on this server.',
    });
  }

  try {
    const { scanResult, zapAlerts } = req.body ?? {};
    const report = await generateVaptReport(scanResult, zapAlerts);

    return res.json({ success: true, report });
  } catch (error) {
    console.error('VAPT report generation failed:', error);
    return res.status(502).json({
      success: false,
      error: error instanceof Error ? error.message : 'VAPT report generation failed.',
    });
  }
}

export default { createScan, createAiSummary, createAiVaptReport };
