import assert from 'assert';
import * as aiService from '../src/services/aiService.js';
import * as zapService from '../src/services/zapService.js';

(async function run() {
  console.log('Running backend unit smoke tests...');

  assert.strictEqual(typeof aiService.generateZapOverview, 'function', 'AI overview should be exported');
  assert.strictEqual(typeof aiService.generateSummary, 'function', 'AI summary should be exported');
  assert.strictEqual(typeof aiService.generateVaptReport, 'function', 'VAPT report generation should be exported');

  // ZAP Service: exports should include functions
  assert.strictEqual(typeof zapService.startZapScan, 'function', 'zapService.startZapScan should be a function');
  assert.strictEqual(typeof zapService.getZapScanStatus, 'function', 'zapService.getZapScanStatus should be a function');
  assert.strictEqual(typeof zapService.getZapAlerts, 'function', 'zapService.getZapAlerts should be a function');

  console.log('All smoke tests passed.');
  process.exit(0);
})();
