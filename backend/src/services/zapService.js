import axios from 'axios';

const ZAP_API_BASE = `${(process.env.ZAP_API_URL ?? 'http://localhost:8080').replace(/\/$/, '')}/JSON`;
// Use a shorter timeout for alert fetching — if ZAP is slow, we abort early
const ZAP_TIMEOUT_MS = Number(process.env.ZAP_TIMEOUT_MS ?? 120_000);
const ZAP_ALERTS_TIMEOUT_MS = 20_000; // 20s max for alert retrieval

/**
 * Clears ZAP's session data before each scan so stale alerts don't accumulate.
 */
async function clearZapSession() {
  try {
    await axios.get(`${ZAP_API_BASE}/core/action/newSession/`, {
      params: { name: '', overwrite: 'true' },
      timeout: 15_000,
    });
    console.log('ZAP session cleared.');
  } catch (err) {
    // Non-fatal — proceed even if clear fails
    console.warn('ZAP session clear failed (non-fatal):', err.message);
  }
}

export async function startZapScan(targetUrl) {
  // Clear old session data so alerts from previous scans don't pollute results
  await clearZapSession();

  try {
    // Limit crawl depth and breadth to keep scans fast
    await axios.get(`${ZAP_API_BASE}/spider/action/setOptionMaxDepth/`, {
      params: { Integer: 3 },
      timeout: ZAP_TIMEOUT_MS,
    }).catch(() => {});

    await axios.get(`${ZAP_API_BASE}/spider/action/setOptionMaxChildren/`, {
      params: { Integer: 10 },
      timeout: ZAP_TIMEOUT_MS,
    }).catch(() => {});

    const response = await axios.get(`${ZAP_API_BASE}/spider/action/scan/`, {
      params: { url: targetUrl, maxChildren: 10 },
      timeout: ZAP_TIMEOUT_MS,
    });

    const scanId = response.data.scan;
    console.log('ZAP scan started, scanId:', scanId, 'raw response:', JSON.stringify(response.data));
    return scanId;
  } catch (error) {
    throw new Error(`Failed to start ZAP scan: ${error.message}`);
  }
}

export async function getZapScanStatus(scanId) {
  try {
    console.log('Polling ZAP status for scanId:', scanId);
    const response = await axios.get(`${ZAP_API_BASE}/spider/view/status/`, {
      params: { scanId: String(scanId) },
      timeout: ZAP_TIMEOUT_MS,
    });
    console.log('ZAP status response:', JSON.stringify(response.data));
    return Number(response.data.status);
  } catch (error) {
    const detail = error.response?.data ? JSON.stringify(error.response.data) : error.message;
    throw new Error(`Failed to get ZAP scan status: ${detail}`);
  }
}

/**
 * Retrieves alerts from ZAP — capped at 100 to avoid timeout on large result sets.
 * @param {string} targetUrl The target URL
 * @returns {Promise<Array>} Array of alerts
 */
export async function getZapAlerts(targetUrl) {
  try {
    // Use start+count pagination to avoid fetching thousands of stale alerts
    const response = await axios.get(`${ZAP_API_BASE}/core/view/alerts/`, {
      params: {
        baseurl: targetUrl,
        start: 0,
        count: 100,
      },
      timeout: ZAP_ALERTS_TIMEOUT_MS,
    });
    return response.data.alerts || [];
  } catch (error) {
    throw new Error(`Failed to get ZAP alerts: ${error.message}`);
  }
}

export default { startZapScan, getZapScanStatus, getZapAlerts };
