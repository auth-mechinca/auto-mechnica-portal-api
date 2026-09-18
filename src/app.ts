import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import swaggerUi from 'swagger-ui-express';
import { buildOpenApiDocument } from './openapi.js';
import { env } from './config/env.js';
import { errorHandler, notFoundHandler } from './middleware/error.js';
import { authRouter } from './modules/auth/routes.js';
import { posRouter } from './modules/pos/routes.js';
import { imsRouter } from './modules/ims/routes.js';
import { financialRouter } from './modules/financial/routes.js';
import { backofficeRouter } from './modules/backoffice/routes.js';
import { categoriesRouter } from './modules/categories/routes.js';
import { brandsRouter } from './modules/brands/routes.js';
import { settingsRouter } from './modules/settings/routes.js';
import { usersRouter } from './modules/users/routes.js';

export function createApp() {
  const app = express();

  app.use(helmet());
  app.use(cors({ origin: env.CORS_ORIGIN.split(',').map((o) => o.trim()) }));
  app.use(express.json({ limit: '1mb' }));

  app.get('/health', (_req, res) => res.json({ ok: true }));

  // Built once per process: the schemas it reads are module-level constants, so
  // regenerating per request would buy nothing.
  const openApiDocument = buildOpenApiDocument();

  // Deliberately unauthenticated. The document describes the shape of the API,
  // not its data, and a developer cannot get a token without an account anyway.
  app.get('/openapi.json', (_req, res) => res.json(openApiDocument));
  app.use(
    '/docs',
    // Swagger UI's own assets need inline styles, which helmet's default CSP
    // forbids. Scoped to this path so the rest of the app keeps the strict policy.
    helmet({ contentSecurityPolicy: false }),
    swaggerUi.serve,
    swaggerUi.setup(openApiDocument, {
      customSiteTitle: 'Auto Mechanica API',
      swaggerOptions: { persistAuthorization: true, displayRequestDuration: true },
    }),
  );

  // One module per mount point, matching the folder layout in Section 1 of the
  // demo scope. Each router applies its own role check as router-level
  // middleware, so a new endpoint cannot be added without inheriting it.
  app.use('/api/auth', authRouter);
  app.use('/api/pos', posRouter);
  app.use('/api/ims', imsRouter);
  app.use('/api/financial', financialRouter);
  app.use('/api/backoffice', backofficeRouter);
  app.use('/api/categories', categoriesRouter);
  app.use('/api/brands', brandsRouter);
  app.use('/api/settings', settingsRouter);
  app.use('/api/users', usersRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
