import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { AppModule } from '../src/app.module.js';
import { configureApp, registerNotFoundFallback } from '../src/setup.js';

/** Builds the app with the exact production pipeline (prefix, pipes, filter, interceptor). */
export async function createTestApp(): Promise<NestExpressApplication> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>();
  configureApp(app);
  await app.init();
  registerNotFoundFallback(app);
  return app;
}

export const API = '/api/v1';
