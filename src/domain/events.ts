import { Status, type WagerTransaction } from './wager-transaction';
import type { LedgerEntry } from './wallet';

/** Envelope publicado na fila de eventos. eventId deduplica do lado de quem consome. */
export interface IntegrationEvent {
  eventId: string;
  eventType: string;
  aggregateId: string;
  occurredAt: string;
  version: 1;
  data: Record<string, unknown>;
}

const event = (eventType: string, aggregateId: string, data: Record<string, unknown>): IntegrationEvent => ({
  eventId: Bun.randomUUIDv7(), eventType, aggregateId, occurredAt: new Date().toISOString(), version: 1, data,
});

/** O que avisar ao mundo depois de uma transação: depende só do resultado dela. */
export function transactionEvents(tx: WagerTransaction, entry?: LedgerEntry): IntegrationEvent[] {
  const s = tx.state;
  const data = {
    transactionId: s.id, providerId: s.providerId, externalTransactionId: s.externalTransactionId, walletId: s.walletId,
    playerId: s.playerId, roundId: s.roundId, gameId: s.gameId, kind: s.kind, money: s.money.toJSON(), status: s.status,
    balance: s.resultingBalance?.toJSON(), referenceExternalTransactionId: s.referenceExternalTransactionId,
  };
  switch (s.status) {
    case Status.Processed:
      return [event('WagerTransactionProcessed', s.id, data), ...(entry ? [balanceChanged(entry)] : [])];
    case Status.Rejected:
      return [event('WagerTransactionRejected', s.id, { ...data, failureCode: s.failureCode })];
    case Status.PendingReference:
      // Só na primeira vez: reagendar não é novidade para ninguém.
      return s.attempts === 1 ? [event('WagerTransactionPendingReference', s.id, { ...data, nextAttemptAt: s.nextAttemptAt })] : [];
    case Status.Pending:
      return [];
  }
}

const balanceChanged = (e: LedgerEntry) =>
  event('WalletBalanceChanged', e.walletId, {
    walletId: e.walletId, transactionId: e.transactionId, direction: e.direction, money: e.money.toJSON(),
    balanceBefore: e.balanceBefore.toJSON(), balanceAfter: e.balanceAfter.toJSON(), walletVersion: e.walletVersion,
  });
