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
export declare class Account {
    private readonly props;
    private constructor();
    static reconstruct(props: AccountProps): Account;
    get id(): string;
    get code(): string;
    get nameArSimple(): string;
    get accountType(): AccountType;
    get normalBalance(): NormalBalance;
    get tenantId(): string;
    /** قاعدة عمل جوهرية: لا يصح الترحيل على حساب رأس (Header) أو غير نشط */
    assertIsPostable(): void;
    /** يحدد هل الحركة تزيد أم تنقص الرصيد الطبيعي للحساب - أساس renderSimpleSummary */
    resolveDirectionEffect(side: "debit" | "credit"): "increase" | "decrease";
}
