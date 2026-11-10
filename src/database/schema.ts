import { EntitySchema } from '@mikro-orm/core';

/**
 * Formato das tabelas para o MikroORM. Ficam separados do domínio (o domínio não conhece o ORM);
 * mappers.ts converte nos dois sentidos. Dinheiro é string: numeric(20,2) volta do pg como string exata.
 */
export class WalletRow {
  id!: string;
  playerId!: string;
  currency!: string;
  balance!: string;
  version!: number;
  createdAt!: Date;
  updatedAt!: Date;
}

export class TransactionRow {
  id!: string;
  providerId!: string;
  externalTransactionId!: string;
  idempotencyKey!: string;
  payloadHash!: string;
  walletId!: string;
  playerId!: string;
  roundId!: string;
  gameId!: string;
  kind!: string;
  amount!: string;
  currency!: string;
  referenceExternalTransactionId!: string | null;
  referenceTransactionId!: string | null;
  status!: string;
  failureCode!: string | null;
  resultingBalance!: string | null;
  createdAt!: Date;
  processedAt!: Date | null;
}

export class LedgerRow {
  id!: string;
  walletId!: string;
  transactionId!: string;
  direction!: string;
  amount!: string;
  currency!: string;
  balanceBefore!: string;
  balanceAfter!: string;
  walletVersion!: number;
  createdAt!: Date;
}

const money = { type: 'decimal', precision: 20, scale: 2 } as const;
const nullable = { nullable: true } as const;

export const Wallets = new EntitySchema<WalletRow>({
  class: WalletRow,
  tableName: 'wallets',
  properties: {
    id: { type: 'uuid', primary: true },
    playerId: { type: 'text' },
    currency: { type: 'string', length: 3 },
    balance: money,
    version: { type: 'integer' },
    createdAt: { type: 'datetime' },
    updatedAt: { type: 'datetime' },
  },
});

export const Transactions = new EntitySchema<TransactionRow>({
  class: TransactionRow,
  tableName: 'wager_transactions',
  properties: {
    id: { type: 'uuid', primary: true },
    providerId: { type: 'text' },
    externalTransactionId: { type: 'text' },
    idempotencyKey: { type: 'text' },
    payloadHash: { type: 'text' },
    walletId: { type: 'uuid' },
    playerId: { type: 'text' },
    roundId: { type: 'text' },
    gameId: { type: 'text' },
    kind: { type: 'text' },
    amount: money,
    currency: { type: 'string', length: 3 },
    referenceExternalTransactionId: { type: 'text', ...nullable },
    referenceTransactionId: { type: 'uuid', ...nullable },
    status: { type: 'text' },
    failureCode: { type: 'text', ...nullable },
    resultingBalance: { ...money, ...nullable },
    createdAt: { type: 'datetime' },
    processedAt: { type: 'datetime', ...nullable },
  },
});

export const Ledger = new EntitySchema<LedgerRow>({
  class: LedgerRow,
  tableName: 'wallet_ledger_entries',
  properties: {
    id: { type: 'uuid', primary: true },
    walletId: { type: 'uuid' },
    transactionId: { type: 'uuid' },
    direction: { type: 'text' },
    amount: money,
    currency: { type: 'string', length: 3 },
    balanceBefore: money,
    balanceAfter: money,
    walletVersion: { type: 'integer' },
    createdAt: { type: 'datetime' },
  },
});

export const ENTITIES = [Wallets, Transactions, Ledger];
