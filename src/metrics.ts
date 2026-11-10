import { Injectable } from '@nestjs/common';
import { Counter, Histogram, Registry } from 'prom-client';

/** Métricas Prometheus em GET /metrics. Registry por instância da app (vários apps no mesmo processo de teste). */
@Injectable()
export class Metrics {
  readonly registry = new Registry();

  readonly transactions = new Counter({
    name: 'wager_transactions_total', help: 'Transações por resultado e canal',
    labelNames: ['status', 'source', 'replay'], registers: [this.registry],
  });
  readonly latency = new Histogram({
    name: 'wager_processing_seconds', help: 'Tempo para processar uma transação', labelNames: ['source'],
    buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5], registers: [this.registry],
  });
  readonly sqsNotAcked = new Counter({
    name: 'sqs_messages_not_acked_total', help: 'Mensagens que voltam para a fila (retry; depois de N, DLQ)', registers: [this.registry],
  });
  readonly outboxPublished = new Counter({ name: 'outbox_published_total', help: 'Eventos publicados', registers: [this.registry] });
  readonly reconciliationMismatches = new Counter({
    name: 'reconciliation_mismatches_total', help: 'Reconciliações com divergência', registers: [this.registry],
  });

  /** Mede e conta uma submissão (HTTP ou SQS). */
  async track<T extends { status: string; idempotentReplay: boolean }>(source: 'http' | 'sqs', run: () => Promise<T>): Promise<T> {
    const end = this.latency.startTimer({ source });
    const result = await run();
    end();
    this.transactions.inc({ status: result.status, source, replay: String(result.idempotentReplay) });
    return result;
  }
}
