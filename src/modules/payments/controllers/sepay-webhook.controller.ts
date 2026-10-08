import { Controller, HttpCode, Post, Req } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import { SepayWebhookService } from '../services/sepay-webhook.service.js';
import { Public } from '../../../common/decorators/auth.decorators.js';
import type { WebhookAckDto } from '../dto/payment.dto.js';

/**
 * SePay's callback. Public by necessity and authenticated by signature, not by token.
 *
 * One path, not one per shop: there is a single SePay account and it belongs to the
 * platform (ADR-015). The secret comes from the environment, so there is nothing in the
 * URL to resolve before the signature can be checked.
 *
 * Excluded from the published contract: it is not an endpoint anyone integrates
 * against, and the shape is SePay's to define, not ours to promise.
 *
 * The response contract is theirs too — HTTP 200 with `{"success": true}`, inside 30
 * seconds — so nothing slow belongs on this path. Anything that is not an outright
 * rejection answers 200, because SePay retries seven times over five hours and a
 * transfer we cannot match will not become matchable by being sent again.
 */
@ApiExcludeController()
@Public()
@Controller('webhooks/sepay')
export class SepayWebhookController {
  constructor(private readonly webhook: SepayWebhookService) {}

  @Post()
  @HttpCode(200)
  async receive(@Req() request: RawBodyRequest<Request>): Promise<WebhookAckDto> {
    // Without this the signature would be computed over re-serialised JSON and never
    // match. If it is ever missing, that is a bootstrap misconfiguration, not a
    // malformed request — so it fails loudly rather than as "invalid signature".
    if (!request.rawBody) {
      throw new Error('rawBody is not enabled — see createApp()');
    }

    await this.webhook.handle({ rawBody: request.rawBody, headers: request.headers });

    return { success: true };
  }
}
