// tests/reporting-and-closing.test.ts
// ===== اختبارات وحدة التقارير المالية وإقفال الفترات — docs/04-modules/financial-reporting.md =====
// TDD صارم: كل اختبار يعادل بندًا موصوفًا (§4 خوارزميات، §6 منطق تقارير، §9 حوكمة).
// أهم اختبار في الملف كله = Golden Test "الفترتين المختلطتين" (§9 السطر الأخير + §10 التوصية الأولى).

import Database from "better-sqlite3";
import fs from "fs";
import path from "path";
import Decimal from "decimal.js";

import { SqliteJournalRepository } from "../src/infrastructure/sqlite/SqliteJournalRepository";
import { BalanceMaintenanceStore } from "../src/infrastructure/sqlite/BalanceMaintenanceStore";
import { PeriodClosingService, parsePeriodKey, computeNextPeriodKey, PeriodStateError, PermissionDeniedError } from "../src/application/services/PeriodClosingService";
import { FinancialReportingService, ReportContext } from "../src/application/services/FinancialReportingService";
import { JournalEntry } from "../src/domain/entities/JournalEntry";
import { JournalLine } from "../src/domain/entities/JournalLine";
import { Money } from "../src/domain/value-objects/Money";

const TENANT = "tenant-rep-001";
const BASE = "YER";
const OWNER = { userId: "user-owner", permissions: ["periods.close", "periods.reopen", "reports.view"], baseCurrencyCode: BASE };
const VIEWER = { tenantId: TENANT, userId: "user-viewer", baseCurrencyCode: BASE, permissions: ["reports.view"] } satisfies ReportContext;

function freshDb(): Database.Database {
  const schemaPath = path.resolve(__dirname, "../src/infrastructure/sqlite/schema.sql");
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec(fs.readFileSync(schemaPath, "utf-8"));
  return db;
}

/** بذرة شجرة حسابات مبسطة تغطي كل الأنواع اللازمة (§5/§6) */
function seedChart(db: Database.Database): Record<string, string> {
  const codes: Array<[string, string, string, string]> = [
    // code, name, type, normal
    ["1101", "الصندوق الرئيسي", "asset", "debit"],
    ["1210", "العملاء", "asset", "debit"],
    ["2101", "موردون", "liability", "credit"],
    ["3101", "رأس المال", "equity", "credit"],
    ["3300", "الأرباح المرحّلة", "equity", "credit"],
    ["4150", "إيرادات المبيعات", "revenue", "credit"],
    ["4900", "خسائر فروق عملة", "expense", "debit"],
    ["5110", "تكلفة البضاعة المباعة", "expense", "debit"],
    ["5210", "مصروف إيجار", "expense", "debit"],
    ["5900", "أرباح فروق عملة", "revenue", "credit"],
  ];
  const ids: Record<string, string> = {};
  const ins = db.prepare(
    `INSERT INTO accounts (id, tenant_id, code, name_ar_simple, account_type, normal_balance, is_header, is_postable)
     VALUES (?, ?, ?, ?, ?, ?, 0, 1)`
  );
  codes.forEach(([code, name, type, normal], i) => {
    const id = `acct-${i}`;
    ids[code] = id;
    ins.run(id, TENANT, code, name, type, normal);
  });
  return ids;
}

function postEntry(
  journalRepo: SqliteJournalRepository,
  date: string,
  description: string,
  lines: Array<{ accountId: string; side: "debit" | "credit"; amount: string }>
): JournalEntry {
  const entry = JournalEntry.create({
    tenantId: TENANT,
    entryDate: new Date(`${date}T12:00:00.000Z`),
    descriptionSimple: description,
    sourceType: "manual",
    baseCurrencyCode: BASE,
    lines: lines.map((l, idx) =>
      JournalLine.create({
        accountId: l.accountId,
        side: l.side,
        amount: Money.fromDecimalString(l.amount, BASE),
        exchangeRateUsed: "1",
        baseCurrencyCode: BASE,
        lineOrder: idx + 1,
      })
    ),
  });
  return entry;
}

