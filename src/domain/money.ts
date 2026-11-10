import { DomainError, InvalidMoneyError } from './errors';

/** Formato do contrato: valor como string decimal, nunca number (float perde centavos). */
export interface MoneyProps {
  amount: string;
  currency: string;
}

/** Até 18 dígitos inteiros e 2 casas: cabe em numeric(20,2) no banco. */
const AMOUNT_PATTERN = /^\d{1,18}(\.\d{1,2})?$/;
const CURRENCY_PATTERN = /^[A-Z]{3}$/;

/**
 * Valor monetário imutável. Guarda centavos em bigint: soma e subtração exatas, sem float.
 */
export class Money {
  private constructor(
    readonly cents: bigint,
    readonly currency: string,
  ) {}

  /** Rejeita (não arredonda) negativos, notação científica e mais de 2 casas. */
  static from({ amount, currency }: MoneyProps): Money {
    if (typeof amount !== 'string' || !AMOUNT_PATTERN.test(amount)) {
      throw new InvalidMoneyError(`Invalid amount "${String(amount)}"`);
    }
    if (typeof currency !== 'string' || !CURRENCY_PATTERN.test(currency)) {
      throw new InvalidMoneyError(`Invalid currency "${String(currency)}"`);
    }
    const [units = '0', fraction = ''] = amount.split('.');
    return new Money(BigInt(units) * 100n + BigInt(fraction.padEnd(2, '0')), currency);
  }

  static zero(currency: string): Money {
    return new Money(0n, currency);
  }

  add(other: Money): Money {
    this.assertSameCurrency(other);
    return new Money(this.cents + other.cents, this.currency);
  }

  subtract(other: Money): Money {
    this.assertSameCurrency(other);
    return new Money(this.cents - other.cents, this.currency);
  }

  isPositive(): boolean {
    return this.cents > 0n;
  }

  isLessThan(other: Money): boolean {
    this.assertSameCurrency(other);
    return this.cents < other.cents;
  }

  equals(other: Money): boolean {
    return this.currency === other.currency && this.cents === other.cents;
  }

  /** Saída sempre com 2 casas: { amount: "25.00", currency: "BRL" }. */
  toJSON(): MoneyProps {
    const fraction = (this.cents % 100n).toString().padStart(2, '0');
    return { amount: `${this.cents / 100n}.${fraction}`, currency: this.currency };
  }

  private assertSameCurrency(other: Money): void {
    if (other.currency !== this.currency) {
      throw new DomainError('CURRENCY_MISMATCH', `Expected ${this.currency}, got ${other.currency}`);
    }
  }
}
