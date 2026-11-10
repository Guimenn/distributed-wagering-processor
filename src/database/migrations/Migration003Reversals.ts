import { Migration } from '@mikro-orm/migrations';

/**
 * REFUND/ROLLBACK apontam para a transação que revertem.
 * O índice único parcial é a garantia final de "uma reversão por transação",
 * mesmo que duas cheguem ao mesmo tempo.
 */
export class Migration003Reversals extends Migration {
  override up(): void {
    this.addSql(`
ALTER TABLE wager_transactions
  ADD COLUMN reference_external_transaction_id text,
  ADD COLUMN reference_transaction_id uuid REFERENCES wager_transactions (id) DEFERRABLE INITIALLY DEFERRED;

CREATE UNIQUE INDEX wager_transactions_one_reversal ON wager_transactions (reference_transaction_id)
  WHERE kind IN ('REFUND', 'ROLLBACK') AND status = 'PROCESSED';
`);
  }

  override down(): void {
    this.addSql(`
DROP INDEX wager_transactions_one_reversal;
ALTER TABLE wager_transactions DROP COLUMN reference_external_transaction_id, DROP COLUMN reference_transaction_id;
`);
  }
}
