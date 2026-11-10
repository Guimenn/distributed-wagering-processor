import { loadConfig } from '../config';
import { createOrm } from './database.module';

/** bun run migration:up | migration:down */
const orm = await createOrm(loadConfig().databaseUrl);
const ran = process.argv[2] === 'down' ? await orm.migrator.down() : await orm.migrator.up();
console.log(ran.map((m) => m.name).join(', ') || 'nothing to run');
await orm.close();
