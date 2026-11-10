import 'reflect-metadata';
import { ConsoleLogger, type LogLevel } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { loadConfig } from './config';
import { ErrorFilter } from './http/error-filter';

export async function createApp() {
  // Logs em JSON (uma linha por evento), prontos para um coletor. LOG_LEVEL=log mostra também os informativos.
  const levels: LogLevel[] = ['fatal', 'error', 'warn', 'log', 'debug', 'verbose'];
  const minimum = (process.env.LOG_LEVEL ?? 'log') as LogLevel;
  const logger = new ConsoleLogger({ json: true, logLevels: levels.slice(0, levels.indexOf(minimum) + 1) });
  const app = await NestFactory.create(AppModule, { logger });
  app.useGlobalFilters(new ErrorFilter());
  app.enableShutdownHooks();
  return app;
}

if (import.meta.main) {
  const app = await createApp();
  await app.listen(loadConfig().port);
}
