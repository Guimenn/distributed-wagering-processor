/** Lido no boot. Os testes sobrescrevem via process.env antes de subir a app. */
export const loadConfig = () => ({
  port: Number(process.env.PORT ?? 3000),
  databaseUrl: process.env.DATABASE_URL ?? 'postgres://wagering:wagering@localhost:5433/wagering',
  runMigrations: process.env.RUN_MIGRATIONS === 'true',
});