describe("صيانة الأرصدة التجميعية (Hot Aggregates) — §2.3/§2.5", () => {
  let db: Database.Database;
  let journalRepo: SqliteJournalRepository;
  let balanceStore: BalanceMaintenanceStore;
  let ids: Record<string, string>;

  beforeEach(() => {
    db = freshDb();
    ids = seedChart(db);
    journalRepo = new SqliteJournalRepository(db);
    balanceStore = new BalanceMaintenanceStore(db);
  });
  afterEach(() => db.close());

  it("كل قيد يحدّث الرصيد الحي والنتيجة اليومية ذريًا في نفس المعاملة", async () => {
    // بيع نقدي 100,000: مدين الصندوق، دائن الإيراد
    await journalRepo.save(
      postEntry(journalRepo, "2026-10-01", "بيع نقدي", [
        { accountId: ids["1101"], side: "debit", amount: "100000" },
        { accountId: ids["4150"], side: "credit", amount: "100000" },
      ])
    );

    const cash = balanceStore.getRunningBalance(TENANT, "1101")!;
    expect(cash.current_balance_base).toBe("100000.0000");

    const daily = balanceStore.getDailyResult(TENANT, "2026-10-01")!;
    expect(daily.revenueTotalBase).toBe("100000.0000");
    expect(daily.cashInBase).toBe("100000.0000");
    expect(daily.netProfitBase).toBe("100000.0000");
    expect(daily.transactionsCount).toBe(1);
  });

  it("قيدان في نفس اليوم يتراكم عليهما دون مسح كامل (§2.5 Incremental)", async () => {
    await journalRepo.save(
      postEntry(journalRepo, "2026-10-01", "بيع", [
        { accountId: ids["1101"], side: "debit", amount: "100000" },
        { accountId: ids["4150"], side: "credit", amount: "100000" },
      ])
    );
    await journalRepo.save(
      postEntry(journalRepo, "2026-10-01", "دفع إيجار", [
        { accountId: ids["5210"], side: "debit", amount: "20000" },
        { accountId: ids["1101"], side: "credit", amount: "20000" },
      ])
    );

    const daily = balanceStore.getDailyResult(TENANT, "2026-10-01")!;
    expect(daily.revenueTotalBase).toBe("100000.0000");
    expect(daily.expensesTotalBase).toBe("20000.0000");
    expect(daily.netProfitBase).toBe("80000.0000");
    expect(daily.cashInBase).toBe("100000.0000");
    expect(daily.cashOutBase).toBe("20000.0000");
    expect(daily.transactionsCount).toBe(2);

    // invariant §9: current_balance = opening + debit - credit دائمًا
    const cash = balanceStore.getRunningBalance(TENANT, "1101")!;
    const computed = new Decimal(cash.opening_balance_base)
      .plus(cash.period_debit_total_base)
      .minus(cash.period_credit_total_base);
    expect(computed.toFixed(4)).toBe(cash.current_balance_base);
  });

  it("فروقات العملة (4900/5900) معزولة عن النتيجة التشغيلية (§5.3 PRD)", async () => {
    await journalRepo.save(
      postEntry(journalRepo, "2026-10-01", "ربح صرف", [
        { accountId: ids["1210"], side: "debit", amount: "5000" },
        { accountId: ids["5900"], side: "credit", amount: "5000" },
      ])
    );
    const daily = balanceStore.getDailyResult(TENANT, "2026-10-01")!;
    // 5900 لا يدخل revenue اليومي ولا expenses — النتيجة صفر تشغيلي
    expect(daily.revenueTotalBase).toBe("0.0000");
    expect(daily.netProfitBase).toBe("0.0000");
  });
});

