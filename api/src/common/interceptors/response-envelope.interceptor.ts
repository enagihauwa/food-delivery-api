import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { map, type Observable } from 'rxjs';
import { Paginated } from '../pagination/paginated.js';

/**
 * Wraps every successful response: lists become `{ data: [...], meta }`,
 * everything else becomes `{ data }`. `undefined` (204 No Content) is left alone.
 */
@Injectable()
export class ResponseEnvelopeInterceptor implements NestInterceptor {
  intercept(_context: ExecutionContext, next: CallHandler): Observable<unknown> {
    return next.handle().pipe(
      map((result: unknown) => {
        if (result === undefined) return undefined;
        if (result instanceof Paginated) return { data: result.items, meta: result.meta };
        return { data: result };
      }),
    );
  }
}
