import { Migration } from '@mikro-orm/migrations';

/**
 * Idempotência garantida pelo banco: a mesma chave (ou o mesmo id do provedor) nunca vira
 * duas transações, nem com duas instâncias recebendo o reenvio ao mesmo tempo.
 */
export class Migration002Idempotency extends Migration {
  override up(): void {
    this.addSql(`
ALTER TABLE wager_transactions ADD COLUMN idempotency_key text, ADD COLUMN payload_hash text;
UPDATE wager_transactions SET idempotency_key = provider_id || ':' || external_transaction_id, payload_hash = '';
ALTER TABLE wager_transactions
  ALTER COLUMN idempotency_key SET NOT NULL,
  ALTER COLUMN payload_hash SET NOT NULL,
  ADD CONSTRAINT wager_transactions_idempotency_key_unique UNIQUE (idempotency_key),
  ADD CONSTRAINT wager_transactions_provider_external_unique UNIQUE (provider_id, external_transaction_id);
`);
  }

  override down(): void {
    this.addSql('ALTER TABLE wager_transactions DROP COLUMN idempotency_key, DROP COLUMN payload_hash;');
  }
}
