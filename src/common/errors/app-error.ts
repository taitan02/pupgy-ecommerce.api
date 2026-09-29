import { HttpException } from '@nestjs/common';
import { ErrorCode, type ErrorCodeValue } from './error-codes.js';

/**
 * Domain-level error. Extends HttpException so Nest's own machinery keeps working,
 * but carries a stable `code` that the exception filter puts in the response body.
 *
 * `extensions` are RFC 9457 extension members: extra fields rendered at the top level
 * of the problem document. They exist so an error can be acted on rather than merely
 * reported — "not enough stock" is far more useful with the number that is left.
 */
export class AppError extends HttpException {
  constructor(
    readonly code: ErrorCodeValue,
    status: number,
    message: string,
    readonly extensions?: Record<string, unknown>,
  ) {
    super(message, status);
  }

  static notFound(message = 'Resource not found', extensions?: Record<string, unknown>) {
    return new AppError(ErrorCode.NOT_FOUND, 404, message, extensions);
  }

  static forbidden(message = 'Forbidden', extensions?: Record<string, unknown>) {
    return new AppError(ErrorCode.FORBIDDEN, 403, message, extensions);
  }

  static conflict(message: string, extensions?: Record<string, unknown>) {
    return new AppError(ErrorCode.CONFLICT, 409, message, extensions);
  }
}
