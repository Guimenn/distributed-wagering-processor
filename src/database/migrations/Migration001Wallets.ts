import { Migration } from '@mikro-orm/migrations';

/**
 * As regras financeiras que o banco consegue garantir sozinho ficam aqui, não só no código:
 * saldo nunca negativo, ledger aritmeticamente correto, uma entrada por versão da wallet.
 * FKs DEFERRABLE: o MikroORM decide a ordem dos INSERTs no flush; a checagem fica para o COMMIT.
 */
export class Migration001Wallets extends Migration {
  override up(): void {
    this.addSql(`
CREATE TABLE wallets (
  id          uuid PRIMARY KEY,
  player_id   text NOT NULL,
  currency    char(3) NOT NULL,
  balance     numeric(20,2) NOT NULL CHECK (balance >= 0),
  version     integer NOT NULL CHECK (version >= 1),
  created_at  timestamptz NOT NULL,
  updated_at  timestamptz NOT NULL,
  CONSTRAINT wallets_player_currency_unique UNIQUE (player_id, currency)
);

CREATE TABLE wager_transactions (
  id                       uuid PRIMARY KEY,
  provider_id              text NOT NULL,
  external_transaction_id  text NOT NULL,
  wallet_id                uuid NOT NULL REFERENCES wallets (id) DEFERRABLE INITIALLY DEFERRED,
  player_id                text NOT NULL,
  round_id                 text NOT NULL,
  game_id                  text NOT NULL,
  kind                     text NOT NULL,
  amount                   numeric(20,2) NOT NULL CHECK (amount > 0),
  currency                 char(3) NOT NULL,
  status                   text NOT NULL,
  failure_code             text,
  resulting_balance        numeric(20,2),
  created_at               timestamptz NOT NULL,
  processed_at             timestamptz
);

CREATE TABLE wallet_ledger_entries (
  id              uuid PRIMARY KEY,
  wallet_id       uuid NOT NULL REFERENCES wallets (id) DEFERRABLE INITIALLY DEFERRED,
  transaction_id  uuid NOT NULL UNIQUE REFERENCES wager_transactions (id) DEFERRABLE INITIALLY DEFERRED,
  direction       text NOT NULL CHECK (direction IN ('DEBIT', 'CREDIT')),
  amount          numeric(20,2) NOT NULL CHECK (amount > 0),
  currency        char(3) NOT NULL,
  balance_before  numeric(20,2) NOT NULL,
  balance_after   numeric(20,2) NOT NULL CHECK (balance_after >= 0),
  wallet_version  integer NOT NULL,
  created_at      timestamptz NOT NULL,
  CONSTRAINT ledger_one_entry_per_version UNIQUE (wallet_id, wallet_version),
  CONSTRAINT ledger_balanced CHECK (
    balance_after = balance_before + CASE direction WHEN 'CREDIT' THEN amount ELSE -amount END
  )
);
`);
  }

  override down(): void {
    this.addSql('DROP TABLE wallet_ledger_entries, wager_transactions, wallets;');
  }
}
