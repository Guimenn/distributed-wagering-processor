import { Injectable, Logger, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';
import { LockMode } from '@mikro-orm/core';
import { MikroORM } from '@mikro-orm/postgresql';
import { loadConfig } from '../config';
import { Outbox } from '../database/schema';
import { SqsService } from '../sqs/sqs.service';

/**
 * Publica a outbox na fila de eventos a cada segundo.
 * FOR UPDATE SKIP LOCKED: várias instâncias pegam lotes diferentes, sem esperar umas pelas outras.
 * Se o processo morrer depois de enviar e antes do COMMIT, o lote é enviado de novo (at-least-once);
 * o eventId vai como MessageDeduplicationId e quem consome deduplica por ele.
 */
@Injectable()
export class OutboxWorker implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(OutboxWorker.name);
  private readonly config = loadConfig();
  private timer?: Timer;
  private running = false;

  constructor(
    private readonly orm: MikroORM,
    private readonly sqs: SqsService,
  ) {}

  onApplicationBootstrap() {
    if (this.config.runWorkers) this.timer = setInterval(() => this.tick(), 1000);
  }

  onApplicationShutdown() {
    clearInterval(this.timer);
  }

  /** Publica um lote; devolve quantos eventos saíram. Erro no envio = rollback, tenta no próximo tick. */
  async publishOnce(limit = 50): Promise<number> {
    return this.orm.em.fork().transactional(async (em) => {
      const pending = await em.find(
        Outbox,
        { publishedAt: null },
        { lockMode: LockMode.PESSIMISTIC_PARTIAL_WRITE, orderBy: { createdAt: 'asc' }, limit },
      );
      for (const message of pending) {
        await this.sqs.send(this.config.sqs.eventsQueue, JSON.stringify(message.payload), message.aggregateId, message.id);
        message.publishedAt = new Date();
      }
      return pending.length;
    });
  }

  private async tick() {
    if (this.running) return;
    this.running = true;
    try {
      await this.publishOnce();
    } catch (e) {
      this.logger.error(e);
    } finally {
      this.running = false;
    }
  }
}
