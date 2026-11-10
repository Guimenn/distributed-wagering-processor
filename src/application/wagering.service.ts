import { Injectable } from '@nestjs/common';
import { MikroORM } from '@mikro-orm/postgresql';
import { WagerTransaction } from '../domain/wager-transaction';
import { fromLedgerEntry, fromTransaction, fromWallet, toTransaction, toWallet } from '../database/mappers';
import { Ledger, Transactions, Wallets } from '../database/schema';
import { notFound } from './errors';
import type { WagerRequest } from './requests';

export const transactionView = (t: WagerTransaction) => {
  const s = t.state;
  return {
    transactionId: s.id, providerId: s.providerId, externalTransactionId: s.externalTransactionId,
    walletId: s.walletId, playerId: s.playerId, roundId: s.roundId, gameId: s.gameId, kind: s.kind,
    money: s.money.toJSON(), status: s.status, failureCode: s.failureCode,
    balance: s.resultingBalance?.toJSON(), createdAt: s.createdAt.toISOString(), processedAt: s.processedAt?.toISOString(),
  };
};

@Injectable()
export class WageringService {
  constructor(private readonly orm: MikroORM) {}

  /** Lê a wallet, aplica as regras e grava transação + lançamento + saldo na mesma transação SQL. */
  async submit(req: WagerRequest) {
    return this.orm.em.fork().transactional(async (em) => {
      const row = await em.findOne(Wallets, { id: req.walletId });
      if (!row) throw notFound('WALLET', req.walletId);
      const wallet = toWallet(row);
      const now = new Date();

      const tx = WagerTransaction.create(req, now);
      const entry = tx.applyTo(wallet, now);

      em.create(Transactions, fromTransaction(tx));
      if (entry) {
        em.create(Ledger, fromLedgerEntry(entry));
        em.assign(row, fromWallet(wallet));
      }
      return transactionView(tx);
    });
  }

  async get(id: string) {
    const row = await this.orm.em.fork().findOne(Transactions, { id });
    if (!row) throw notFound('TRANSACTION', id);
    return transactionView(toTransaction(row));
  }
}
