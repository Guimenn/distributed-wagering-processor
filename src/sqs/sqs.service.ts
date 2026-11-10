import { Injectable, type OnModuleInit } from '@nestjs/common';
import {
  CreateQueueCommand, DeleteMessageCommand, GetQueueAttributesCommand, ReceiveMessageCommand, SendMessageCommand,
  SQSClient,
} from '@aws-sdk/client-sqs';
import { loadConfig } from '../config';

/** Cria as filas no boot (CreateQueue é idempotente) e expõe só as operações que o app usa. */
@Injectable()
export class SqsService implements OnModuleInit {
  private readonly config = loadConfig().sqs;
  readonly client = new SQSClient({
    endpoint: this.config.endpoint,
    region: this.config.region,
    credentials: { accessKeyId: process.env.AWS_ACCESS_KEY_ID ?? 'test', secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY ?? 'test' },
  });
  readonly urls: Record<string, string> = {};

  async onModuleInit() {
    const fifo = { FifoQueue: 'true' };
    const dlqUrl = await this.create(this.config.dlq, fifo);
    const { Attributes } = await this.client.send(new GetQueueAttributesCommand({ QueueUrl: dlqUrl, AttributeNames: ['QueueArn'] }));
    // RedrivePolicy: depois de maxReceiveCount recebimentos sem DeleteMessage, o SQS move a mensagem para a DLQ.
    await this.create(this.config.transactionsQueue, {
      ...fifo,
      VisibilityTimeout: String(this.config.visibilityTimeoutSeconds),
      RedrivePolicy: JSON.stringify({ deadLetterTargetArn: Attributes!.QueueArn, maxReceiveCount: this.config.maxReceiveCount }),
    });
    await this.create(this.config.eventsQueue, fifo);
  }

  async receive(queue: string, waitTimeSeconds: number) {
    const out = await this.client.send(
      new ReceiveMessageCommand({ QueueUrl: this.urls[queue], MaxNumberOfMessages: 10, WaitTimeSeconds: waitTimeSeconds }),
    );
    return out.Messages ?? [];
  }

  async delete(queue: string, receiptHandle: string) {
    await this.client.send(new DeleteMessageCommand({ QueueUrl: this.urls[queue], ReceiptHandle: receiptHandle }));
  }

  /** FIFO: groupId define a ordem (mesmo grupo = em sequência); dedupId descarta envios repetidos por 5 min. */
  async send(queue: string, body: string, groupId: string, deduplicationId: string) {
    await this.client.send(
      new SendMessageCommand({ QueueUrl: this.urls[queue], MessageBody: body, MessageGroupId: groupId, MessageDeduplicationId: deduplicationId }),
    );
  }

  private async create(name: string, attributes: Record<string, string>) {
    const { QueueUrl } = await this.client.send(new CreateQueueCommand({ QueueName: name, Attributes: attributes }));
    this.urls[name] = QueueUrl!;
    return QueueUrl!;
  }
}
