import { Body, Controller, Get, Headers, Param, Post, Res } from '@nestjs/common';
import type { Response } from 'express';
import { parseWagerRequest, uuid } from '../application/requests';
import { WageringService } from '../application/wagering.service';
import { Status } from '../domain/wager-transaction';

/**
 * 201 processada agora · 200 reenvio de uma já processada · 422 rejeitada por regra de negócio.
 * O reenvio de uma rejeitada continua 422: o provedor decide só pelo status.
 */
function httpStatus(r: { status: Status; idempotentReplay: boolean }): number {
  if (r.status === Status.Rejected) return 422;
  return r.idempotentReplay ? 200 : 201;
}

@Controller()
export class WageringController {
  constructor(private readonly wagering: WageringService) {}

  @Post('wagering/transactions')
  async submit(
    @Body() body: unknown,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.wagering.submit(parseWagerRequest(body, idempotencyKey));
    res.status(httpStatus(result));
    return result;
  }

  @Get('wagering/transactions/:transactionId')
  get(@Param('transactionId') transactionId: string) {
    return this.wagering.get(uuid(transactionId, 'transactionId'));
  }

  @Get('providers/:providerId/wagering/transactions/:externalTransactionId')
  getByExternalId(@Param('providerId') providerId: string, @Param('externalTransactionId') externalTransactionId: string) {
    return this.wagering.getByExternalId(providerId, externalTransactionId);
  }
}