describe("محرك إقفال الفترات — §4", () => {
  let db: Database.Database;
  let journalRepo: SqliteJournalRepository;
  let closing: PeriodClosingService;
  let ids: Record<string, string>;

  beforeEach(() => {
    db = freshDb();
    ids = seedChart(db);
    journalRepo = new SqliteJournalRepository(db);
    closing = new PeriodClosingService(db);
  });
  afterEach(() => db.close());

  it("parsePeriodKey/computeNextPeriodKey — أدوات نقية (§4.1 createNextPeriod)", () => {
    expect(parsePeriodKey("2026-02")).toEqual({ start: "2026-02-01", end: "2026-02-28" });
    expect(parsePeriodKey("2024-02")).toEqual({ start: "2024-02-01", end: "2024-02-29" }); // كبيسة
    expect(parsePeriodKey("2026-09")).toEqual({ start: "2026-09-01", end: "2026-09-30" });
    expect(parsePeriodKey("2026")).toEqual({ start: "2026-01-01", end: "2026-12-31" });
    expect(computeNextPeriodKey("2026-09")).toBe("2026-10");
    expect(computeNextPeriodKey("2026-12")).toBe("2027-01");
    expect(computeNextPeriodKey("2026")).toBe("2027");
  });

  it("إقفال شهري: لقطة مجمّدة + رفض قيود بأثر رجعي + الفترة التالية تُنشأ تلقائيًا", async () => {
    const period = closing.createPeriod(TENANT, "2026-09");

    await journalRepo.save(
      postEntry(journalRepo, "2026-09-15", "بيع آجل", [
        { accountId: ids["1210"], side: "debit", amount: "300000" },
        { accountId: ids["4150"], side: "credit", amount: "300000" },
      ])
    );

    const result = await closing.closeFiscalPeriod(TENANT, period.id, OWNER);
    expect(result.snapshotAccounts).toBeGreaterThan(0);
    expect(result.nextPeriodKey).toBe("2026-10");

    // اللقطة المجمّدة تحتوي إغلاق سبتمبر للعملاء
    const snap = db
      .prepare(
        `SELECT * FROM account_period_balances WHERE fiscal_period_id = ? AND account_code = '1210'`
      )
      .get(period.id) as { closing_balance_base: string };
    expect(snap.closing_balance_base).toBe("300000.0000");

    // §9: لا قيد بتاريخ ضمن فترة closed — المحرك يرفض (تكامل JournalEngine)
    const engine = new (require("../src/application/JournalEngine").JournalEngine)(
      new (require("../src/infrastructure/sqlite/SqliteAccountRepository").SqliteAccountRepository)(db),
      journalRepo
    );
    await expect(
      engine.postEntry({
        entryDate: new Date("2026-09-20T12:00:00.000Z"),
        descriptionSimple: "قيد متأخر",
        sourceType: "manual",
        lines: [
          { accountId: ids["1101"], side: "debit", amount: Money.fromDecimalString("1", BASE), currencyCode: BASE },
          { accountId: ids["4150"], side: "credit", amount: Money.fromDecimalString("1", BASE), currencyCode: BASE },
        ],
      } as never)
    ).rejects.toThrow();

    // الفترة التالية أُنشئت مفتوحة
    const periods = closing.listPeriods(TENANT);
    expect(periods.find((p) => p.periodKey === "2026-10")?.status).toBe("open");

    // الرصيد الحي انتقل: افتتاحي أكتوبر = إغلاق سبتمبر، والدورات صفرت
    const rb = db
      .prepare(`SELECT * FROM account_running_balances WHERE tenant_id = ? AND account_code = '1210'`)
      .get(TENANT) as { opening_balance_base: string; period_debit_total_base: string };
    expect(rb.opening_balance_base).toBe("300000.0000");
    expect(rb.period_debit_total_base).toBe("0.0000");
  });

  it("الإقفال السنوي: قيد ترحيل الصافي إلى 3300 وتصفير الحسابات الاسمية (§4.1)", async () => {
    const year = closing.createPeriod(TENANT, "2026");

    await journalRepo.save(
      postEntry(journalRepo, "2026-03-01", "مبيعات", [
        { accountId: ids["1101"], side: "debit", amount: "1000000" },
        { accountId: ids["4150"], side: "credit", amount: "1000000" },
      ])
    );
    await journalRepo.save(
      postEntry(journalRepo, "2026-04-01", "إيجار", [
        { accountId: ids["5210"], side: "debit", amount: "400000" },
        { accountId: ids["1101"], side: "credit", amount: "400000" },
      ])
    );

    const res = await closing.closeFiscalPeriod(TENANT, year.id, OWNER);
    expect(res.closingEntryId).not.toBeNull();

    // قيد الإقفال: مدين 4150 بمليون، دائن 5210 بأربعمئة، دائن 3300 بالفرق (صافي ربح 600 ألف)
    const lines = db
      .prepare(
        `SELECT jl.side, a.code, jl.base_amount FROM journal_lines jl
         JOIN accounts a ON a.id = jl.account_id
         WHERE jl.journal_entry_id = ? ORDER BY jl.line_order`
      )
      .all(res.closingEntryId) as Array<{ side: string; code: string; base_amount: string }>;
    expect(lines).toEqual(
      expect.arrayContaining([
        { side: "debit", code: "4150", base_amount: "1000000.0000" },
        { side: "credit", code: "5210", base_amount: "400000.0000" },
        { side: "credit", code: "3300", base_amount: "600000.0000" },
      ])
    );

    // تصفير الاسمية (§4.1 الخطوة الأخيرة)
    const rev = db
      .prepare(`SELECT current_balance_base FROM account_running_balances WHERE tenant_id = ? AND account_code = '4150'`)
      .get(TENANT) as { current_balance_base: string };
    expect(new Decimal(rev.current_balance_base).isZero()).toBe(true);

    // الأرباح المرحّلة تحملت الصافي في الجدول الحي بعد النقل
    const retained = db
      .prepare(`SELECT current_balance_base FROM account_running_balances WHERE tenant_id = ? AND account_code = '3300'`)
      .get(TENANT) as { current_balance_base: string };
    expect(retained.current_balance_base).toBe("600000.0000");
  });

  it("الحماية: صلاحية close إلزامية، ومنع إقفال مرتين، وإعادة فتح تتطلب reopen + سبب + تسلسل (§4.2/§9)", async () => {
    const period = closing.createPeriod(TENANT, "2026-09");

    await expect(
      closing.closeFiscalPeriod(TENANT, period.id, { ...OWNER, permissions: [] })
    ).rejects.toBeInstanceOf(PermissionDeniedError);

    await closing.closeFiscalPeriod(TENANT, period.id, OWNER);
    await expect(closing.closeFiscalPeriod(TENANT, period.id, OWNER)).rejects.toBeInstanceOf(PeriodStateError);

    // إعادة فتح بلا صلاحية reopen (صلاحية أعلى من close §9)
    await expect(
      closing.reopenFiscalPeriod(TENANT, period.id, "خطأ إدخال", { ...OWNER, permissions: ["periods.close"] })
    ).rejects.toBeInstanceOf(PermissionDeniedError);

    // بلا سبب
    await expect(
      closing.reopenFiscalPeriod(TENANT, period.id, "", OWNER)
    ).rejects.toBeInstanceOf(PeriodStateError);

    // التسلسل: بعد إنشاء وإقفال أكتوبر، لا يُفتح سبتمبر (§4.2 ASSERT)
    const oct = closing.createPeriod(TENANT, "2026-10");
    await closing.closeFiscalPeriod(TENANT, oct.id, OWNER);
    await expect(
      closing.reopenFiscalPeriod(TENANT, period.id, "سبب كافٍ", OWNER)
    ).rejects.toBeInstanceOf(PeriodStateError);
  });

  it("إعادة فتح سنوي: تعكس قيد الإقفال بقيد عكسي رسمي وتستعيد الجدول الحي وتحذف اللقطة (§4.2)", async () => {
    const year = closing.createPeriod(TENANT, "2026");
    await journalRepo.save(
      postEntry(journalRepo, "2026-05-01", "مبيعات", [
        { accountId: ids["1101"], side: "debit", amount: "500000" },
        { accountId: ids["4150"], side: "credit", amount: "500000" },
      ])
    );
    const closeRes = await closing.closeFiscalPeriod(TENANT, year.id, OWNER);
    const reb = new BalanceMaintenanceStore(db);
    expect(reb.getRunningBalance(TENANT, "4150")!.current_balance_base).toBe("0.0000"); // مُصفّرة

    const reopenRes = await closing.reopenFiscalPeriod(TENANT, year.id, "اكتشاف قيد ناقص", OWNER);

    // استعادة الجدول الحي: إيراد يعود 500 ألف
    expect(reb.getRunningBalance(TENANT, "4150")!.current_balance_base).toBe("500000.0000");

    // القيد العكسي موجود ومعلَّم على الأصلي (§ مبدأ: لا حذف قيود)
    const reversal = db
      .prepare(`SELECT id FROM journal_entries WHERE reversal_of_entry_id = ?`)
      .get(closeRes.closingEntryId) as { id: string } | undefined;
    expect(reversal).toBeDefined();
    const originalFlag = db
      .prepare(`SELECT is_reversed FROM journal_entries WHERE id = ?`)
      .get(closeRes.closingEntryId!) as { is_reversed: number };
    expect(originalFlag.is_reversed).toBe(1);

    // اللقطة حُذفت والفترة عادت open
    const snaps = db
      .prepare(`SELECT COUNT(*) AS c FROM account_period_balances WHERE fiscal_period_id = ?`)
      .get(year.id) as { c: number };
    expect(snaps.c).toBe(0);
    expect(reopenRes.period.status).toBe("open");

    // سجل التدقيق الإلزامي (§4.2/§9)
    const audit = db
      .prepare(`SELECT action, details_json FROM audit_log WHERE entity_id = ? ORDER BY created_at`)
      .all(`period:${year.id}`) as Array<{ action: string; details_json: string }>;
    expect(audit.map((a) => a.action)).toEqual(["period_closed", "period_reopened"]);
    expect(JSON.parse(audit[1].details_json).reason).toBe("اكتشاف قيد ناقص");
  });
});

