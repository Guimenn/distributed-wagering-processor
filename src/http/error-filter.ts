import { type ArgumentsHost, Catch, type ExceptionFilter, HttpException, Logger } from '@nestjs/common';
import type { Response } from 'express';
import { AppError } from '../application/errors';
import { DomainError } from '../domain/errors';

/** Um lugar só para traduzir erro em HTTP. Corpo sempre { code, message }. */
@Catch()
export class ErrorFilter implements ExceptionFilter {
  private readonly logger = new Logger('ErrorFilter');

  catch(error: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();
    const [status, code, message] = this.map(error);
    if (status >= 500) this.logger.error(error);
    res.status(status).json({ code, message });
  }

  private map(error: unknown): [number, string, string] {
    if (error instanceof AppError) return [error.status, error.code, error.message];
    if (error instanceof DomainError) return [400, 'VALIDATION_ERROR', error.message];
    if (error instanceof HttpException) return [error.getStatus(), 'HTTP_ERROR', error.message];
    return [500, 'INTERNAL_ERROR', 'Unexpected error'];
  }
}
