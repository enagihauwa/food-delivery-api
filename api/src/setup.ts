import { ConfigService } from '@nestjs/config';
import type { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';
import type { AppConfig } from './config/configuration.js';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter.js';
import { ResponseEnvelopeInterceptor } from './common/interceptors/response-envelope.interceptor.js';

/** Shared by main.ts and the e2e tests so tests exercise the real pipeline. */
export function configureApp(app: NestExpressApplication) {
  const config = app.get<ConfigService<AppConfig, true>>(ConfigService);
  const origins = config.get('corsOrigins', { infer: true });

  // Behind Railway's proxy: trust X-Forwarded-For so rate limits are per real client IP.
  app.set('trust proxy', 1);
  app.use(helmet());
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
