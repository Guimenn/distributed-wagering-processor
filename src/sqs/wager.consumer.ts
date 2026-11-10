import { Injectable, Logger, type BeforeApplicationShutdown, type OnApplicationBootstrap } from '@nestjs/common';
import type { Message } from '@aws-sdk/client-sqs';
import { AppError, validationError } from '../application/errors';
import { parseWagerRequest } from '../application/requests';
import { WageringService } from '../application/wagering.service';
import { loadConfig } from '../config';
import { Metrics } from '../metrics';
import { SqsService } from './sqs.service';

/**
 * Lê wager-transactions.fifo e chama o MESMO caso de uso do HTTP.
 *
 * Regra de ack (DeleteMessage), sempre depois do COMMIT:
 * - resultado de negócio (processada, rejeitada, pendente, reenvio, 409, 404): ack;
 * - qualquer outro erro (payload inválido, banco fora): sem ack. A mensagem volta depois do
 *   visibility timeout e, após maxReceiveCount tentativas, a própria fila a move para a DLQ.
 */
@Injectable()
export class WagerConsumer implements OnApplicationBootstrap, BeforeApplicationShutdown {
  static readonly NAME = 'wager-consumer';
  private readonly logger = new Logger(WagerConsumer.name);
  private readonly config = loadConfig();
  private running = false;
  private loop?: Promise<void>;

  constructor(
    private readonly sqs: SqsService,
    private readonly wagering: WageringService,
    private readonly metrics: Metrics,
  ) {}

  onApplicationBootstrap() {
    if (!this.config.runConsumer) return;
    this.running = true;
    this.loop = this.poll();
  }

  /** SIGTERM: para de buscar e espera a rodada atual terminar (no máximo o long poll + o lote). */
  async beforeApplicationShutdown() {
    this.running = false;
    await this.loop;
  }

  private async poll() {
    const queue = this.config.sqs.transactionsQueue;
    while (this.running) {
      try {
        const messages = await this.sqs.receive(queue, this.config.sqs.waitTimeSeconds);
        // ponytail: lote em sequência (preserva a ordem por wallet). Paralelizar por MessageGroupId se precisar de vazão.
        for (const message of messages) await this.handle(queue, message);
      } catch (e) {
        this.logger.error(e);
        await Bun.sleep(1000);
      }
    }
  }

  private async handle(queue: string, message: Message) {
    try {
      const { messageId, data } = parseMessage(message.Body);
      const request = parseWagerRequest(data, data.idempotencyKey);
      const inbox = { consumer: WagerConsumer.NAME, messageId };
      const result = await this.metrics.track('sqs', () => this.wagering.submit(request, inbox));
      this.logger.log({ msg: 'message processed', messageId, status: result.status, replay: result.idempotentReplay });
    } catch (e) {
      if (!(e instanceof AppError) || e.status === 400) {
        this.metrics.sqsNotAcked.inc();
        this.logger.warn({ msg: 'message not acked, will be retried or go to DLQ', messageId: message.MessageId, error: (e as Error).message });
        return;
      }
    }
    // Se o ack falhar (ex.: visibility venceu e outra instância já recebeu), a mensagem volta e vira reenvio.
    await this.sqs.delete(queue, message.ReceiptHandle!).catch((e: Error) => this.logger.warn({ msg: 'ack failed', error: e.message }));
  }
}

/** Envelope: { messageId, type: 'WagerTransactionRequested', occurredAt, data: { ...transação, idempotencyKey } }. */
function parseMessage(body: string | undefined) {
  let json: Record<string, unknown>;
  try {
    json = JSON.parse(body ?? '');
  } catch {
    throw validationError('body is not valid JSON');
  }
  if (json?.type !== 'WagerTransactionRequested') throw validationError(`unsupported type ${String(json?.type)}`);
  if (typeof json.messageId !== 'string' || typeof json.data !== 'object' || json.data === null) {
    throw validationError('messageId and data are required');
  }
  return { messageId: json.messageId, data: json.data as Record<string, unknown> };
}
