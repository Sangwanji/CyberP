import express from 'express';
import { createScan, createAiSummary, createAiVaptReport } from '../controllers/scanController.js';
import { requireAuth } from '../middleware/requireAuth.js';

const router = express.Router();

router.post('/scan', requireAuth, createScan);
router.post('/ai/summary', requireAuth, createAiSummary);
router.post('/ai/vapt-report', requireAuth, createAiVaptReport);

export default router;
