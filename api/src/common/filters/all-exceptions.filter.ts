import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Logger } from '@nestjs/common';
import type { Response } from 'express';
import { AppException, type ErrorCode } from '../errors/app-exception.js';

interface ErrorBody {
  code: ErrorCode;
  message: string;
  details?: unknown;
}

const CODE_BY_STATUS: Record<number, ErrorCode> = {
  400: 'BAD_REQUEST',
  404: 'NOT_FOUND',
  409: 'CONFLICT',
  422: 'VALIDATION_ERROR',
  429: 'RATE_LIMITED',
};

const codeFor = (status: number): ErrorCode => CODE_BY_STATUS[status] ?? (status >= 500 ? 'INTERNAL' : 'BAD_REQUEST');

/** Turns every thrown thing into `{ error: { code, message, details? } }` with an honest status. */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('Exceptions');

  catch(exception: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();
    const { status, error } = this.map(exception);
    if (status >= 500) this.logger.error(exception instanceof Error ? (exception.stack ?? exception.message) : String(exception));
    if (res.headersSent) return;
    res.status(status).json({ error });
  }

  private map(exception: unknown): { status: number; error: ErrorBody } {
    if (exception instanceof AppException) {
      const { code, message, details } = exception.getResponse() as ErrorBody;
      return { status: exception.getStatus(), error: this.build(code, message, details) };
    }

    const prisma = this.mapPrisma(exception);
    if (prisma) return prisma;

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();
      const raw = typeof body === 'string' ? body : (body as { message?: unknown }).message;
      const message = Array.isArray(raw) ? raw.join('; ') : String(raw ?? exception.message);
      return { status, error: this.build(codeFor(status), message) };
    }

    // Errors from Express middleware (body-parser) carry an http status and a type.
    const e = exception as { status?: unknown; type?: string } | null;
    if (typeof e?.status === 'number' && e.status >= 400 && e.status < 500) {
      const message =
        e.type === 'entity.parse.failed'
          ? 'Request body is not valid JSON'
          : e.type === 'entity.too.large'
            ? 'Request body is too large'
            : 'Bad request';
      return { status: e.status, error: this.build(codeFor(e.status), message) };
    }

    return { status: 500, error: this.build('INTERNAL', 'Something went wrong') };
  }

  private mapPrisma(exception: unknown): { status: number; error: ErrorBody } | null {
    const e = exception as { name?: string; code?: string } | null;
    if (e?.name !== 'PrismaClientKnownRequestError') return null;
    switch (e.code) {
      case 'P2025':
        return { status: 404, error: this.build('NOT_FOUND', 'Resource not found') };
      case 'P2002':
        return { status: 409, error: this.build('CONFLICT', 'A record with these values already exists') };
      case 'P2003':
        return { status: 422, error: this.build('VALIDATION_ERROR', 'A referenced record does not exist') };
      default:
        return null;
    }
  }

  private build(code: ErrorCode, message: string, details?: unknown): ErrorBody {
    return details === undefined ? { code, message } : { code, message, details };
  }
}
