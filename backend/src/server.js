import 'dotenv/config';
import { createRequire } from 'node:module';
import cors from 'cors';
import express from 'express';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

// Polyfill WebSocket for Node.js < 21 (required by @supabase/supabase-js v2.110+)
if (!globalThis.WebSocket) {
  const require = createRequire(import.meta.url);
  globalThis.WebSocket = require('ws');
}

import scanRoutes from './routes/scanRoutes.js';
import zapRoutes from './routes/zapRoutes.js';
import { errorHandler } from './middleware/errorHandler.js';

const app = express();
const port = Number(process.env.PORT ?? 3001);

const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',').map((o) => o.trim())
  : null; // null = allow all origins when env var is not set

app.use(cors({
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);
    if (!allowedOrigins) return callback(null, true);
    if (allowedOrigins.includes(origin)) return callback(null, true);
    return callback(null, false);
  },
}));

app.use(express.json({ limit: '5mb' }));

// Mount routers (controllers handle auth and service calls)
app.use(scanRoutes);
app.use(zapRoutes);

// Health endpoint
app.get('/health', (_req, res) => res.json({ ok: true, service: 'cyberp-backend' }));

// Centralized error handler
app.use(errorHandler);

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  app.listen(port, () => {
    console.log(`CyberP backend listening on http://localhost:${port}`);
  });
}

export default app;
