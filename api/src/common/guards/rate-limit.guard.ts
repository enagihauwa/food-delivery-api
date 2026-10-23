import { ExecutionContext, Injectable } from '@nestjs/common';
import { ThrottlerGuard, type ThrottlerLimitDetail } from '@nestjs/throttler';
import { AppException } from '../errors/app-exception.js';

/** Per-IP rate limit. The base guard already sets the Retry-After header. */
@Injectable()
export class RateLimitGuard extends ThrottlerGuard {
  protected override async throwThrottlingException(_context: ExecutionContext, detail: ThrottlerLimitDetail): Promise<void> {
    const retryAfterSeconds = detail.timeToBlockExpire;
    throw new AppException(429, 'RATE_LIMITED', `Too many requests. Retry in ${retryAfterSeconds} seconds.`, {
      retryAfterSeconds,
    });
  }
}
