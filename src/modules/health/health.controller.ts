import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { PrismaService } from '../../infra/prisma/prisma.service.js';
import { RedisService } from '../../infra/redis/redis.service.js';
import { logger } from '../../infra/logger/logger.js';
import { Public } from '../../common/decorators/auth.decorators.js';
import { NotificationService } from '../notifications/notification.service.js';
import { QueueHealthDto } from './queue-health.dto.js';

/**
 * How long a job may sit unclaimed before we call it a stall.
 *
 * Normal processing is milliseconds. This is generous enough to ride out a worker
 * deploy and tight enough that "nobody deployed the worker at all" is caught within
 * two minutes instead of whenever somebody notices the silence.
 */
const STALL_AFTER_SECONDS = 120;

@Public()
@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly notifications: NotificationService,
  ) {}

  /**
   * Liveness: "is the process alive?" It must not touch dependencies — if a
   * failing database made this fail, the orchestrator would restart a healthy
   * process and achieve nothing.
   */
  @Get('live')
  @ApiOperation({ summary: 'Liveness probe' })
  live(): { status: string } {
    return { status: 'ok' };
  }

  /**
   * Readiness: "should traffic be sent here?" This one does check dependencies,
   * because an API that cannot reach its database should be taken out of rotation.
   */
  @Get('ready')
  @ApiOperation({ summary: 'Readiness probe' })
  async ready(): Promise<{ status: string; checks: Record<string, string> }> {
    const checks: Record<string, string> = {};

    try {
      await this.prisma.$queryRaw`SELECT 1`;
      checks.database = 'ok';
    } catch (error) {
      logger.error({ err: error }, 'readiness: database check failed');
      checks.database = 'down';
    }

    // Redis being down degrades the service (rate limiting fails open) but does not
    // make it unable to serve traffic, so it is reported without failing readiness.
    checks.redis = (await this.redis.ping()) ? 'ok' : 'down';

    const healthy = checks.database === 'ok';
    return { status: healthy ? 'ok' : 'degraded', checks };
  }

  /**
   * The detector for a failure mode nothing else catches: the worker is not running.
   *
   * `enqueue` swallows its errors so that a Redis outage delays email instead of
   * failing checkouts, and the API is perfectly healthy with no worker behind it. Both
   * are deliberate, and both mean the system can be broken while looking fine — so the
   * breakage needs somewhere to show.
   *
   * Deliberately not part of `/ready`: a dead worker must not take the API out of
   * rotation, because serving the site is still the right thing to do.
   */
  @Get('queues')
  @ApiOperation({ summary: 'Queue depth and whether anything is consuming' })
  @ApiOkResponse({ type: QueueHealthDto })
  async queues(): Promise<QueueHealthDto> {
    const mail = await this.notifications.stats();
    const stalled = (mail.oldestWaitingSeconds ?? 0) > STALL_AFTER_SECONDS;

    // `failed` is reported but does not set the status: these jobs are kept for days,
    // so one permanently bad address would hold the endpoint red long after anyone
    // could act on it. Alert on it *rising* instead — that is a judgement this
    // endpoint has no memory to make.
    return { status: stalled ? 'stalled' : 'ok', mail };
  }
}
