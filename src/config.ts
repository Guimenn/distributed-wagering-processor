/** Lido no boot. Os testes sobrescrevem via process.env antes de subir a app. */
export const loadConfig = () => ({
  port: Number(process.env.PORT ?? 3000),
  databaseUrl: process.env.DATABASE_URL ?? 'postgres://wagering:wagering@localhost:5433/wagering',
  runMigrations: process.env.RUN_MIGRATIONS === 'true',
  /** Liga os workers e o consumidor em segundo plano (os testes ligam só o que precisam). */
  runWorkers: process.env.RUN_WORKERS !== 'false',
  runConsumer: process.env.RUN_CONSUMER !== 'false',
  sqs: {
    endpoint: process.env.SQS_ENDPOINT ?? 'http://localhost:4566',
    region: process.env.AWS_REGION ?? 'us-east-1',
    transactionsQueue: process.env.SQS_TRANSACTIONS_QUEUE ?? 'wager-transactions.fifo',
    dlq: process.env.SQS_DLQ ?? 'wager-transactions-dlq.fifo',
    /** Recebimentos sem sucesso antes de a própria fila mover a mensagem para a DLQ. */
    maxReceiveCount: Number(process.env.SQS_MAX_RECEIVE_COUNT ?? 5),
    /** Quanto tempo a mensagem fica invisível depois de recebida (= espera entre tentativas). */
    visibilityTimeoutSeconds: Number(process.env.SQS_VISIBILITY_TIMEOUT ?? 30),
    waitTimeSeconds: Number(process.env.SQS_WAIT_TIME_SECONDS ?? 10),
  },
});
