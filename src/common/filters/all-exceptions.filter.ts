import { type ArgumentsHost, Catch, type ExceptionFilter, HttpException } from '@nestjs/common';
import type { Response } from 'express';
import { AppError } from '../errors/app-error.js';
import { ErrorCode, type ErrorCodeValue } from '../errors/error-codes.js';
import { RequestContext } from '../context/request-context.js';
import { logger } from '../../infra/logger/logger.js';

/**
 * Every error leaves the API in one shape: RFC 9457 problem+json plus a stable
 * `code` and the requestId. Clients branch on `code`; support traces incidents
 * with `requestId`.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    const requestId = RequestContext.requestId();

    const { status, code, title, detail, errors } = this.normalise(exception);

    if (status >= 500) {
      logger.error({ err: exception, code }, 'unhandled error');
    } else {
      logger.warn({ code, status, detail }, 'request failed');
    }

    response
      .status(status)
      .type('application/problem+json')
      .json({
        type: `https://docs.ecommerce.local/errors/${code.toLowerCase()}`,
        title,
        status,
        detail,
        code,
        requestId,
        ...(errors ? { errors } : {}),
      });
  }

  private normalise(exception: unknown): {
    status: number;
    code: ErrorCodeValue;
    title: string;
    detail: string;
    errors?: unknown;
  } {
    if (exception instanceof AppError) {
      return {
        status: exception.getStatus(),
        code: exception.code,
        title: exception.message,
        detail: exception.message,
        errors: exception.details,
      };
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();
      // Nest's ValidationPipe puts the field errors in `message` as an array.
      const fieldErrors =
        typeof body === 'object' && body !== null && 'message' in body && Array.isArray(body.message)
          ? body.message
          : undefined;

      return {
        status,
        code: this.codeForStatus(status),
        title: exception.name,
        detail: fieldErrors ? 'Request validation failed' : exception.message,
        errors: fieldErrors,
      };
    }

    // Anything unrecognised is a bug. Never leak its message or stack to the client.
    return {
      status: 500,
      code: ErrorCode.INTERNAL,
      title: 'Internal Server Error',
      detail: 'An unexpected error occurred.',
    };
  }

  private codeForStatus(status: number): ErrorCodeValue {
    switch (status) {
      case 400:
        return ErrorCode.VALIDATION_FAILED;
      case 401:
        return ErrorCode.UNAUTHENTICATED;
      case 403:
        return ErrorCode.FORBIDDEN;
      case 404:
        return ErrorCode.NOT_FOUND;
      case 409:
        return ErrorCode.CONFLICT;
      case 429:
        return ErrorCode.RATE_LIMITED;
      default:
        return ErrorCode.INTERNAL;
    }
  }
}
