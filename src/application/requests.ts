import { InvalidMoneyError } from '../domain/errors';
import { Money } from '../domain/money';
import { Kind } from '../domain/wager-transaction';
import { validationError } from './errors';

/** Validação na fronteira: tudo que chega de fora é `unknown` até provar o contrário. */
type Obj = Record<string, unknown>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function object(v: unknown, field: string): Obj {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) throw validationError(`${field} must be an object`);
  return v as Obj;
}

function text(o: Obj, field: string): string {
  const v = o[field];
  if (typeof v !== 'string' || v.trim() === '' || v.length > 200) {
    throw validationError(`${field} must be a non-empty string up to 200 chars`);
  }
  return v;
}

export function uuid(v: unknown, field: string): string {
  if (typeof v !== 'string' || !UUID.test(v)) throw validationError(`${field} must be a UUID`);
  return v.toLowerCase();
}

function money(v: unknown, field: string): Money {
  const o = object(v, field);
  try {
    return Money.from({ amount: o.amount as string, currency: o.currency as string });
  } catch (e) {
    if (e instanceof InvalidMoneyError) throw validationError(`${field}: ${e.message}`);
    throw e;
  }
}

export function parseCreateWallet(body: unknown) {
  const b = object(body, 'body');
  return { playerId: text(b, 'playerId'), initialBalance: money(b.initialBalance, 'initialBalance') };
}

const SUBMITTABLE: string[] = [Kind.Bet, Kind.Win, Kind.Loss];

/** Mesmo formato para HTTP e (mais tarde) SQS. */
export function parseWagerRequest(body: unknown) {
  const b = object(body, 'body');
  const kind = text(b, 'kind');
  if (!SUBMITTABLE.includes(kind)) throw validationError(`kind must be one of ${SUBMITTABLE.join(', ')}`);
  const m = money(b.money, 'money');
  if (!m.isPositive()) throw validationError('money must be greater than zero');
  return {
    providerId: text(b, 'providerId'),
    externalTransactionId: text(b, 'externalTransactionId'),
    playerId: text(b, 'playerId'),
    walletId: uuid(b.walletId, 'walletId'),
    roundId: text(b, 'roundId'),
    gameId: text(b, 'gameId'),
    kind: kind as Kind,
    money: m,
  };
}

export type WagerRequest = ReturnType<typeof parseWagerRequest>;
