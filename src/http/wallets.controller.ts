import { Body, Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { parseCreateWallet, uuid } from '../application/requests';
import { WalletsService } from '../application/wallets.service';

@Controller('wallets')
export class WalletsController {
  constructor(private readonly wallets: WalletsService) {}

  @Post()
  create(@Body() body: unknown) {
    return this.wallets.create(parseCreateWallet(body));
  }

  @Get(':walletId')
  get(@Param('walletId') walletId: string) {
    return this.wallets.get(uuid(walletId, 'walletId'));
  }

  @Post(':walletId/reconciliation')
  @HttpCode(200)
  reconcile(@Param('walletId') walletId: string) {
    return this.wallets.reconcile(uuid(walletId, 'walletId'));
  }

  @Get(':walletId/ledger')
  ledger(@Param('walletId') walletId: string, @Query('cursor') cursor?: string, @Query('limit') limit = '50') {
    return this.wallets.ledger(uuid(walletId, 'walletId'), cursor || undefined, Number(limit));
  }
}
