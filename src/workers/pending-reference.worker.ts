import { Injectable, Logger, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';
import { WageringService } from '../application/wagering.service';
import { loadConfig } from '../config';

/** A cada segundo, reprocessa reversões que estavam esperando a referência. */
@Injectable()
export class PendingReferenceWorker implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(PendingReferenceWorker.name);
  private timer?: Timer;
  private running = false;

  constructor(private readonly wagering: WageringService) {}

  onApplicationBootstrap() {
    if (loadConfig().runWorkers) this.timer = setInterval(() => this.tick(), 1000);
  }

  onApplicationShutdown() {
    clearInterval(this.timer);
  }

  /** `running` evita duas rodadas sobrepostas na mesma instância se uma demorar mais de 1s. */
  private async tick() {
    if (this.running) return;
    this.running = true;
    try {
      await this.wagering.retryPendingReferences();
    } catch (e) {
      this.logger.error(e);
    } finally {
      this.running = false;
    }
  }
}
