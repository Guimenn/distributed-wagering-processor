import { Controller, Get, Header, Res } from '@nestjs/common';
import type { Response } from 'express';
import { MikroORM } from '@mikro-orm/postgresql';
import { GetQueueAttributesCommand } from '@aws-sdk/client-sqs';
import { loadConfig } from '../config';
import { Metrics } from '../metrics';
import { SqsService } from '../sqs/sqs.service';

/** Sem autenticação por desenho. live = o processo responde; ready = Postgres e SQS alcançáveis. */
@Controller()
export class HealthController {
  constructor(
    private readonly orm: MikroORM,
    private readonly sqs: SqsService,
    private readonly metrics: Metrics,
  ) {}

  @Get('health/live')
  live() {
    return { status: 'ok' };
  }

  @Get('health/ready')
  async ready(@Res({ passthrough: true }) res: Response) {
    const queueUrl = this.sqs.urls[loadConfig().sqs.transactionsQueue];
    const [postgres, sqs] = await Promise.all([
      up(this.orm.em.fork().execute('SELECT 1')),
      up(this.sqs.client.send(new GetQueueAttributesCommand({ QueueUrl: queueUrl, AttributeNames: ['QueueArn'] }))),
    ]);
    if (!postgres || !sqs) res.status(503);
    return { status: postgres && sqs ? 'ok' : 'unavailable', postgres, sqs };
  }

  @Get('metrics')
  @Header('content-type', 'text/plain; version=0.0.4')
  async scrape() {
    return this.metrics.registry.metrics();
  }
}

/** true se a checagem responde em até 2s. */
const up = (probe: Promise<unknown>) =>
  Promise.race([probe.then(() => true), Bun.sleep(2000).then(() => false)]).catch(() => false);
