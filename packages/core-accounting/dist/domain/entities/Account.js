"use strict";
// src/domain/entities/Account.ts
Object.defineProperty(exports, "__esModule", { value: true });
exports.Account = void 0;
class Account {
    props;
    constructor(props) {
        this.props = props;
    }
    static reconstruct(props) {
        return new Account(props);
    }
    get id() { return this.props.id; }
    get code() { return this.props.code; }
    get nameArSimple() { return this.props.nameArSimple; }
    get accountType() { return this.props.accountType; }
    get normalBalance() { return this.props.normalBalance; }
    get tenantId() { return this.props.tenantId; }
    /** قاعدة عمل جوهرية: لا يصح الترحيل على حساب رأس (Header) أو غير نشط */
    assertIsPostable() {
        if (this.props.isHeader || !this.props.isPostable) {
            throw new Error(`الحساب "${this.props.nameArSimple}" (${this.props.code}) هو حساب تجميعي، لا يمكن الترحيل عليه مباشرة`);
        }
        if (!this.props.isActive) {
            throw new Error(`الحساب "${this.props.nameArSimple}" غير نشط حاليًا`);
        }
    }
    /** يحدد هل الحركة تزيد أم تنقص الرصيد الطبيعي للحساب - أساس renderSimpleSummary */
    resolveDirectionEffect(side) {
        return side === this.props.normalBalance ? "increase" : "decrease";
    }
}
exports.Account = Account;
//# sourceMappingURL=Account.js.map