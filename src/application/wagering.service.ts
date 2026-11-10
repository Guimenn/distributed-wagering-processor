import { Injectable } from '@nestjs/common';
import { LockMode, UniqueConstraintViolationException } from '@mikro-orm/core';
import { MikroORM, type EntityManager } from '@mikro-orm/postgresql';
import { Kind, Status, WagerTransaction, type Reference } from '../domain/wager-transaction';
import { fromLedgerEntry, fromTransaction, fromWallet, toTransaction, toWallet } from '../database/mappers';
import { Ledger, Transactions, Wallets, type TransactionRow } from '../database/schema';
import { conflict, notFound } from './errors';
import { payloadHash, type WagerRequest } from './requests';

export const transactionView = (t: WagerTransaction, idempotentReplay = false) => {
  const s = t.state;
  return {
    transactionId: s.id, providerId: s.providerId, externalTransactionId: s.externalTransactionId,
    walletId: s.walletId, playerId: s.playerId, roundId: s.roundId, gameId: s.gameId, kind: s.kind,
    money: s.money.toJSON(), referenceExternalTransactionId: s.referenceExternalTransactionId,
    status: s.status, failureCode: s.failureCode,
    balance: s.resultingBalance?.toJSON(), createdAt: s.createdAt.toISOString(), processedAt: s.processedAt?.toISOString(),
    idempotentReplay,
  };
};

@Injectable()
export class WageringService {
  constructor(private readonly orm: MikroORM) {}

  async submit(req: WagerRequest) {
    const hash = payloadHash(req);
    try {
      return await this.orm.em.fork().transactional((em) => this.process(em, req, hash));
    } catch (e) {
      // Mesmo id externo enviado para wallets diferentes ao mesmo tempo (locks diferentes): o banco
      // barrou o segundo pela UNIQUE. Rodando de novo, ele encontra o primeiro e vira reenvio ou conflito.
      if (e instanceof UniqueConstraintViolationException) {
        return this.orm.em.fork().transactional((em) => this.process(em, req, hash));
      }
      throw e;
    }
  }

  /**
   * Trava a wallet, aplica as regras e grava transação + lançamento + saldo na mesma transação SQL.
   * SELECT ... FOR UPDATE: quem chega depois espera o COMMIT de quem chegou antes e já lê o saldo novo.
   * O lock é por linha (por wallet): wallets diferentes continuam em paralelo.
   */
  private async process(em: EntityManager, req: WagerRequest, hash: string) {
    const row = await em.findOne(Wallets, { id: req.walletId }, { lockMode: LockMode.PESSIMISTIC_WRITE });
    if (!row) throw notFound('WALLET', req.walletId);

    // Com o lock já na mão: um reenvio da mesma wallet que acabou de commitar aparece aqui.
    const existing = await em.findOne(Transactions, {
      $or: [{ idempotencyKey: req.idempotencyKey }, { providerId: req.providerId, externalTransactionId: req.externalTransactionId }],
    });
    if (existing) return this.replay(toTransaction(existing), req.idempotencyKey, hash);
    const wallet = toWallet(row);
    const now = new Date();

    const tx = WagerTransaction.create({ ...req, payloadHash: hash }, now);
    const entry = tx.applyTo(wallet, now, tx.isReversal() ? await this.findReference(em, tx) : undefined);

    em.create(Transactions, fromTransaction(tx));
    if (entry) {
      em.create(Ledger, fromLedgerEntry(entry));
      em.assign(row, fromWallet(wallet));
    }
    return transactionView(tx);
  }

  /** A transação revertida (mesmo provedor) e se ela já tem uma reversão processada. */
  private async findReference(em: EntityManager, tx: WagerTransaction): Promise<Reference> {
    const s = tx.state;
    const row = await em.findOne(Transactions, { providerId: s.providerId, externalTransactionId: s.referenceExternalTransactionId });
    if (!row) return { alreadyReversed: false };
    const reversals = await em.count(Transactions, {
      referenceTransactionId: row.id, kind: { $in: [Kind.Refund, Kind.Rollback] }, status: Status.Processed,
    });
    return { tx: toTransaction(row), alreadyReversed: reversals > 0 };
  }

  /** Mesma chave e mesmo payload = devolve o resultado original. Qualquer diferença = 409. */
  private replay(existing: WagerTransaction, idempotencyKey: string, hash: string) {
    const s = existing.state;
    if (s.idempotencyKey !== idempotencyKey || s.payloadHash !== hash) {
      throw conflict('IDEMPOTENCY_CONFLICT', 'Transaction already submitted with a different payload or Idempotency-Key');
    }
    return transactionView(existing, true);
  }

  async get(id: string) {
    return this.view(await this.orm.em.fork().findOne(Transactions, { id }), id);
  }

  async getByExternalId(providerId: string, externalTransactionId: string) {
    return this.view(await this.orm.em.fork().findOne(Transactions, { providerId, externalTransactionId }), externalTransactionId);
  }

  private view(row: TransactionRow | null, ref: string) {
    if (!row) throw notFound('TRANSACTION', ref);
    return transactionView(toTransaction(row));
  }
}
