"use strict";
// src/domain/entities/JournalEntry.ts
Object.defineProperty(exports, "__esModule", { value: true });
exports.JournalEntry = void 0;
const uuid_1 = require("uuid");
const Money_1 = require("../value-objects/Money");
const JournalLine_1 = require("./JournalLine");
const AccountingErrors_1 = require("../errors/AccountingErrors");
/**
 * الكيان الجذري (Aggregate Root) لقيد اليومية.
 * القاعدة غير القابلة للتفاوض: لا يُسمح بإنشاء كائن JournalEntry غير متوازن في الذاكرة إطلاقًا.
 * التحقق يحدث في المُنشئ الثابت (Factory) قبل استدعاء أي منشئ خاص.
 */
class JournalEntry {
    id;
    tenantId;
    entryDate;
    descriptionSimple;
    sourceType;
    sourceTransactionId;
    baseCurrencyCode;
    lines;
    isReversed;
    reversalOfEntryId;
    createdAt;
    constructor(props) {
        // تعيين الخصائص عبر مفاتيح معروفة لضمان توافق strictPropertyInitialization
        for (const [k, v] of Object.entries(props)) {
            this[k] = v;
        }
    }
    /**
     * نقطة الدخول الوحيدة لإنشاء قيد جديد.
     * يفرض: وجود سطرين على الأقل، وتوازن تام بعملة الأساس.
     */
    static create(input) {
        if (input.lines.length < 2) {
            throw new Error("القيد المحاسبي يجب أن يحتوي على سطرين على الأقل");
        }
        JournalEntry.assertBalanced(input.lines, input.baseCurrencyCode);
        return new JournalEntry({
            id: (0, uuid_1.v4)(),
            tenantId: input.tenantId,
            entryDate: input.entryDate,
            descriptionSimple: input.descriptionSimple,
            sourceType: input.sourceType,
            sourceTransactionId: input.sourceTransactionId ?? null,
            baseCurrencyCode: input.baseCurrencyCode,
            lines: input.lines,
            isReversed: false,
            reversalOfEntryId: null,
            createdAt: new Date(),
        });
    }
    /**
     * القاعدة الأهم في كامل النظام المحاسبي.
     * تُحسب دائمًا بعملة الأساس (baseAmount) بغض النظر عن عملة كل سطر على حدة.
     */
    static assertBalanced(lines, baseCurrencyCode) {
        const debitLines = lines.filter((l) => l.side === "debit");
        const creditLines = lines.filter((l) => l.side === "credit");
        const totalDebit = Money_1.Money.sum(debitLines.map((l) => l.baseAmount), baseCurrencyCode);
        const totalCredit = Money_1.Money.sum(creditLines.map((l) => l.baseAmount), baseCurrencyCode);
        if (!totalDebit.equals(totalCredit)) {
            throw new AccountingErrors_1.UnbalancedJournalEntryError(totalDebit.toDisplayString(), totalCredit.toDisplayString());
        }
    }
    /**
     * إعادة بناء كيان من صف التخزين كما هو حرفيًا (نفس المعرفات والعلامات) —
     * لا يُعيد تنفيذ التحقق من التوازن لأن القيد قُبل متوازنًا عند إنشائه الأصلي،
     * ولا يولّد معرفات جديدة (عكس create). يُستخدم لمعاملات الإقفال/إعادة الفتح المتزامنة.
     */
    static reconstructFromPersistence(props) {
        return new JournalEntry(props);
    }
    /**
     * إنشاء قيد عكسي بتاريخ محدَّد (مسار التصحيح بعد الإقفال §4.2):
     * الأسطر مقلوبة حتميًا عن أصلٍ متوازن ⇒ القيد متوازن رياضيًا؛ يمر بتحقق المجال الكامل.
     */
    static createReversalAt(original, reason, entryDate) {
        const reversedLines = original.lines.map((line) => JournalLine_1.JournalLine.create({
            accountId: line.accountId,
            side: line.side === "debit" ? "credit" : "debit",
            amount: line.amount,
            exchangeRateUsed: line.exchangeRateUsed,
            baseCurrencyCode: original.baseCurrencyCode,
            contactId: line.contactId,
            memoAr: `عكس: ${reason}`,
            lineOrder: line.lineOrder,
        }));
        JournalEntry.assertBalanced(reversedLines, original.baseCurrencyCode);
        return new JournalEntry({
            id: (0, uuid_1.v4)(),
            tenantId: original.tenantId,
            entryDate,
            descriptionSimple: `تصحيح/عكس القيد: ${original.descriptionSimple}`,
            sourceType: "system_adjustment",
            sourceTransactionId: original.sourceTransactionId,
            baseCurrencyCode: original.baseCurrencyCode,
            lines: reversedLines,
            isReversed: false,
            reversalOfEntryId: original.id,
            createdAt: new Date(),
        });
    }
    /** ينتج قيدًا عكسيًا جديدًا (التصحيح الوحيد المسموح به، بدل التعديل أو الحذف) */
    createReversal(reason) {
        const reversedLines = this.lines.map((line) => JournalLine_1.JournalLine.create({
            accountId: line.accountId,
            side: line.side === "debit" ? "credit" : "debit",
            amount: line.amount,
            exchangeRateUsed: line.exchangeRateUsed,
            baseCurrencyCode: this.baseCurrencyCode,
            contactId: line.contactId,
            memoAr: `عكس: ${reason}`,
            lineOrder: line.lineOrder,
        }));
        // متزامن بحت (لا I/O داخل المعاملة) — التوازن مضمون رياضيًا بقلب أسطر قيد متوازن،
        // والتاريخ = نفس تاريخ القيد الأصلي (قيد العكس يصحّح الفترة نفسها ولا يُرحَّل للمستقبل).
        return new JournalEntry({
            id: (0, uuid_1.v4)(),
            tenantId: this.tenantId,
            entryDate: this.entryDate,
            descriptionSimple: `تصحيح/عكس القيد: ${this.descriptionSimple}`,
            sourceType: "system_adjustment",
            sourceTransactionId: this.sourceTransactionId,
            baseCurrencyCode: this.baseCurrencyCode,
            lines: reversedLines,
            isReversed: false,
            reversalOfEntryId: this.id,
            createdAt: new Date(),
        });
    }
    markAsReversed() {
        return new JournalEntry({
            id: this.id,
            tenantId: this.tenantId,
            entryDate: this.entryDate,
            descriptionSimple: this.descriptionSimple,
            sourceType: this.sourceType,
            sourceTransactionId: this.sourceTransactionId,
            baseCurrencyCode: this.baseCurrencyCode,
            lines: this.lines,
            isReversed: true,
            reversalOfEntryId: this.reversalOfEntryId,
            createdAt: this.createdAt,
        });
    }
    totalDebitBase() {
        return Money_1.Money.sum(this.lines.filter((l) => l.side === "debit").map((l) => l.baseAmount), this.baseCurrencyCode);
    }
}
exports.JournalEntry = JournalEntry;
//# sourceMappingURL=JournalEntry.js.map