const env = (name: string, fallback?: string): string => {
  const value = process.env[name] ?? fallback;
  if (value === undefined) throw new Error(`Missing env var ${name}`);
  return value;
};

/** Lido uma vez no boot. Os testes sobrescrevem via process.env antes de subir a app. */
export const loadConfig = () => ({
  port: Number(env('PORT', '3000')),
  databaseUrl: env('DATABASE_URL', 'postgres://wagering:wagering@localhost:5433/wagering'),
  sqsEndpoint: env('SQS_ENDPOINT', 'http://localhost:4566'),
  awsRegion: env('AWS_REGION', 'us-east-1'),
  queues: {
    transactions: env('SQS_TRANSACTIONS_QUEUE', 'wager-transactions.fifo'),
    dlq: env('SQS_DLQ', 'wager-transactions-dlq.fifo'),
    events: env('SQS_EVENTS_QUEUE', 'wagering-events.fifo'),
  },
  /** Recebimentos antes da redrive mandar para a DLQ. */
  maxReceiveCount: Number(env('SQS_MAX_RECEIVE_COUNT', '5')),
  visibilityTimeoutSeconds: Number(env('SQS_VISIBILITY_TIMEOUT', '30')),
  runConsumer: env('RUN_CONSUMER', 'true') === 'true',
  runWorkers: env('RUN_WORKERS', 'true') === 'true',
  runMigrations: env('RUN_MIGRATIONS', 'false') === 'true',
});

export type AppConfig = ReturnType<typeof loadConfig>;
export const APP_CONFIG = Symbol('APP_CONFIG');
