import { Money } from '../domain/money';
import { WagerTransaction, type FailureCode, type Kind, type Status } from '../domain/wager-transaction';
import { LedgerEntry, Wallet, type LedgerDirection } from '../domain/wallet';
import type { IntegrationEvent } from '../domain/events';
import type { LedgerRow, OutboxRow, TransactionRow, WalletRow } from './schema';

/** Linha do banco <-> objeto de domínio. O domínio é sempre recriado via rehydrate. */
const money = (amount: string, currency: string) => Money.from({ amount, currency });
const amountOf = (m: Money) => m.toJSON().amount;

export const toWallet = (r: WalletRow) =>
  Wallet.rehydrate({ ...r, balance: money(r.balance, r.currency) });

export const fromWallet = (w: Wallet): WalletRow => ({
  id: w.id, playerId: w.playerId, currency: w.currency, balance: amountOf(w.balance), version: w.version,
  createdAt: w.createdAt, updatedAt: w.updatedAt,
});

export const toTransaction = (r: TransactionRow) =>
  WagerTransaction.rehydrate({
    ...r,
    kind: r.kind as Kind,
    status: r.status as Status,
    money: money(r.amount, r.currency),
    referenceExternalTransactionId: r.referenceExternalTransactionId ?? undefined,
    referenceTransactionId: r.referenceTransactionId ?? undefined,
    failureCode: (r.failureCode ?? undefined) as FailureCode | undefined,
    resultingBalance: r.resultingBalance == null ? undefined : money(r.resultingBalance, r.currency),
    processedAt: r.processedAt ?? undefined,
    nextAttemptAt: r.nextAttemptAt ?? undefined,
  });

export const fromTransaction = (t: WagerTransaction): TransactionRow => {
  const s = t.state;
  return {
    id: s.id, providerId: s.providerId, externalTransactionId: s.externalTransactionId,
    idempotencyKey: s.idempotencyKey, payloadHash: s.payloadHash, walletId: s.walletId,
    playerId: s.playerId, roundId: s.roundId, gameId: s.gameId, kind: s.kind, amount: amountOf(s.money),
    currency: s.money.currency, referenceExternalTransactionId: s.referenceExternalTransactionId ?? null,
    referenceTransactionId: s.referenceTransactionId ?? null, status: s.status, failureCode: s.failureCode ?? null,
    resultingBalance: s.resultingBalance ? amountOf(s.resultingBalance) : null, createdAt: s.createdAt,
    processedAt: s.processedAt ?? null, attempts: s.attempts, nextAttemptAt: s.nextAttemptAt ?? null,
  };
};

export const toLedgerEntry = (r: LedgerRow) =>
  LedgerEntry.rehydrate({
    ...r,
    direction: r.direction as LedgerDirection,
    money: money(r.amount, r.currency),
    balanceBefore: money(r.balanceBefore, r.currency),
    balanceAfter: money(r.balanceAfter, r.currency),
  });

export const fromLedgerEntry = (e: LedgerEntry): LedgerRow => ({
  id: e.id, walletId: e.walletId, transactionId: e.transactionId, direction: e.direction, amount: amountOf(e.money),
  currency: e.money.currency, balanceBefore: amountOf(e.balanceBefore), balanceAfter: amountOf(e.balanceAfter),
  walletVersion: e.walletVersion, createdAt: e.createdAt,
});

export const toOutboxRow = (e: IntegrationEvent): OutboxRow => ({
  id: e.eventId, eventType: e.eventType, aggregateId: e.aggregateId, payload: e, createdAt: new Date(e.occurredAt),
  publishedAt: null,
});