describe("إقفال اليوم المرن — §4.3", () => {
  let db: Database.Database;
  let journalRepo: SqliteJournalRepository;
  let reporting: FinancialReportingService;
  let ids: Record<string, string>;

  beforeEach(() => {
    db = freshDb();
    ids = seedChart(db);
    journalRepo = new SqliteJournalRepository(db);
    reporting = new FinancialReportingService(db);
  });
  afterEach(() => db.close());

  it("معاينة ثم إقفال بتسجيل فرق النقد واقتراح تسوية عند وجود عجز", async () => {
    await journalRepo.save(
      postEntry(journalRepo, "2026-10-05", "بيع نقدي", [
        { accountId: ids["1101"], side: "debit", amount: "100000" },
        { accountId: ids["4150"], side: "credit", amount: "100000" },
      ])
    );

    const preview = reporting.previewDailyClosure("2026-10-05", VIEWER);
    expect(preview.expectedCashBalance).toBe("100000.0000");
    expect(preview.dailyResult?.revenueTotalBase).toBe("100000.0000");

    const closure = reporting.closeBusinessDay("2026-10-05", "95000", { ...VIEWER, userId: "user-owner" });
    expect(closure.cashVariance).toBe("-5000.0000");
    expect(closure.suggestedAdjustment).toBe(true); // §4.3 اقتراح قالب عجز صندوق

    const row = db
      .prepare(`SELECT * FROM daily_closures WHERE tenant_id = ? AND business_date = ?`)
      .get(TENANT, "2026-10-05") as { status: string; cash_variance: string };
    expect(row.status).toBe("closed");
    expect(row.cash_variance).toBe("-5000.0000");

    // §4.3: إقفال اليوم لا يمنع قيدًا لاحقًا بنفس التاريخ (المرونة المقصودة)
    await journalRepo.save(
      postEntry(journalRepo, "2026-10-05", "بيع إضافي بعد الإقفال", [
        { accountId: ids["1101"], side: "debit", amount: "10000" },
        { accountId: ids["4150"], side: "credit", amount: "10000" },
      ])
    ); // لا استثناء — نجح
  });
});

