import { HttpException } from '@nestjs/common';

export type ErrorCode =
  | 'BAD_REQUEST'
  | 'INVALID_SORT_FIELD'
  | 'INVALID_CURSOR'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'INVALID_STATUS_TRANSITION'
  | 'VALIDATION_ERROR'
  | 'RATE_LIMITED'
  | 'INTERNAL';

export interface ErrorDetail {
  field: string;
  message: string;
}

/** Every deliberate API error is one of these; the filter turns it into the error envelope. */
export class AppException extends HttpException {
  constructor(
    status: number,
    readonly code: ErrorCode,
    message: string,
    readonly details?: ErrorDetail[] | Record<string, unknown>,
  ) {
    super({ code, message, details }, status);
  }

  static badRequest(message: string, details?: ErrorDetail[], code: ErrorCode = 'BAD_REQUEST') {
    return new AppException(400, code, message, details);
  }
  static notFound(resource: string) {
    return new AppException(404, 'NOT_FOUND', `${resource} not found`);
  }
  static conflict(message: string, code: ErrorCode = 'CONFLICT') {
    return new AppException(409, code, message);
  }
  static validation(message: string, details?: ErrorDetail[]) {
    return new AppException(422, 'VALIDATION_ERROR', message, details);
  }
}
