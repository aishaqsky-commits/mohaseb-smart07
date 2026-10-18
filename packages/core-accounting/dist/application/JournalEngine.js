"use strict";
// src/application/JournalEngine.ts
Object.defineProperty(exports, "__esModule", { value: true });
exports.JournalEngine = void 0;
const JournalEntry_1 = require("../domain/entities/JournalEntry");
const JournalLine_1 = require("../domain/entities/JournalLine");
const Money_1 = require("../domain/value-objects/Money");
const AccountingErrors_1 = require("../domain/errors/AccountingErrors");
/**
 * الواجهة الوحيدة المعتمدة لترحيل أي قيد في كامل النظام.
 * كل القوالب (بيع/شراء/تالف...) يجب أن تمر عبر هذه الدالة فقط، لا بناء JournalEntry يدويًا في مكان آخر.
 */
class JournalEngine {
    accountRepo;
    journalRepo;
    constructor(accountRepo, journalRepo) {
        this.accountRepo = accountRepo;
        this.journalRepo = journalRepo;
    }
    async postEntry(request) {
        // 1) خط الدفاع الأول: الفترة المحاسبية مفتوحة؟
        const periodStatus = await this.journalRepo.getFiscalPeriodStatus(request.tenantId, request.entryDate);
        if (periodStatus.isClosed) {
            throw new AccountingErrors_1.FiscalPeriodClosedError(request.entryDate.toISOString());
        }
        // 2) جلب كل الحسابات المطلوبة دفعة واحدة (أداء - تفادي N+1 Query)
        const accountCodes = request.lines.map((l) => l.accountCode);
        const accountsMap = await this.accountRepo.findManyByCodes(request.tenantId, accountCodes);
        // 3) بناء كل سطر مع التحقق من صلاحية الحساب للترحيل
        const lines = request.lines.map((lineReq, index) => {
            const account = accountsMap.get(lineReq.accountCode);
            if (!account) {
                throw new AccountingErrors_1.AccountNotFoundError(lineReq.accountCode);
            }
            account.assertIsPostable();
            const money = Money_1.Money.fromDecimalString(lineReq.amount, lineReq.currencyCode);
            return JournalLine_1.JournalLine.create({
                accountId: account.id,
                side: lineReq.side,
                amount: money,
                exchangeRateUsed: lineReq.exchangeRateUsed,
                baseCurrencyCode: request.baseCurrencyCode,
                contactId: lineReq.contactId ?? null,
                memoAr: lineReq.memoAr ?? null,
                lineOrder: index,
            });
        });
        // 4) إنشاء القيد (يفرض التوازن تلقائيًا داخل JournalEntry.create - خط الدفاع الثاني)
        const entry = JournalEntry_1.JournalEntry.create({
            tenantId: request.tenantId,
            entryDate: request.entryDate,
            descriptionSimple: request.descriptionSimple,
            sourceType: request.sourceType,
            sourceTransactionId: request.sourceTransactionId,
            baseCurrencyCode: request.baseCurrencyCode,
            lines,
        });
        // 5) الحفظ الذري (رأس + أسطر في معاملة واحدة، يُنفَّذ داخل Infrastructure)
        await this.journalRepo.save(entry);
        return entry;
    }
    async reverseEntry(tenantId, entryId, reason) {
        const original = await this.journalRepo.findById(tenantId, entryId);
        if (!original) {
            throw new AccountingErrors_1.AccountNotFoundError(entryId);
        }
        if (original.isReversed) {
            throw new AccountingErrors_1.EntryAlreadyReversedError(entryId);
        }
        const periodStatus = await this.journalRepo.getFiscalPeriodStatus(tenantId, new Date());
        if (periodStatus.isClosed) {
            throw new AccountingErrors_1.FiscalPeriodClosedError(new Date().toISOString());
        }
        const reversalEntry = original.createReversal(reason);
        await this.journalRepo.save(reversalEntry);
        await this.journalRepo.save(original.markAsReversed());
        return reversalEntry;
    }
    /**
     * توليد الملخص المبسّط لغير المحاسب - يحقق فلسفة "لا مصطلحات محاسبية"
     * المصممة في وحدة القوالب سابقًا.
     */
    async renderSimpleSummary(entry, tenantId) {
        const sentences = [];
        for (const line of entry.lines) {
            const account = await this.accountRepo.findById(tenantId, line.accountId);
            if (!account)
                continue;
            const effect = account.resolveDirectionEffect(line.side);
            const verb = effect === "increase" ? "يزيد" : "ينقص";
            sentences.push(`${account.nameArSimple} ${verb} ${line.amount.toDisplayString()}`);
        }
        return sentences.join(" · ");
    }
}
exports.JournalEngine = JournalEngine;
//# sourceMappingURL=JournalEngine.js.map