describe("التقارير المالية — §6", () => {
  let db: Database.Database;
  let journalRepo: SqliteJournalRepository;
  let reporting: FinancialReportingService;
  let ids: Record<string, string>;

  beforeEach(() => {
    db = freshDb();
    ids = seedChart(db);
    journalRepo = new SqliteJournalRepository(db);
    reporting = new FinancialReportingService(db);
  });
  afterEach(() => db.close());

  it("الكتالوج §5: 9 تقارير نظام نشطة عبر listAvailableReports ونقطة موحّدة §7.1", async () => {
    const list = reporting.listAvailableReports();
    expect(list.length).toBeGreaterThanOrEqual(9);
    expect(list.map((r) => r.reportCode)).toContain("trial_balance");

    await journalRepo.save(
      postEntry(journalRepo, "2026-10-01", "بيع", [
        { accountId: ids["1101"], side: "debit", amount: "50000" },
        { accountId: ids["4150"], side: "credit", amount: "50000" },
      ])
    );
    const tb = (await reporting.generateReport("trial_balance", { as_of_date: "2026-10-01" }, VIEWER)) as {
      totalDebit: string;
      totalCredit: string;
    };
    expect(tb.totalDebit).toBe(tb.totalCredit);

    // Feature Flag §2.6: تعطيل تعريف يخفيه من النقطة الموحّدة
    db.prepare(`UPDATE report_definitions SET is_active = 0 WHERE report_code = 'journal_book'`).run();
    await expect(reporting.generateReport("journal_book", {}, VIEWER)).rejects.toThrow();

    // رصد التنفيذ §2.7
    const logs = db
      .prepare(`SELECT report_code, execution_time_ms FROM report_execution_log WHERE tenant_id = ?`)
      .all(TENANT) as Array<{ report_code: string; execution_time_ms: number }>;
    expect(logs.some((l) => l.report_code === "trial_balance")).toBe(true);
  });

  it("ميزان المراجعة §6.1: لا حسابات صفرية + ASSERT توازن إلزامي", async () => {
    await journalRepo.save(
      postEntry(journalRepo, "2026-10-01", "افتتاحي رأس مال", [
        { accountId: ids["1101"], side: "debit", amount: "1000000" },
        { accountId: ids["3101"], side: "credit", amount: "1000000" },
      ])
    );
    const tb = reporting.trialBalance("2026-10-01", VIEWER);
    expect(tb.rows.every((r) => !(r.debit === "0.0000" && r.credit === "0.0000"))).toBe(true);
    expect(tb.rows.find((r) => r.accountCode === "5210")).toBeUndefined(); // صفر ⇒ غير معروض
    expect(tb.totalDebit).toBe("1000000.0000");
    expect(tb.totalCredit).toBe("1000000.0000");
  });

  it("قائمة الدخل §6.2: فصل COGS (51xx) عن المصروفات التشغيلية وصافي الربح", async () => {
    await journalRepo.save(
      postEntry(journalRepo, "2026-10-01", "بيع آجل", [
        { accountId: ids["1210"], side: "debit", amount: "450000" },
        { accountId: ids["4150"], side: "credit", amount: "450000" },
      ])
    );
    await journalRepo.save(
      postEntry(journalRepo, "2026-10-02", "تكلفة البضاعة", [
        { accountId: ids["5110"], side: "debit", amount: "280000" },
        { accountId: ids["1210"], side: "credit", amount: "280000" },
      ])
    );
    await journalRepo.save(
      postEntry(journalRepo, "2026-10-03", "إيجار", [
        { accountId: ids["5210"], side: "debit", amount: "65000" },
        { accountId: ids["1101"], side: "credit", amount: "65000" },
      ])
    );

    const inc = reporting.incomeStatement("2026-10-01", "2026-10-31", VIEWER);
    expect(inc.revenue.total).toBe("450000.0000");
    expect(inc.cogs).toBe("280000.0000");
    expect(inc.grossProfit).toBe("170000.0000");
    expect(inc.operatingExpenses.total).toBe("65000.0000");
    expect(inc.netProfit).toBe("105000.0000"); // يطابق مثال الاستجابة §7.1 حرفيًا
  });

  it("الميزانية العمومية: معادلة A = L + E متحققة", async () => {
    await journalRepo.save(
      postEntry(journalRepo, "2026-10-01", "افتتاحي", [
        { accountId: ids["1101"], side: "debit", amount: "1000000" },
        { accountId: ids["2101"], side: "credit", amount: "400000" },
        { accountId: ids["3101"], side: "credit", amount: "600000" },
      ])
    );
    const bs = reporting.balanceSheet("2026-10-01", VIEWER);
    expect(bs.totals.assets).toBe("1000000.0000");
    expect(bs.balanced).toBe(true);
  });

  it("دفتر النقدية والأستاذ واليومية (live_query) — رصيد جري صحيح", async () => {
    await journalRepo.save(
      postEntry(journalRepo, "2026-10-01", "إيداع رأس مال", [
        { accountId: ids["1101"], side: "debit", amount: "200000" },
        { accountId: ids["3101"], side: "credit", amount: "200000" },
      ])
    );
    await journalRepo.save(
      postEntry(journalRepo, "2026-10-02", "سحب مصروف", [
        { accountId: ids["5210"], side: "debit", amount: "50000" },
        { accountId: ids["1101"], side: "credit", amount: "50000" },
      ])
    );

    const cb = reporting.cashBook({ date_from: "2026-10-01", date_to: "2026-10-31" }, VIEWER);
    expect(cb.totalIn).toBe("200000.0000");
    expect(cb.totalOut).toBe("50000.0000");
    expect(cb.rows.at(-1)!.running).toBe("150000.0000");

    const gl = reporting.generalLedger({ account_id: ids["1101"] }, VIEWER) as {
      closingBalance: string;
      totalDebit: string;
      totalCredit: string;
    };
    expect(gl.closingBalance).toBe("150000.0000");
    expect(gl.totalDebit).toBe("200000.0000");
    expect(gl.totalCredit).toBe("50000.0000");

    const jb = reporting.journalBook("2026-10-01", "2026-10-31", VIEWER) as unknown[];
    expect(jb).toHaveLength(2);
  });

  it("تقرير فروق العملة §6.4: فصل التشغيلي عن أثر الصرف + تحذير عربي", async () => {
    await journalRepo.save(
      postEntry(journalRepo, "2026-10-01", "ربح تشغيلي", [
        { accountId: ids["1101"], side: "debit", amount: "100000" },
        { accountId: ids["4150"], side: "credit", amount: "100000" },
      ])
    );
    await journalRepo.save(
      postEntry(journalRepo, "2026-10-02", "خسارة صرف", [
        { accountId: ids["4900"], side: "debit", amount: "30000" },
        { accountId: ids["1210"], side: "credit", amount: "30000" },
      ])
    );

    const fx = reporting.fxImpactReport("2026-10-01", "2026-10-31", VIEWER);
    // الربح التشغيلي يستبعد 4900 (معزول في daily hook) لكنه يظهر كمصروف؟ — لا: §6.4
    // operatingNetProfit من incomeStatement يشمل أي حساب expense؛ 4900 هنا مصروف اسمي
    // لكن الفصل المطلوب: netFx منفصل والتحذير يظهر. القيمتان محسوبتان من مصدرين مستقلين.
    expect(fx.fxLosses).toBe("30000.0000");
    expect(fx.netFxImpact).toBe("-30000.0000");
    expect(fx.warningAr).toContain("سعر الصرف");
  });
});

