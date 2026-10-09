// src/domain/value-objects/Money.ts

import Decimal from "decimal.js";

// ضبط دقة الحساب الداخلي (أعلى من دقة العرض لتفادي تراكم أخطاء التقريب)
Decimal.set({ precision: 28, rounding: Decimal.ROUND_HALF_UP });

export class InvalidMoneyOperationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidMoneyOperationError";
  }
}

/**
 * كائن قيمة (Value Object) غير قابل للتغيير (Immutable) يمثل مبلغًا ماليًا مرتبطًا بعملته.
 * القاعدة الذهبية: لا تُجرَ عملية حسابية بين Money بعملتين مختلفتين مباشرة أبدًا.
 */
export class Money {
  private readonly amount: Decimal;
  public readonly currencyCode: string;

  // عدد الخانات العشرية المعتمد للعرض والتخزين النهائي (قابل للتهيئة لاحقًا حسب العملة)
  private static readonly DISPLAY_DECIMALS = 4;

  // عدد الخانات العشرية المعتمد للتخزين (يُستخدم من محرك القوالب لتقريب المبالغ)
  static readonly STORAGE_DECIMALS = 4;

  private constructor(amount: Decimal, currencyCode: string) {
    if (!currencyCode || currencyCode.length !== 3) {
      throw new InvalidMoneyOperationError(
        `رمز عملة غير صالح: "${currencyCode}"`
      );
    }
    this.amount = amount;
    this.currencyCode = currencyCode.toUpperCase();
  }

  static fromDecimalString(value: string, currencyCode: string): Money {
    const decimal = new Decimal(value);
    return new Money(decimal, currencyCode);
  }

  static fromNumber(value: number, currencyCode: string): Money {
    if (!Number.isFinite(value)) {
      throw new InvalidMoneyOperationError(`قيمة رقمية غير صالحة: ${value}`);
    }
    return new Money(new Decimal(value), currencyCode);
  }

  static zero(currencyCode: string): Money {
    return new Money(new Decimal(0), currencyCode);
  }

  private assertSameCurrency(other: Money, operation: string): void {
    if (this.currencyCode !== other.currencyCode) {
      throw new InvalidMoneyOperationError(
        `لا يمكن إجراء عملية "${operation}" بين عملتين مختلفتين: ${this.currencyCode} و ${other.currencyCode}. يجب التحويل أولًا عبر سعر الصرف.`
      );
    }
  }

  add(other: Money): Money {
    this.assertSameCurrency(other, "جمع");
    return new Money(this.amount.plus(other.amount), this.currencyCode);
  }

  subtract(other: Money): Money {
    this.assertSameCurrency(other, "طرح");
    return new Money(this.amount.minus(other.amount), this.currencyCode);
  }

  multiply(factor: number | string): Money {
    return new Money(this.amount.times(factor), this.currencyCode);
  }

  /** يُستخدم لتحويل العملة بسعر صرف معين، وينتج عملة جديدة صراحةً */
  convertTo(targetCurrencyCode: string, exchangeRate: string | number): Money {
    const rate = new Decimal(exchangeRate);
    if (rate.lessThanOrEqualTo(0)) {
      throw new InvalidMoneyOperationError("سعر الصرف يجب أن يكون أكبر من صفر");
    }
    return new Money(this.amount.times(rate), targetCurrencyCode);
  }

  isZero(): boolean {
    return this.amount.isZero();
  }

  isNegative(): boolean {
    return this.amount.isNegative();
  }

  isGreaterThan(other: Money): boolean {
    this.assertSameCurrency(other, "مقارنة");
    return this.amount.greaterThan(other.amount);
  }

  equals(other: Money): boolean {
    return (
      this.currencyCode === other.currencyCode &&
      this.amount.equals(other.amount)
    );
  }

  /** القيمة الرقمية الخام للتخزين في قاعدة البيانات (كنص لتفادي فقد الدقة) */
  toStorageString(): string {
    return this.amount.toFixed(Money.DISPLAY_DECIMALS);
  }

  toNumber(): number {
    return this.amount.toNumber();
  }

  /** تنسيق للعرض البشري مع فواصل الآلاف (يُستخدم في الواجهة) */
  toDisplayString(locale: string = "ar"): string {
    const formatted = this.amount.toFixed(2);
    const [intPart, decPart] = formatted.split(".");
    const withThousands = intPart!.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    return `${withThousands}.${decPart} ${this.currencyCode}`;
  }

  static sum(amounts: Money[], currencyCode: string): Money {
    return amounts.reduce(
      (acc, m) => acc.add(m),
      Money.zero(currencyCode)
    );
  }
}
