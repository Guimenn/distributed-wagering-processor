import { Migration } from '@mikro-orm/migrations';

/**
 * Inbox: "esta mensagem já foi consumida". Gravada na MESMA transação que muda o saldo,
 * então ou as duas coisas ficam no banco, ou nenhuma.
 */
export class Migration005Inbox extends Migration {
  override up(): void {
    this.addSql(`
CREATE TABLE inbox_messages (
  consumer_name  text NOT NULL,
  message_id     text NOT NULL,
  transaction_id uuid NOT NULL,
  received_at    timestamptz NOT NULL,
  PRIMARY KEY (consumer_name, message_id)
);
`);
  }

  override down(): void {
    this.addSql('DROP TABLE inbox_messages;');
  }
}