describe("🏆 GOLDEN TEST — قائمة دخل عبر فترتين (مقفلة + مفتوحة) = الحساب الحي بالكامل (§9/§10 الأولوية القصوى)", () => {
  let db: Database.Database;
  let journalRepo: SqliteJournalRepository;
  let closing: PeriodClosingService;
  let reporting: FinancialReportingService;
  let ids: Record<string, string>;

  beforeEach(() => {
    db = freshDb();
    ids = seedChart(db);
    journalRepo = new SqliteJournalRepository(db);
    closing = new PeriodClosingService(db);
    reporting = new FinancialReportingService(db);
  });
  afterEach(() => db.close());

  it("نتيجة نطاق [سبتمبر+أكتوبر] بعد إقفال سبتمبر مطابقة تمامًا لنتيجته قبل الإقفال", async () => {
    // قيود سبتمبر
    await journalRepo.save(
      postEntry(journalRepo, "2026-09-05", "مبيعات سبتمبر", [
        { accountId: ids["1210"], side: "debit", amount: "300000" },
        { accountId: ids["4150"], side: "credit", amount: "300000" },
      ])
    );
    await journalRepo.save(
      postEntry(journalRepo, "2026-09-20", "تكلفة سبتمبر", [
        { accountId: ids["5110"], side: "debit", amount: "120000" },
        { accountId: ids["1210"], side: "credit", amount: "120000" },
      ])
    );
    // قيود أكتوبر
    await journalRepo.save(
      postEntry(journalRepo, "2026-10-03", "مبيعات أكتوبر", [
        { accountId: ids["1101"], side: "debit", amount: "500000" },
        { accountId: ids["4150"], side: "credit", amount: "500000" },
      ])
    );
    await journalRepo.save(
      postEntry(journalRepo, "2026-10-10", "إيجار أكتوبر", [
        { accountId: ids["5210"], side: "debit", amount: "60000" },
        { accountId: ids["1101"], side: "credit", amount: "60000" },
      ])
    );

    const RANGE = { from: "2026-09-01", to: "2026-10-31" };

    // (أ) حي بالكامل — قبل أي إقفال
    const liveBefore = reporting.incomeStatement(RANGE.from, RANGE.to, VIEWER);
    expect(liveBefore.netProfit).toBe("620000.0000"); // 300k+500k−120k−60k

    // (ب) إقفال سبتمبر (شهري — لا قيد ترحيل)
    const sep = closing.listPeriods(TENANT).find((p) => p.periodKey === "2026-09");
    const sepPeriod = sep ?? closing.createPeriod(TENANT, "2026-09");
    // القيود التي أُدخلت قبل إنشاء الفترة — الإنشاء الآن ثم الإقفال يلتقط الجدول الحي كما هو
    await closing.closeFiscalPeriod(TENANT, sepPeriod.id, OWNER);

    // (ج) hybrid — يجب التطابق الحرفي في كل سطر
    const hybrid = reporting.incomeStatement(RANGE.from, RANGE.to, VIEWER);
    expect(hybrid.revenue.total).toBe(liveBefore.revenue.total);
    expect(hybrid.cogs).toBe(liveBefore.cogs);
    expect(hybrid.grossProfit).toBe(liveBefore.grossProfit);
    expect(hybrid.operatingExpenses.total).toBe(liveBefore.operatingExpenses.total);
    expect(hybrid.netProfit).toBe(liveBefore.netProfit);

    // ميزان المراجعة أيضًا متسق هجينًا: 1210 = 300k−120k + حركة أكتوبر (لا شيء على 1210) = 180k
    const tb = reporting.trialBalance("2026-10-31", VIEWER);
    expect(tb.totalDebit).toBe(tb.totalCredit); // §9 ASSERT
    const ar = tb.rows.find((r) => r.accountCode === "1210")!;
    expect(ar.debit).toBe("180000.0000");

    // والميزانية العمومية متوازنة بعد الإقفال الهجين
    const bs = reporting.balanceSheet("2026-10-31", VIEWER);
    expect(bs.balanced).toBe(true);
  });

  it("رصيد كما-في-تاريخ داخل فترة مقفلة قديمة لا يزدوج مع اللقطة", async () => {
    await journalRepo.save(
      postEntry(journalRepo, "2026-09-10", "مبيعات", [
        { accountId: ids["1101"], side: "debit", amount: "100000" },
        { accountId: ids["4150"], side: "credit", amount: "100000" },
      ])
    );
    const sep = closing.createPeriod(TENANT, "2026-09");
    await closing.closeFiscalPeriod(TENANT, sep.id, OWNER);

    // طلب as-of داخل الفترة المُقفَلة نفسها (2026-09-15): اللقطة تنتهي 09-30 > asOf ⇒ تُقرأ حيّة فقط
    const tbMid = reporting.trialBalance("2026-09-15", VIEWER);
    const cash = tbMid.rows.find((r) => r.accountCode === "1101")!;
    expect(cash.debit).toBe("100000.0000"); // لا ازدواج، لا ضِعف

    // as-of بعد الإقفال: الأساس لقطة + حركة لاحقة
    const tbAfter = reporting.trialBalance("2026-10-31", VIEWER);
    expect(tbAfter.rows.find((r) => r.accountCode === "1101")!.debit).toBe("100000.0000");
  });
});
