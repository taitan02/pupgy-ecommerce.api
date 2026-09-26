import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { PrismaService } from '../../infra/prisma/prisma.service.js';
import { logger } from '../../infra/logger/logger.js';
import { Public } from '../../common/decorators/auth.decorators.js';

@Public()
@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

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

    const healthy = Object.values(checks).every((value) => value === 'ok');
    return { status: healthy ? 'ok' : 'degraded', checks };
  }
}
