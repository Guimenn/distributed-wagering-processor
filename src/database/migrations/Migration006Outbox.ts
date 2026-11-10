import { Migration } from '@mikro-orm/migrations';

/**
 * Outbox: eventos gravados na MESMA transação da mudança de saldo e publicados depois por um worker.
 * Sem ela, ou o evento sai e o COMMIT falha (evento falso), ou o COMMIT passa e o envio falha (evento perdido).
 */
export class Migration006Outbox extends Migration {
  override up(): void {
    this.addSql(`
CREATE TABLE outbox_messages (
  id            uuid PRIMARY KEY,
  event_type    text NOT NULL,
  aggregate_id  text NOT NULL,
  payload       jsonb NOT NULL,
  created_at    timestamptz NOT NULL,
  published_at  timestamptz
);
CREATE INDEX outbox_messages_pending ON outbox_messages (created_at) WHERE published_at IS NULL;
`);
  }

  override down(): void {
    this.addSql('DROP TABLE outbox_messages;');
  }
}
