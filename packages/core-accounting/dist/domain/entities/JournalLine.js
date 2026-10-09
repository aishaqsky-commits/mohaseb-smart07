"use strict";
// src/domain/entities/JournalLine.ts
Object.defineProperty(exports, "__esModule", { value: true });
exports.JournalLine = void 0;
const uuid_1 = require("uuid");
class JournalLine {
    id;
    accountId;
    side;
    amount; // بعملة السطر
    baseAmount; // محسوبة بعملة الأساس (مثبّتة وقت الإنشاء)
    exchangeRateUsed;
    contactId;
    memoAr;
    lineOrder;
    constructor(props) {
        if (props.amount.isZero() || props.amount.isNegative()) {
            throw new Error("مبلغ سطر القيد يجب أن يكون أكبر من صفر");
        }
        // تعيين الخصائص عبر مفاتيح معروفة لضمان توافق strictPropertyInitialization
        for (const [k, v] of Object.entries(props)) {
            this[k] = v;
        }
    }
    static create(input) {
        const baseAmount = input.amount.convertTo(input.baseCurrencyCode, input.exchangeRateUsed);
        return new JournalLine({
            id: (0, uuid_1.v4)(),
            accountId: input.accountId,
            side: input.side,
            amount: input.amount,
            baseAmount,
            exchangeRateUsed: input.exchangeRateUsed,
            contactId: input.contactId ?? null,
            memoAr: input.memoAr ?? null,
            lineOrder: input.lineOrder,
        });
    }
    /** إعادة بناء من صف قاعدة بيانات (لا يُعيد حساب baseAmount، يثق بالمخزَّن) */
    static reconstruct(props) {
        return new JournalLine(props);
    }
}
exports.JournalLine = JournalLine;
//# sourceMappingURL=JournalLine.js.map