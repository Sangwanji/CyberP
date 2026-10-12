import express from 'express';
import {
  startZap,
  getZapStatus,
  getZapAlerts,
} from '../controllers/zapController.js';
import { requireAuth } from '../middleware/requireAuth.js';

const router = express.Router();

router.post('/zap/start', requireAuth, startZap);
router.get('/zap/status/:scanId', requireAuth, getZapStatus);
router.get('/zap/alerts', requireAuth, getZapAlerts);

export default router;
