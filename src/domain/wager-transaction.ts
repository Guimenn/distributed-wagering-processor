import type { Money } from './money';
import type { LedgerEntry, Wallet } from './wallet';

export enum Kind {
  Opening = 'OPENING',
  Bet = 'BET',
  Win = 'WIN',
  Loss = 'LOSS',
}

export enum Status {
  Pending = 'PENDING',
  Processed = 'PROCESSED',
  Rejected = 'REJECTED',
}

/** Motivo de rejeição, estável e legível por máquina. */
export enum FailureCode {
  InsufficientFunds = 'INSUFFICIENT_FUNDS',
  CurrencyMismatch = 'CURRENCY_MISMATCH',
  PlayerWalletMismatch = 'PLAYER_WALLET_MISMATCH',
}

export interface WagerTransactionState {
  id: string;
  providerId: string;
  externalTransactionId: string;
  /** Chave de idempotência enviada pelo provedor + hash do payload que veio com ela. */
  idempotencyKey: string;
  payloadHash: string;
  walletId: string;
  playerId: string;
  roundId: string;
  gameId: string;
  kind: Kind;
  money: Money;
  status: Status;
  failureCode?: FailureCode;
  /** Saldo da wallet logo depois desta transação (para responder e auditar). */
  resultingBalance?: Money;
  createdAt: Date;
  processedAt?: Date;
}

type CreateProps = Omit<WagerTransactionState, 'id' | 'status' | 'failureCode' | 'resultingBalance' | 'createdAt' | 'processedAt'>;

export class WagerTransaction {
  private constructor(private s: WagerTransactionState) {}

  static create(p: CreateProps, now: Date): WagerTransaction {
    return new WagerTransaction({ ...p, id: Bun.randomUUIDv7(), status: Status.Pending, createdAt: now });
  }

  /** Crédito interno do saldo inicial; já nasce PROCESSED. */
  static opening(wallet: Wallet): WagerTransaction {
    return new WagerTransaction({
      id: Bun.randomUUIDv7(), providerId: 'internal', externalTransactionId: `opening:${wallet.id}`,
      idempotencyKey: `opening:${wallet.id}`, payloadHash: '',
      walletId: wallet.id, playerId: wallet.playerId, roundId: 'opening', gameId: 'opening', kind: Kind.Opening,
      money: wallet.balance, status: Status.Processed, resultingBalance: wallet.balance,
      createdAt: wallet.createdAt, processedAt: wallet.createdAt,
    });
  }

  static rehydrate(s: WagerTransactionState): WagerTransaction {
    return new WagerTransaction({ ...s });
  }

  /** Leitura dos campos (Readonly): só os métodos desta classe mudam o estado. */
  get state(): Readonly<WagerTransactionState> {
    return this.s;
  }

  get id() { return this.s.id; }
  get status() { return this.s.status; }

  /**
   * Regras de negócio. Muda a wallet e devolve o lançamento, ou rejeita a transação.
   * Rejeição não é exceção: é um resultado gravado e respondido (422).
   */
  applyTo(wallet: Wallet, now: Date): LedgerEntry | undefined {
    if (this.s.playerId !== wallet.playerId) return this.reject(FailureCode.PlayerWalletMismatch, wallet, now);
    if (this.s.money.currency !== wallet.currency) return this.reject(FailureCode.CurrencyMismatch, wallet, now);

    let entry: LedgerEntry | undefined;
    switch (this.s.kind) {
      case Kind.Bet:
        if (wallet.balance.isLessThan(this.s.money)) return this.reject(FailureCode.InsufficientFunds, wallet, now);
        entry = wallet.debit(this.s.money, this.s.id, now);
        break;
      case Kind.Win:
        entry = wallet.credit(this.s.money, this.s.id, now);
        break;
      case Kind.Loss:
        break; // LOSS só registra o resultado da rodada; o dinheiro já saiu no BET.
      case Kind.Opening:
        throw new Error('OPENING is internal');
    }
    this.finish(Status.Processed, wallet, now);
    return entry;
  }

  private reject(code: FailureCode, wallet: Wallet, now: Date): undefined {
    this.s.failureCode = code;
    this.finish(Status.Rejected, wallet, now);
    return undefined;
  }

  private finish(status: Status, wallet: Wallet, now: Date) {
    this.s.status = status;
    this.s.resultingBalance = wallet.balance;
    this.s.processedAt = now;
  }
}
