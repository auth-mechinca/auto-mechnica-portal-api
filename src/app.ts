import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { env } from './config/env.js';
import { errorHandler, notFoundHandler } from './middleware/error.js';
import { authRouter } from './modules/auth/routes.js';
import { posRouter } from './modules/pos/routes.js';
import { imsRouter } from './modules/ims/routes.js';
import { financialRouter } from './modules/financial/routes.js';
import { backofficeRouter } from './modules/backoffice/routes.js';

export function createApp() {
  const app = express();

  app.use(helmet());
  app.use(cors({ origin: env.CORS_ORIGIN.split(',').map((o) => o.trim()) }));
  app.use(express.json({ limit: '1mb' }));

  app.get('/health', (_req, res) => res.json({ ok: true }));

  // One module per mount point, matching the folder layout in Section 1 of the
  // demo scope. Each router applies its own role check as router-level
  // middleware, so a new endpoint cannot be added without inheriting it.
  app.use('/api/auth', authRouter);
  app.use('/api/pos', posRouter);
  app.use('/api/ims', imsRouter);
  app.use('/api/financial', financialRouter);
  app.use('/api/backoffice', backofficeRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
