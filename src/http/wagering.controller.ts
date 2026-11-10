import { Body, Controller, Get, Param, Post, Res } from '@nestjs/common';
import type { Response } from 'express';
import { parseWagerRequest, uuid } from '../application/requests';
import { WageringService } from '../application/wagering.service';
import { Status } from '../domain/wager-transaction';

/** 201 processada · 422 rejeitada por regra de negócio (a transação fica gravada para auditoria). */
const HTTP_STATUS: Partial<Record<Status, number>> = {
  [Status.Processed]: 201,
  [Status.Rejected]: 422,
};

@Controller()
export class WageringController {
  constructor(private readonly wagering: WageringService) {}

  @Post('wagering/transactions')
  async submit(@Body() body: unknown, @Res({ passthrough: true }) res: Response) {
    const result = await this.wagering.submit(parseWagerRequest(body));
    res.status(HTTP_STATUS[result.status] ?? 200);
    return result;
  }

  @Get('wagering/transactions/:transactionId')
  get(@Param('transactionId') transactionId: string) {
    return this.wagering.get(uuid(transactionId, 'transactionId'));
  }
}
