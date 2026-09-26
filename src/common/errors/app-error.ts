import { HttpException } from '@nestjs/common';
import { ErrorCode, type ErrorCodeValue } from './error-codes.js';

/**
 * Domain-level error. Extends HttpException so Nest's own machinery keeps working,
 * but carries a stable `code` that the exception filter puts in the response body.
 */
export class AppError extends HttpException {
  constructor(
    readonly code: ErrorCodeValue,
    status: number,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message, status);
  }

  static notFound(message = 'Resource not found', details?: Record<string, unknown>) {
    return new AppError(ErrorCode.NOT_FOUND, 404, message, details);
  }

  static forbidden(message = 'Forbidden', details?: Record<string, unknown>) {
    return new AppError(ErrorCode.FORBIDDEN, 403, message, details);
  }

  static conflict(message: string, details?: Record<string, unknown>) {
    return new AppError(ErrorCode.CONFLICT, 409, message, details);
  }
}
