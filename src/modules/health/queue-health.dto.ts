import { ApiProperty } from '@nestjs/swagger';

export class MailQueueStatsDto {
  @ApiProperty({ description: 'Enqueued and not yet picked up' }) waiting!: number;
  @ApiProperty({ description: 'Being processed right now' }) active!: number;
  @ApiProperty({ description: 'Scheduled for later, or waiting out a retry backoff' })
  delayed!: number;
  @ApiProperty({ description: 'Gave up after every attempt. Alert on this increasing.' })
  failed!: number;
  @ApiProperty({
    nullable: true,
    type: Number,
    description: 'Age of the oldest waiting job. Climbing means nothing is consuming.',
  })
  oldestWaitingSeconds!: number | null;
}

export class QueueHealthDto {
  @ApiProperty({
    enum: ['ok', 'stalled'],
    description: '`stalled` means work is queued and no worker is taking it',
  })
  status!: string;

  @ApiProperty({ type: MailQueueStatsDto }) mail!: MailQueueStatsDto;
}
