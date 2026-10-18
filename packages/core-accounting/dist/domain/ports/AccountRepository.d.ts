import { Account } from "../entities/Account";
export interface AccountRepository {
    findById(tenantId: string, accountId: string): Promise<Account | null>;
    findByCode(tenantId: string, code: string): Promise<Account | null>;
    findManyByCodes(tenantId: string, codes: string[]): Promise<Map<string, Account>>;
    /** قائمة كل حسابات المنشأة (مرتبّة بالكود) - لبناء الشجرة وقوائم الاختيار */
    listByTenant(tenantId: string): Promise<Account[]>;
}
