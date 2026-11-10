import { Migration } from '@mikro-orm/migrations';

/** Reversões esperando a referência: contador de tentativas e quando tentar de novo. */
export class Migration004PendingReference extends Migration {
  override up(): void {
    this.addSql(`
ALTER TABLE wager_transactions
  ADD COLUMN attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN next_attempt_at timestamptz;

CREATE INDEX wager_transactions_pending_due ON wager_transactions (next_attempt_at) WHERE status = 'PENDING_REFERENCE';
`);
  }

  override down(): void {
    this.addSql('ALTER TABLE wager_transactions DROP COLUMN attempts, DROP COLUMN next_attempt_at;');
  }
}
