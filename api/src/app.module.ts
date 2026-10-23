import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import configuration, { type AppConfig } from './config/configuration.js';
import { validateEnv } from './config/validate-env.js';
import { RateLimitGuard } from './common/guards/rate-limit.guard.js';
import { HealthController } from './health/health.controller.js';
import { MenuItemsModule } from './menu-items/menu-items.module.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { RestaurantsModule } from './restaurants/restaurants.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, load: [configuration], validate: validateEnv }),
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<AppConfig, true>) => {
        const { ttlMs, limit } = config.get('rateLimit', { infer: true });
        return { throttlers: [{ ttl: ttlMs, limit }] };
      },
    }),
    PrismaModule,
    MenuItemsModule,
    RestaurantsModule,
  ],
  controllers: [HealthController],
  providers: [{ provide: APP_GUARD, useClass: RateLimitGuard }],
})
export class AppModule {}
