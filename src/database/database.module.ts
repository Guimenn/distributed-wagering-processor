import { Global, Module, type OnApplicationShutdown } from '@nestjs/common';
import { MikroORM, defineConfig } from '@mikro-orm/postgresql';
import { Migrator } from '@mikro-orm/migrations';
import { loadConfig } from '../config';
import { ENTITIES } from './schema';
import { Migration001Wallets } from './migrations/Migration001Wallets';

/** Lista explícita (sem glob): funciona igual no Bun, no Docker e nos testes. */
const MIGRATIONS = [Migration001Wallets];

export const createOrm = (clientUrl: string) =>
  MikroORM.init(
    defineConfig({
      clientUrl,
      entities: ENTITIES,
      extensions: [Migrator],
      migrations: {
        migrationsList: MIGRATIONS.map((m) => ({ name: m.name, class: m })),
        snapshot: false,
        allOrNothing: true,
      },
    }),
  );

/** Expõe o MikroORM para toda a aplicação (os casos de uso usam orm.em direto). */
@Global()
@Module({
  providers: [
    {
      provide: MikroORM,
      useFactory: async () => {
        const config = loadConfig();
        const orm = await createOrm(config.databaseUrl);
        if (config.runMigrations) await orm.migrator.up();
        return orm;
      },
    },
  ],
  exports: [MikroORM],
})
export class DatabaseModule implements OnApplicationShutdown {
  constructor(private readonly orm: MikroORM) {}

  async onApplicationShutdown() {
    await this.orm.close();
  }
}
