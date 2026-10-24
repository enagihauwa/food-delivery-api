import { ConfigService } from '@nestjs/config';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { Request, Response } from 'express';
import helmet from 'helmet';
import type { AppConfig } from './config/configuration.js';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter.js';
import { ResponseEnvelopeInterceptor } from './common/interceptors/response-envelope.interceptor.js';

/** Shared by main.ts and the e2e tests so tests exercise the real pipeline. */
export function configureApp(app: NestExpressApplication) {
  const config = app.get<ConfigService<AppConfig, true>>(ConfigService);
  const origins = config.get('corsOrigins', { infer: true });

  // Trust exactly N proxy hops, counted from the right of X-Forwarded-For, so the rate limit keys on the
  // real client IP and a client cannot spoof it by sending its own header.
  app.set('trust proxy', config.get('trustProxyHops', { infer: true }));
  // Public read API: allow browsers on other origins to use responses (CORS still gates fetch).
  app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
  app.enableCors({
    origin: origins.includes('*') ? true : origins,
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    exposedHeaders: ['Retry-After', 'Location', 'X-RateLimit-Limit', 'X-RateLimit-Remaining', 'X-RateLimit-Reset'],
  });
  app.setGlobalPrefix('api/v1', { exclude: ['health'] });
  app.useGlobalFilters(new AllExceptionsFilter());
  app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
  return app;
}

/**
 * Call after `app.init()`. Nest only installs its JSON 404 handler under the global prefix,
 * so anything else (e.g. `/restaurants`) would get Express's HTML page. This catch-all,
 * registered after every route, keeps the error envelope consistent everywhere.
 */
export function registerNotFoundFallback(app: NestExpressApplication) {
  app.use((req: Request, res: Response) => {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: `Route ${req.method} ${req.path} not found` } });
  });
}
