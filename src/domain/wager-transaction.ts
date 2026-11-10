import type { Money } from './money';
import type { LedgerEntry, Wallet } from './wallet';

export enum Kind {
  Opening = 'OPENING',
  Bet = 'BET',
  Win = 'WIN',
  Loss = 'LOSS',
  Refund = 'REFUND',
  Rollback = 'ROLLBACK',
}

export enum Status {
  Pending = 'PENDING',
  /** Reversão que chegou antes da transação que ela reverte: aguardando (202). */
  PendingReference = 'PENDING_REFERENCE',
  Processed = 'PROCESSED',
  Rejected = 'REJECTED',
}

/** Motivo de rejeição, estável e legível por máquina. */
export enum FailureCode {
  InsufficientFunds = 'INSUFFICIENT_FUNDS',
  CurrencyMismatch = 'CURRENCY_MISMATCH',
  PlayerWalletMismatch = 'PLAYER_WALLET_MISMATCH',
  /** A referência não apareceu depois de todas as tentativas. */
  ReferenceNotFound = 'REFERENCE_NOT_FOUND',
  ReferenceNotProcessed = 'REFERENCE_NOT_PROCESSED',
  ReferenceMismatch = 'REFERENCE_MISMATCH',
  InvalidReferenceKind = 'INVALID_REFERENCE_KIND',
  AmountMismatch = 'AMOUNT_MISMATCH',
  AlreadyReversed = 'ALREADY_REVERSED',
}

/** Tentativas de achar a referência antes de desistir. Espera 2^n s entre elas: ~17 min no total. */
export const MAX_REFERENCE_ATTEMPTS = 10;

/** O que cada reversão pode desfazer. */
const REVERSIBLE: Partial<Record<Kind, Kind[]>> = {
  [Kind.Refund]: [Kind.Bet],
  [Kind.Rollback]: [Kind.Bet, Kind.Win],
};

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
  /** Id do provedor da transação revertida (REFUND/ROLLBACK). */
  referenceExternalTransactionId?: string;
  /** Id interno dela, preenchido quando a reversão é processada. */
  referenceTransactionId?: string;
  status: Status;
  failureCode?: FailureCode;
  /** Saldo da wallet logo depois desta transação (para responder e auditar). */
  resultingBalance?: Money;
  createdAt: Date;
  processedAt?: Date;
  /** Quantas vezes a referência já foi procurada sem sucesso, e quando tentar de novo. */
  attempts: number;
  nextAttemptAt?: Date;
}

type CreateProps = Omit<
  WagerTransactionState,
  | 'id' | 'status' | 'failureCode' | 'resultingBalance' | 'createdAt' | 'processedAt' | 'referenceTransactionId'
  | 'attempts' | 'nextAttemptAt'
>;

/** A transação referenciada, como o banco a encontrou. */
export interface Reference {
  tx?: WagerTransaction;
  alreadyReversed: boolean;
}

export class WagerTransaction {
  private constructor(private s: WagerTransactionState) {}

  static create(p: CreateProps, now: Date): WagerTransaction {
    return new WagerTransaction({ ...p, id: Bun.randomUUIDv7(), status: Status.Pending, createdAt: now, attempts: 0 });
  }

  /** Crédito interno do saldo inicial; já nasce PROCESSED. */
  static opening(wallet: Wallet): WagerTransaction {
    return new WagerTransaction({
      id: Bun.randomUUIDv7(), providerId: 'internal', externalTransactionId: `opening:${wallet.id}`,
      idempotencyKey: `opening:${wallet.id}`, payloadHash: '',
      walletId: wallet.id, playerId: wallet.playerId, roundId: 'opening', gameId: 'opening', kind: Kind.Opening,
      money: wallet.balance, status: Status.Processed, resultingBalance: wallet.balance,
      createdAt: wallet.createdAt, processedAt: wallet.createdAt, attempts: 0,
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

  isReversal(): boolean {
    return this.s.kind === Kind.Refund || this.s.kind === Kind.Rollback;
  }

  /**
   * Regras de negócio. Muda a wallet e devolve o lançamento, ou rejeita a transação.
   * Rejeição não é exceção: é um resultado gravado e respondido (422).
   */
  applyTo(wallet: Wallet, now: Date, reference?: Reference): LedgerEntry | undefined {
    if (this.s.playerId !== wallet.playerId) return this.reject(FailureCode.PlayerWalletMismatch, wallet, now);
    if (this.s.money.currency !== wallet.currency) return this.reject(FailureCode.CurrencyMismatch, wallet, now);

    let original: WagerTransaction | undefined;
    if (this.isReversal()) {
      // Referência ainda não chegou (ou ainda está esperando a dela): espera, não rejeita.
      const refStatus = reference?.tx?.status;
      if (refStatus === undefined || refStatus === Status.PendingReference) return this.waitForReference(wallet, now);
      const problem = this.referenceProblem(reference);
      if (problem) return this.reject(problem, wallet, now);
      original = reference!.tx!;
      this.s.referenceTransactionId = original.id;
    }

    // Débito: BET, ou ROLLBACK de um WIN (devolve o prêmio). Crédito: WIN, REFUND, ROLLBACK de BET.
    const isDebit = this.s.kind === Kind.Bet || original?.state.kind === Kind.Win;
    let entry: LedgerEntry | undefined;
    if (this.s.kind === Kind.Loss) {
      // LOSS só registra o resultado da rodada; o dinheiro já saiu no BET.
    } else if (isDebit) {
      if (wallet.balance.isLessThan(this.s.money)) return this.reject(FailureCode.InsufficientFunds, wallet, now);
      entry = wallet.debit(this.s.money, this.s.id, now);
    } else {
      entry = wallet.credit(this.s.money, this.s.id, now);
    }
    this.finish(Status.Processed, wallet, now);
    return entry;
  }

  /** Reversão só vale para uma transação processada, da mesma wallet, do tipo certo, mesmo valor, uma vez. */
  private referenceProblem(reference?: Reference): FailureCode | undefined {
    const ref = reference!.tx!.state;
    if (ref.status !== Status.Processed) return FailureCode.ReferenceNotProcessed;
    if (ref.walletId !== this.s.walletId || ref.playerId !== this.s.playerId) return FailureCode.ReferenceMismatch;
    if (!REVERSIBLE[this.s.kind]?.includes(ref.kind)) return FailureCode.InvalidReferenceKind;
    if (!ref.money.equals(this.s.money)) return FailureCode.AmountMismatch;
    if (reference!.alreadyReversed) return FailureCode.AlreadyReversed;
    return undefined;
  }

  /** Agenda nova tentativa com backoff exponencial; depois de MAX_REFERENCE_ATTEMPTS, desiste. */
  private waitForReference(wallet: Wallet, now: Date): undefined {
    if (this.s.attempts >= MAX_REFERENCE_ATTEMPTS) return this.reject(FailureCode.ReferenceNotFound, wallet, now);
    this.s.attempts += 1;
    this.s.status = Status.PendingReference;
    this.s.nextAttemptAt = new Date(now.getTime() + 2 ** this.s.attempts * 1000);
    return undefined;
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
    this.s.nextAttemptAt = undefined;
  }
}
