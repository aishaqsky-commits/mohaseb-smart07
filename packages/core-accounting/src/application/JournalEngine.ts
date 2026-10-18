// src/application/JournalEngine.ts

import { Account } from "../domain/entities/Account";
import { JournalEntry, JournalEntrySourceType } from "../domain/entities/JournalEntry";
import { JournalLine, EntrySide } from "../domain/entities/JournalLine";
import { Money } from "../domain/value-objects/Money";
import { AccountRepository } from "../domain/ports/AccountRepository";
import { JournalRepository } from "../domain/ports/JournalRepository";
import {
  AccountNotFoundError,
  FiscalPeriodClosedError,
  EntryAlreadyReversedError,
} from "../domain/errors/AccountingErrors";
import { ApplicationError } from "./errors/ApplicationErrors";

/** العملية لا تحمل معرف عملية مصدرية (قيد يدوي عام) — لا شيء لعكسه على مستوى العملية */
export class TransactionNotReversibleError extends ApplicationError {
  constructor(transactionId: string) {
    super(
      `لا توجد قيود مرتبطة بالعملية "${transactionId}" — لا يمكن عكسها`,
      422,
      "TRANSACTION_NOT_REVERSIBLE"
    );
  }
}

export interface PostLineRequest {
  accountCode: string;       // نستخدم الكود لا الـ ID (كما أوصينا في تصميم القوالب)
  side: EntrySide;
  amount: string;             // نص لتفادي أخطاء float من الطبقات الخارجية (API/UI)
  currencyCode: string;
  exchangeRateUsed: string;
  contactId?: string | undefined;
  memoAr?: string | undefined;
}

export interface PostJournalEntryRequest {
  tenantId: string;
  entryDate: Date;
  descriptionSimple: string;
  sourceType: JournalEntrySourceType;
  sourceTransactionId?: string | undefined;
  baseCurrencyCode: string;
  lines: PostLineRequest[];
}

/**
 * الواجهة الوحيدة المعتمدة لترحيل أي قيد في كامل النظام.
 * كل القوالب (بيع/شراء/تالف...) يجب أن تمر عبر هذه الدالة فقط، لا بناء JournalEntry يدويًا في مكان آخر.
 */
export class JournalEngine {
  constructor(
    private readonly accountRepo: AccountRepository,
    private readonly journalRepo: JournalRepository
  ) {}

  async postEntry(request: PostJournalEntryRequest): Promise<JournalEntry> {
    // 1) خط الدفاع الأول: الفترة المحاسبية مفتوحة؟
    const periodStatus = await this.journalRepo.getFiscalPeriodStatus(
      request.tenantId,
      request.entryDate
    );
    if (periodStatus.isClosed) {
      throw new FiscalPeriodClosedError(request.entryDate.toISOString());
    }

    // 2) جلب كل الحسابات المطلوبة دفعة واحدة (أداء - تفادي N+1 Query)
    const accountCodes = request.lines.map((l) => l.accountCode);
    const accountsMap = await this.accountRepo.findManyByCodes(
      request.tenantId,
      accountCodes
    );

    // 3) بناء كل سطر مع التحقق من صلاحية الحساب للترحيل
    const lines: JournalLine[] = request.lines.map((lineReq, index) => {
      const account = accountsMap.get(lineReq.accountCode);
      if (!account) {
        throw new AccountNotFoundError(lineReq.accountCode);
      }
      account.assertIsPostable();

      const money = Money.fromDecimalString(lineReq.amount, lineReq.currencyCode);

      return JournalLine.create({
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
    const entry = JournalEntry.create({
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

  async reverseEntry(
    tenantId: string,
    entryId: string,
    reason: string
  ): Promise<JournalEntry> {
    const original = await this.journalRepo.findById(tenantId, entryId);
    if (!original) {
      throw new AccountNotFoundError(entryId);
    }
    // قيد العكس نفسه ليس هدفًا للعكس المباشر — الهدف هو الأصل (منع التباس double-reversal)
    if (original.reversalOfEntryId !== null) {
      throw new EntryAlreadyReversedError(entryId);
    }
    if (original.isReversed) {
      throw new EntryAlreadyReversedError(entryId);
    }

    // حارس الفترة: تاريخ قيد العكس = تاريخ القيد الأصلي ⇒ الفترة الواجب فحصها هي
    // فترة التاريخ الأصلي (وليس تاريخ اليوم) — وإلا سُمح بتصحيح فترة مُقفَلة.
    const periodStatus = await this.journalRepo.getFiscalPeriodStatus(
      tenantId,
      original.entryDate
    );
    if (periodStatus.isClosed) {
      throw new FiscalPeriodClosedError(original.entryDate.toISOString());
    }

    // منع ازدواج العكس: إن وُجد قيد عكسي سابق يشير لهذا الأصل ⇒ مرفوض
    const existing = await this.journalRepo.findReversalOf(tenantId, entryId);
    if (existing) {
      throw new EntryAlreadyReversedError(entryId);
    }

    const reversalEntry = original.createReversal(reason);
    await this.journalRepo.save(reversalEntry);
    await this.journalRepo.save(original.markAsReversed());

    return reversalEntry;
  }

  /**
   * التراجع الكامل عن عملية مصدرية (Undo/التصحيح بدل الحذف — متطلب PRD §العمليات).
   * يعكس كل قيود العملية غير المعكوسة (primary + secondary إن وُجدت) بقيود عكسية
   * متوازنة بنفس تاريخ العملية الأصلية. الرفض عند: لا قيود، كلها معكوسة، أو الفترة مقفلة.
   * حارس الذمم (assertReversible على الفواتير ذات التخصيصات) يُستدعى من طبقة الخدمة
   * المستدعية (SubledgerService عبر RecordTransactionService/reverse use-case) —
   * المحرك لا يعرف الذمم، احترامًا لنقاء طبقة النطاق.
   */
  async reverseTransaction(
    tenantId: string,
    transactionId: string,
    reason: string
  ): Promise<JournalEntry[]> {
    const entries = await this.journalRepo.findBySourceTransaction(tenantId, transactionId);
    if (entries.length === 0) {
      throw new TransactionNotReversibleError(transactionId);
    }
    // قيد العكس نفسه يحمل نفس source_transaction_id (للربط_audit) ⇒ يُستثنى من المرشحين للعكس
    const reversible = entries.filter((e) => !e.isReversed && e.reversalOfEntryId === null);
    if (reversible.length === 0) {
      throw new EntryAlreadyReversedError(transactionId);
    }

    const reversals: JournalEntry[] = [];
    for (const entry of reversible) {
      reversals.push(await this.reverseEntry(tenantId, entry.id, reason));
    }
    return reversals;
  }

  /**
   * توليد الملخص المبسّط لغير المحاسب - يحقق فلسفة "لا مصطلحات محاسبية"
   * المصممة في وحدة القوالب سابقًا.
   */
  async renderSimpleSummary(
    entry: JournalEntry,
    tenantId: string
  ): Promise<string> {
    const sentences: string[] = [];

    for (const line of entry.lines) {
      const account = await this.accountRepo.findById(tenantId, line.accountId);
      if (!account) continue;

      const effect = account.resolveDirectionEffect(line.side);
      const verb = effect === "increase" ? "يزيد" : "ينقص";
      sentences.push(`${account.nameArSimple} ${verb} ${line.amount.toDisplayString()}`);
    }

    return sentences.join(" · ");
  }
}
