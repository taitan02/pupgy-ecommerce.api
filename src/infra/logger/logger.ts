import pino from 'pino';
import { RequestContext } from '../../common/context/request-context.js';

const isDev = process.env.NODE_ENV !== 'production';

export const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  // Anything listed here is replaced before it is ever written. Logs get shipped,
  // indexed and read by people; credentials must not travel with them.
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'res.headers["set-cookie"]',
      '*.password',
      '*.refreshToken',
      '*.accessToken',
    ],
    censor: '[redacted]',
  },
  // Attached to every line, so a log search by requestId returns the whole request.
  mixin() {
    const requestId = RequestContext.requestId();
    return requestId ? { requestId } : {};
  },
  transport: isDev
    ? { target: 'pino-pretty', options: { colorize: true, translateTime: 'HH:MM:ss.l' } }
    : undefined,
});
