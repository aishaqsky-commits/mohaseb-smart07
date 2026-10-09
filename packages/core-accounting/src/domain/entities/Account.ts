// src/domain/entities/Account.ts

export type AccountType = "asset" | "liability" | "equity" | "revenue" | "expense";
export type NormalBalance = "debit" | "credit";

export interface AccountProps {
  id: string;
  tenantId: string;
  code: string;
  nameArSimple: string;
  accountType: AccountType;
  normalBalance: NormalBalance;
  isHeader: boolean;
  isPostable: boolean;
  isActive: boolean;
}

export class Account {
  private constructor(private readonly props: AccountProps) {}

  static reconstruct(props: AccountProps): Account {
    return new Account(props);
  }

  get id(): string { return this.props.id; }
  get code(): string { return this.props.code; }
  get nameArSimple(): string { return this.props.nameArSimple; }
  get accountType(): AccountType { return this.props.accountType; }
  get normalBalance(): NormalBalance { return this.props.normalBalance; }
  get tenantId(): string { return this.props.tenantId; }

  /** قاعدة عمل جوهرية: لا يصح الترحيل على حساب رأس (Header) أو غير نشط */
  assertIsPostable(): void {
    if (this.props.isHeader || !this.props.isPostable) {
      throw new Error(
        `الحساب "${this.props.nameArSimple}" (${this.props.code}) هو حساب تجميعي، لا يمكن الترحيل عليه مباشرة`
      );
    }
    if (!this.props.isActive) {
      throw new Error(`الحساب "${this.props.nameArSimple}" غير نشط حاليًا`);
    }
  }

  /** يحدد هل الحركة تزيد أم تنقص الرصيد الطبيعي للحساب - أساس renderSimpleSummary */
  resolveDirectionEffect(side: "debit" | "credit"): "increase" | "decrease" {
    return side === this.props.normalBalance ? "increase" : "decrease";
  }

  /** نسخة آمنة لا ترمي استثناءات — لتصفية قوائم الواجهة (بدل assertIsPostable) */
  isPostableSafe(): boolean {
    return !this.props.isHeader && this.props.isPostable && this.props.isActive;
  }
}
