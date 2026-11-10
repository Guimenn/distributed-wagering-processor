import { type MiddlewareConsumer, Module, type NestModule } from '@nestjs/common';
import { WageringService } from './application/wagering.service';
import { WalletsService } from './application/wallets.service';
import { DatabaseModule } from './database/database.module';
import { HealthController } from './http/health.controller';
import { RequestLogMiddleware } from './http/request-log.middleware';
import { WageringController } from './http/wagering.controller';
import { WalletsController } from './http/wallets.controller';
import { Metrics } from './metrics';
import { SqsService } from './sqs/sqs.service';
import { WagerConsumer } from './sqs/wager.consumer';
import { OutboxWorker } from './workers/outbox.worker';
import { PendingReferenceWorker } from './workers/pending-reference.worker';

@Module({
  imports: [DatabaseModule],
  controllers: [HealthController, WalletsController, WageringController],
  providers: [WalletsService, WageringService, PendingReferenceWorker, SqsService, WagerConsumer, OutboxWorker, Metrics],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(RequestLogMiddleware).forRoutes('*');
  }
}
