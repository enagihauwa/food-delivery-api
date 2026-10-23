import 'reflect-metadata';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module.js';
import type { AppConfig } from './config/configuration.js';
import { configureApp } from './setup.js';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  configureApp(app);
  app.enableShutdownHooks();
  const port = app.get<ConfigService<AppConfig, true>>(ConfigService).get('port', { infer: true });
  await app.listen(port, '0.0.0.0');
}
await bootstrap();
