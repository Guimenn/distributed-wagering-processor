import { DomainError } from './errors';
import { Money } from './money';

export enum LedgerDirection {
  Debit = 'DEBIT',
  Credit = 'CREDIT',
}

/** Lançamento do ledger. Imutável: só é criado, nunca alterado. */
export class LedgerEntry {
  private constructor(
    readonly id: string,
    readonly walletId: string,
    readonly transactionId: string,
    readonly direction: LedgerDirection,
    readonly money: Money,
    readonly balanceBefore: Money,
    readonly balanceAfter: Money,
    /** Versão da wallet gerada por este lançamento: o ledger vira uma sequência 1, 2, 3... */
    readonly walletVersion: number,
    readonly createdAt: Date,
  ) {}

  /** Recebe os campos (o tipo estrutural de LedgerEntry) e monta a instância. */
  static rehydrate(e: LedgerEntry): LedgerEntry {
    return new LedgerEntry(
      e.id, e.walletId, e.transactionId, e.direction, e.money, e.balanceBefore, e.balanceAfter, e.walletVersion, e.createdAt,
    );
  }
}

export interface WalletState {
  id: string;
  playerId: string;
  currency: string;
  balance: Money;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Toda mudança de saldo passa por credit/debit, que devolvem o lançamento.
 * Assim saldo e ledger nunca andam separados.
 */
export class Wallet {
  private constructor(
    readonly id: string,
    readonly playerId: string,
    readonly currency: string,
    private _balance: Money,
    private _version: number,
    readonly createdAt: Date,
    private _updatedAt: Date,
  ) {}

  /** Version 1 = estado de abertura. */
  static open(p: { playerId: string; initialBalance: Money; now: Date }): Wallet {
    return new Wallet(Bun.randomUUIDv7(), p.playerId, p.initialBalance.currency, p.initialBalance, 1, p.now, p.now);
  }

  static rehydrate(s: WalletState): Wallet {
    return new Wallet(s.id, s.playerId, s.currency, s.balance, s.version, s.createdAt, s.updatedAt);
  }

  get balance() { return this._balance; }
  get version() { return this._version; }
  get updatedAt() { return this._updatedAt; }

  /** Crédito do saldo inicial: é o lançamento da version 1. */
  openingEntry(transactionId: string): LedgerEntry {
    return this.entry(LedgerDirection.Credit, this._balance, Money.zero(this.currency), transactionId, 1, this.createdAt);
  }

  credit(money: Money, transactionId: string, now: Date): LedgerEntry {
    return this.move(LedgerDirection.Credit, money, transactionId, now);
  }

  debit(money: Money, transactionId: string, now: Date): LedgerEntry {
    if (this._balance.isLessThan(money)) throw new DomainError('INSUFFICIENT_FUNDS', 'Insufficient funds');
    return this.move(LedgerDirection.Debit, money, transactionId, now);
  }

  private move(direction: LedgerDirection, money: Money, transactionId: string, now: Date): LedgerEntry {
    const before = this._balance;
    this._balance = direction === LedgerDirection.Credit ? before.add(money) : before.subtract(money);
    this._version += 1;
    this._updatedAt = now;
    return this.entry(direction, money, before, transactionId, this._version, now);
  }

  private entry(direction: LedgerDirection, money: Money, before: Money, transactionId: string, version: number, now: Date) {
    return LedgerEntry.rehydrate({
      id: Bun.randomUUIDv7(), walletId: this.id, transactionId, direction, money, balanceBefore: before,
      balanceAfter: this._balance, walletVersion: version, createdAt: now,
    });
  }
}
