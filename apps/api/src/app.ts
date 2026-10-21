import cookieParser from 'cookie-parser';
import express, { type NextFunction, type Request, type Response } from 'express';
import helmet from 'helmet';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { pinoHttp } from 'pino-http';
import { config } from './config';
import { logger } from './logger';
import { loadSession } from './middleware/auth';
import { CSRF_HEADER, csrfProtection } from './middleware/csrf';
import { errorHandler, notFoundHandler, requestId } from './middleware/errors';
import { rateLimits } from './middleware/rate-limit';
import { accountRouter } from './routes/account';
import { authRouter } from './routes/auth';
import { categoriesRouter } from './routes/categories';
import { dataRouter } from './routes/data';
import { insightsRouter } from './routes/insights';
import { itemsRouter } from './routes/items';
import { systemRouter } from './routes/system';

/**
 * Credentialed CORS for explicitly allowed origins only. When the web app is
 * served from the same origin as the API (the recommended deployment), no
 * cross-origin requests are needed at all.
 */
function cors(req: Request, res: Response, next: NextFunction) {
  const origin = req.get('origin');
  if (origin && config.allowedOrigins.has(origin) && origin !== `${req.protocol}://${req.get('host')}`) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Vary', 'Origin');
    if (req.method === 'OPTIONS') {
      res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE');
      res.setHeader('Access-Control-Allow-Headers', `Content-Type,${CSRF_HEADER},Idempotency-Key`);
      res.setHeader('Access-Control-Max-Age', '600');
      res.status(204).end();
      return;
    }
  }
  next();
}

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', config.TRUST_PROXY);
  app.set('query parser', 'simple');

  app.use(requestId);
  app.use(
    pinoHttp({
      logger,
      genReqId: (req) => (req as Request).requestId,
      autoLogging: { ignore: (req) => req.url === '/api/health' || req.url === '/api/ready' },
      // Only method, path and status are logged: no headers, cookies, bodies or query strings.
      serializers: {
        req: (req) => ({ id: req.id, method: req.method, path: String(req.url).split('?')[0] }),
        res: (res) => ({ statusCode: res.statusCode }),
      },
      customProps: (req) => ({ userId: (req as Request).auth?.user.id }),
    }),
  );

  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: false,
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          // Inline style *attributes* are needed by the chart and toast libraries; scripts stay strict.
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", 'data:'],
          fontSrc: ["'self'"],
          connectSrc: ["'self'"],
          objectSrc: ["'none'"],
          baseUri: ["'self'"],
          formAction: ["'self'"],
          frameAncestors: ["'none'"],
          ...(config.isProduction ? { upgradeInsecureRequests: [] } : {}),
        },
      },
      strictTransportSecurity: config.isProduction ? { maxAge: 63_072_000, includeSubDomains: true, preload: false } : false,
      referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
      crossOriginResourcePolicy: { policy: 'same-origin' },
    }),
  );
  app.use((_req, res, next) => {
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=()');
    next();
  });

  const api = express.Router();
  api.use(cors);
  api.use((_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });
  api.use(express.json({ limit: '1200kb', strict: true }));
  api.use(cookieParser());
  api.use(rateLimits.api);
  api.use(systemRouter);
  api.use(csrfProtection);
  api.use(loadSession);
  api.use('/auth', authRouter);
  api.use('/account', accountRouter);
  api.use('/items', itemsRouter);
  api.use('/categories', categoriesRouter);
  api.use('/insights', insightsRouter);
  api.use('/data', dataRouter);
  api.use(notFoundHandler);
  app.use('/api', api);

  if (config.WEB_DIST_DIR) {
    const dist = path.resolve(config.WEB_DIST_DIR);
    const indexHtml = path.join(dist, 'index.html');
    if (!existsSync(indexHtml)) throw new Error(`WEB_DIST_DIR does not contain index.html: ${dist}`);
    app.use(
      '/assets',
      express.static(path.join(dist, 'assets'), { immutable: true, maxAge: '1y', index: false, fallthrough: false }),
    );
    app.use(express.static(dist, { index: false, maxAge: '1h' }));
    // Client-side routes all render the SPA shell.
    app.get(/^\/(?!api(?:\/|$)).*/, (_req, res) => {
      res.setHeader('Cache-Control', 'no-cache');
      res.sendFile(indexHtml);
    });
  }

  app.use(errorHandler);
  return app;
}
