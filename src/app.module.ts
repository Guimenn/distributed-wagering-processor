import { Module } from '@nestjs/common';
import { WageringService } from './application/wagering.service';
import { WalletsService } from './application/wallets.service';
import { DatabaseModule } from './database/database.module';
import { HealthController } from './http/health.controller';
import { WageringController } from './http/wagering.controller';
import { WalletsController } from './http/wallets.controller';

@Module({
  imports: [DatabaseModule],
  controllers: [HealthController, WalletsController, WageringController],
  providers: [WalletsService, WageringService],
})
export class AppModule {}
