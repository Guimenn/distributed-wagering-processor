import { Injectable, Logger, type NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';

/**
 * Uma linha de log JSON por requisição, com correlationId (do header x-correlation-id ou gerado).
 * O mesmo id volta no header da resposta, para o provedor cruzar com os logs dele.
 * Nunca loga o corpo (dados de jogador e valores).
 */
@Injectable()
export class RequestLogMiddleware implements NestMiddleware {
  private readonly logger = new Logger('HTTP');

  use(req: Request, res: Response, next: NextFunction) {
    const correlationId = req.header('x-correlation-id') ?? Bun.randomUUIDv7();
    const started = performance.now();
    res.setHeader('x-correlation-id', correlationId);
    res.on('finish', () =>
      this.logger.log({
        correlationId, method: req.method, path: req.originalUrl, status: res.statusCode,
        durationMs: Math.round(performance.now() - started),
      }),
    );
    next();
  }
}
