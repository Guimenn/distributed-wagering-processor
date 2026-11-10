import { Injectable } from '@nestjs/common';
import { UniqueConstraintViolationException } from '@mikro-orm/core';
import { MikroORM } from '@mikro-orm/postgresql';
import type { Money } from '../domain/money';
import { WagerTransaction } from '../domain/wager-transaction';
import { Wallet, type LedgerEntry } from '../domain/wallet';
import { transactionEvents } from '../domain/events';
import { fromLedgerEntry, fromTransaction, fromWallet, toLedgerEntry, toOutboxRow, toWallet } from '../database/mappers';
import { Ledger, Outbox, Transactions, Wallets } from '../database/schema';
import { conflict, notFound, validationError } from './errors';

export const walletView = (w: Wallet) => ({ id: w.id, playerId: w.playerId, balance: w.balance.toJSON(), version: w.version });

const entryView = (e: LedgerEntry) => ({
  id: e.id, transactionId: e.transactionId, direction: e.direction, money: e.money.toJSON(),
  balanceBefore: e.balanceBefore.toJSON(), balanceAfter: e.balanceAfter.toJSON(), walletVersion: e.walletVersion,
  createdAt: e.createdAt.toISOString(),
});

@Injectable()
export class WalletsService {
  constructor(private readonly orm: MikroORM) {}

  /** Wallet + transação OPENING + lançamento inicial: tudo ou nada (uma transação SQL). */
  async create(input: { playerId: string; initialBalance: Money }) {
    const wallet = Wallet.open({ ...input, now: new Date() });
    try {
      await this.orm.em.fork().transactional(async (em) => {
        em.create(Wallets, fromWallet(wallet));
        if (!wallet.balance.isPositive()) return; // saldo 0: nada a lançar
        const opening = WagerTransaction.opening(wallet);
        em.create(Transactions, fromTransaction(opening));
        const entry = wallet.openingEntry(opening.id);
        em.create(Ledger, fromLedgerEntry(entry));
        for (const event of transactionEvents(opening, entry)) em.create(Outbox, toOutboxRow(event));
      });
    } catch (e) {
      if (e instanceof UniqueConstraintViolationException) {
        throw conflict('WALLET_ALREADY_EXISTS', 'A wallet already exists for this player and currency');
      }
      throw e;
    }
    return walletView(wallet);
  }

  async get(id: string) {
    const row = await this.orm.em.fork().findOne(Wallets, { id });
    if (!row) throw notFound('WALLET', id);
    return walletView(toWallet(row));
  }

  /** Paginação por cursor = wallet_version (estável: o ledger só cresce). Mais novo primeiro. */
  async ledger(walletId: string, cursor: string | undefined, limit: number) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 200) throw validationError('limit must be 1..200');
    if (cursor !== undefined && !/^\d+$/.test(cursor)) throw validationError('invalid cursor');
    await this.get(walletId);
    const rows = await this.orm.em.fork().find(
      Ledger,
      cursor ? { walletId, walletVersion: { $lt: Number(cursor) } } : { walletId },
      { orderBy: { walletVersion: 'desc' }, limit },
    );
    const last = rows.at(-1);
    return {
      items: rows.map((r) => entryView(toLedgerEntry(r))),
      nextCursor: rows.length === limit && last ? String(last.walletVersion) : null,
    };
  }
}
