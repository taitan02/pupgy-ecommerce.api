import { Injectable, type OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createTransport, type Transporter } from 'nodemailer';
import { logger } from '../logger/logger.js';
import type { Env } from '../../config/env.schema.js';

export interface MailMessage {
  to: string;
  subject: string;
  html: string;
  /** Sent alongside the HTML. Some clients prefer it, and it is what a screen reader
   *  or a text-only client falls back to. */
  text: string;
}

/**
 * The only place an email leaves the process.
 *
 * One transport for every environment: Mailpit locally, SendGrid's SMTP relay in
 * staging and production (ADR-013). Nothing here knows which — that is the point.
 */
@Injectable()
export class MailService implements OnApplicationShutdown {
  private readonly transporter: Transporter;
  private readonly from: string;

  constructor(private readonly config: ConfigService<Env, true>) {
    const user = config.get('SMTP_USER', { infer: true });
    const pass = config.get('SMTP_PASSWORD', { infer: true });

    this.transporter = createTransport({
      host: config.get('SMTP_HOST', { infer: true }),
      port: config.get('SMTP_PORT', { infer: true }),
      secure: config.get('SMTP_SECURE', { infer: true }),
      // Mailpit accepts anything and needs no credentials; omitting `auth` entirely is
      // not the same as sending empty ones, which it rejects.
      ...(user && pass ? { auth: { user, pass } } : {}),
    });

    this.from = `"${config.get('MAIL_FROM_NAME', { infer: true })}" <${config.get('MAIL_FROM', { infer: true })}>`;
  }

  async send(message: MailMessage): Promise<void> {
    const info = await this.transporter.sendMail({ from: this.from, ...message });
    logger.info({ to: message.to, subject: message.subject, messageId: info.messageId }, 'mail sent');
  }

  /** Proves the credentials and the host are right without sending anything. Used by
   *  the worker at boot, so a misconfigured relay is loud immediately instead of
   *  silent until the first order. */
  async verify(): Promise<boolean> {
    try {
      await this.transporter.verify();
      return true;
    } catch (error) {
      logger.error({ err: error }, 'SMTP verification failed');
      return false;
    }
  }

  onApplicationShutdown(): void {
    this.transporter.close();
  }
}
