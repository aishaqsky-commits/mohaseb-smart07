// tests/subledger.test.ts
// ===== اختبارات وحدة الذمم الفرعية (AR/AP Sub-Ledger) =====
// التغطية وفق docs/04-modules/ar-ap-subledger.md §8:
//   بند مفتوح من قيد، FIFO متعدد الفواتير، تحصيل جزئي متكرر، Overpayment golden test (§3.3)،
//   فرق العملة + قيد FX تلقائي متوازن (§3.2/§8)، الأعمار (§5.1)، كشف الحساب (§6.1)،
//   الشطب/منع العكس (§6.1/§7)، وFuzz توزيع عشوائي حتمي البذرة.

import Database from "better-sqlite3";
import Decimal from "decimal.js";

import { createCoreContainer, CoreContainer } from "../src/infrastructure/bootstrap/createCoreContainer";
import { TemplateDefinition } from "../src/templates/types/TemplateDefinition";
import { SubledgerOperationError } from "../src/application/errors/ApplicationErrors";

import saleCredit from "../templates-fixtures/sale_credit.json";
import customerCollection from "../templates-fixtures/customer_collection.json";

const TENANT_ID = "tenant-sub-001";
const CUST = "cust-1";

function seedAccounts(db: Database.Database): void {
  const insert = db.prepare(`
    INSERT INTO accounts (id, tenant_id, code, name_ar_simple, account_type, normal_balance, is_header, is_postable)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  insert.run("a1", TENANT_ID, "1101", "الصندوق الرئيسي", "asset", "debit", 0, 1);
  insert.run("a2", TENANT_ID, "1210", "العملاء", "asset", "debit", 0, 1);
  insert.run("a3", TENANT_ID, "4150", "إيرادات المبيعات", "revenue", "credit", 0, 1);
  insert.run("a4", TENANT_ID, "4900", "أرباح فروق العملة", "revenue", "credit", 0, 1);
  insert.run("a5", TENANT_ID, "5900", "خسائر فروق العملة", "expense", "debit", 0, 1);
}

/**
 * مزوّد أسعار ديناميكي قابل للضبط أثناء الاختبار — يحاكي تغيّر سعر الصرف بين يوم الفاتورة ويوم التحصيل
 * (StaticExchangeRateProvider في الحاوية يقرأ منه عند كل عملية).
 */
class DynamicRateProvider {
  rates: Record<string, string> = {};
  async getRate(): Promise<string> {
    // يُستدعى فقط لعملات غير عملة الأساس؛ نعيد سعر العملة الجارية المخزّن أو 1
    return this.current;
  }
  current = "1";
}

function buildContainer(rateProvider?: DynamicRateProvider): { container: CoreContainer; rates: DynamicRateProvider } {
  const rates = rateProvider ?? new DynamicRateProvider();
  const container = createCoreContainer({
    tenantId: TENANT_ID,
    baseCurrencyCode: "YER",
    scope: "core",
    templates: [saleCredit as unknown as TemplateDefinition, customerCollection as unknown as TemplateDefinition],
    exchangeRateProvider: rates,
  });
  seedAccounts(container.db);
  return { container, rates };
}

async function postSale(c: CoreContainer, total: string, date: string, customerId = CUST, currency = "YER"): Promise<string> {
  const res = await c.recordTransactionService.execute({
    templateCode: "sale_credit",
    payload: { total_amount: total, transaction_date: date, customer_id: customerId, currency_code: currency },
  });
  return res.transactionId;
}

async function postCollection(c: CoreContainer, amount: string, date: string, invoiceRef?: string): Promise<string> {
  const res = await c.recordTransactionService.execute({
    templateCode: "customer_collection",
    payload: {
      amount, transaction_date: date, customer_id: CUST,
      currency_code: "YER", received_to_account: "1101",
      ...(invoiceRef ? { invoice_ref: invoiceRef } : {}),
    },
  });
  return res.transactionId;
}

describe("الذمم الفرعية — البند المفتوح والتسويات", () => {
  let container: CoreContainer;
  beforeEach(() => { container = buildContainer().container; });
  afterEach(() => container.db.close());

  it("بيع آجل ينشئ بند AR بقيمة العملية وعملة السطر وسعره المثبت", async () => {
    const txId = await postSale(container, "5000", "2026-01-10");
    const items = container.subledgerService.findUnsettledItems(TENANT_ID, CUST, "AR");
    expect(items).toHaveLength(1);
    expect(items[0].originalAmount).toBe("5000.0000");
    expect(items[0].remainingAmount).toBe("5000.0000");
    expect(items[0].baseRemainingAmount).toBe("5000.0000");
    expect(items[0].currencyCode).toBe("YER");
    expect(items[0].exchangeRate).toBe("1");
    expect(items[0].sourceTransactionId).toBe(txId);
    expect(items[0].status).toBe("open");
  });

  it("تحصيل كامل يسدد البند ويخرجه من قائمة غير المسددة", async () => {
    await postSale(container, "5000", "2026-01-10");
    await postCollection(container, "5000", "2026-01-20");
    expect(container.subledgerService.findUnsettledItems(TENANT_ID, CUST, "AR")).toHaveLength(0);
    const all = container.subledgerService.repo.findAllItemsForContact(TENANT_ID, CUST);
    expect(all[0].status).toBe("settled");
  });

  it("FIFO: دفعة واحدة توزع على ثلاث فواتير بالأقدم أولاً والباقي على الأخيرة", async () => {
    await postSale(container, "100", "2026-01-01");
    await postSale(container, "200", "2026-01-02");
    await postSale(container, "300", "2026-01-03");
    await postCollection(container, "250", "2026-01-15");

    const byDate = new Map(
      container.subledgerService.repo.findAllItemsForContact(TENANT_ID, CUST).map((i) => [i.invoiceDate, i])
    );
    expect(byDate.get("2026-01-01")!.status).toBe("settled");
    expect(byDate.get("2026-01-02")!.status).toBe("settled");
    expect(byDate.get("2026-01-03")!.remainingAmount).toBe("150.0000");
  });

  it("تحصيل جزئي متكرر: ثلاث دفعات على فاتورة واحدة حتى السداد", async () => {
    await postSale(container, "900", "2026-02-01");
    await postCollection(container, "300", "2026-02-05");
    await postCollection(container, "250", "2026-02-10");
    let open = container.subledgerService.findUnsettledItems(TENANT_ID, CUST, "AR");
    expect(open[0].remainingAmount).toBe("350.0000");
    expect(open[0].status).toBe("partially_paid");

    await postCollection(container, "350", "2026-02-15");
    open = container.subledgerService.findUnsettledItems(TENANT_ID, CUST, "AR");
    expect(open).toHaveLength(0);
  });

  it("Overpayment golden test (§3.3): الفائض بند مفتوح بتاريخ التسوية يتصدر طابور FIFO", async () => {
    await postSale(container, "1000", "2026-03-01");
    await postCollection(container, "1300", "2026-03-05");

    let open = container.subledgerService.findUnsettledItems(TENANT_ID, CUST, "AR");
    expect(open).toHaveLength(1);
    expect(open[0].remainingAmount).toBe("300.0000");
    expect(open[0].invoiceDate).toBe("2026-03-05");

    // بعد فاتورة لاحقة، يبقى الفائض (الأقدم تاريخًا بين غير المسددة؟ لا — الفاتورة أحدث)
    // الترتيب FIFO بالأقدم أولًا: الفائض 2026-03-05 أسبق من الفاتورة 2026-03-10 ⇒ يتصدر الطابور.
    await postSale(container, "500", "2026-03-10");
    open = container.subledgerService.findUnsettledItems(TENANT_ID, CUST, "AR");
    expect(open[0].invoiceDate).toBe("2026-03-05");
    const total = open.reduce((a, i) => a.plus(i.remainingAmount), new Decimal(0));
    expect(total.toFixed(4)).toBe("800.0000"); // 300 فائض + 500 فاتورة
  });

  it("targetItemId: التخصيص لفاتورة محددة لا يمس غيرها", async () => {
    await postSale(container, "100", "2026-01-01");
    await postSale(container, "200", "2026-01-02");
    const second = container.subledgerService.repo.findUnsettledItems(TENANT_ID, CUST, "AR")[1];

    await postCollection(container, "200", "2026-01-20", second.id);
    const all = container.subledgerService.repo.findAllItemsForContact(TENANT_ID, CUST);
    expect(all.find((i) => i.invoiceDate === "2026-01-01")!.status).toBe("open");
    expect(all.find((i) => i.invoiceDate === "2026-01-02")!.status).toBe("settled");
  });

  it("تخصيص لبند غير موجود يفشل ذرّياً ولا يكتب شيئاً (القيد نفسه لم يمر?)", async () => {
    await postSale(container, "100", "2026-01-01");
    await expect(
      postCollection(container, "100", "2026-01-20", "no-such-item-id")
    ).rejects.toThrow(/غير موجودة أو مسدَّدة/);
    // بند الفاتورة الأصلية لم يتأثر
    const open = container.subledgerService.findUnsettledItems(TENANT_ID, CUST, "AR");
    expect(open).toHaveLength(1);
    expect(open[0].remainingAmount).toBe("100.0000");
  });
});

describe("الذمم الفرعية — فروق العملة وقيود FX (§3.2/§8)", () => {
  /**
   * نمط الاختبار: البيع بالدولار بسعر مُزوَّد الحاوية (rates.current وقت التنفيذ)،
   * ثم التحصيل نقدًا بالأساس عبر قيد يدوي بسعر مختلف — الخدمة تحسب الفرق لكل بند.
   */
  function fxSetup(saleRate: string) {
    const rates = new DynamicRateProvider();
    rates.rates = {};
    rates.current = saleRate;
    const { container } = buildContainer(rates);
    return { container, rates };
  }

  it("ربح صرف: بيع USD@500 وتحصيل يعادل 550 ⇒ fx=+50,000 وقيد متوازن إلى 4900", async () => {
    const { container } = fxSetup("500");
    try {
      await postSale(container, "1000", "2026-01-10", CUST, "USD");
      const item = container.subledgerService.repo.findUnsettledItems(TENANT_ID, CUST, "AR")[0];
      expect(item.originalAmount).toBe("1000.0000");
      expect(item.exchangeRate).toBe("500");
      expect(item.baseRemainingAmount).toBe("500000.0000");

      // قيد تحصيل نقدي بـ 550,000 YER يسدد 1000 USD (سطر الطرف بعملة البنود USD وسعر اليوم 550)
      const entry = await container.journalEngine.postEntry({
        tenantId: TENANT_ID,
        entryDate: new Date("2026-02-10"),
        descriptionSimple: "تحصيل من عميل (اختبار ربح FX)",
        sourceType: "settlement",
        baseCurrencyCode: "YER",
        lines: [
          { accountCode: "1101", side: "debit", amount: "550000", currencyCode: "YER", exchangeRateUsed: "1" },
          { accountCode: "1210", side: "credit", amount: "1000", currencyCode: "USD", exchangeRateUsed: "550", contactId: CUST },
        ],
      });
      const outcome = await container.subledgerService.settleFromEntry({
        tenantId: TENANT_ID, transactionId: "fx-settle-1",
        payload: {}, primaryEntry: entry, baseCurrencyCode: "YER",
      });

      expect(outcome).not.toBeNull();
      expect(outcome!.allocations).toHaveLength(1);
      expect(outcome!.allocations[0].fxGainLossAmount.toFixed(4)).toBe("50000.0000");

      const settled = container.subledgerService.repo.findById(TENANT_ID, item.id)!;
      expect(settled.status).toBe("settled");
      expect(settled.baseRemainingAmount).toBe("0.0000");

      // §8 قاعدة التكامل:fx≠0 له قيد، والأستاذ الكامل ما زال متوازنًا
      const totals = container.db.prepare(`
        SELECT jl.side s, SUM(jl.base_amount) t FROM journal_lines jl
        JOIN journal_entries je ON je.id = jl.entry_id
        WHERE je.tenant_id = ? GROUP BY jl.side
      `).all(TENANT_ID) as Array<{ s: string; t: number }>;
      const debit = totals.find((r) => r.s === "debit")!.t;
      const credit = totals.find((r) => r.s === "credit")!.t;
      expect(Math.abs(debit - credit)).toBeLessThan(0.005);

      const gainLine = container.db.prepare(`
        SELECT jl.base_amount t FROM journal_lines jl
        JOIN journal_entries je ON je.id = jl.entry_id
        JOIN accounts ac ON ac.id = jl.account_id
        WHERE je.tenant_id = ? AND ac.code = '4900'
      `).get(TENANT_ID) as { t: number };
      expect(gainLine.t).toBeCloseTo(50000, 3);
    } finally {
      container.db.close();
    }
  });

  it("خسارة صرف: بيع USD@500 وتحصيل يعادل 480 ⇒ fx=-2,000 وقيد خسارة إلى 5900", async () => {
    const { container } = fxSetup("500");
    try {
      await postSale(container, "100", "2026-01-10", CUST, "USD");
      const entry = await container.journalEngine.postEntry({
        tenantId: TENANT_ID,
        entryDate: new Date("2026-02-10"),
        descriptionSimple: "تحصيل من عميل (اختبار خسارة FX)",
        sourceType: "settlement",
        baseCurrencyCode: "YER",
        lines: [
          { accountCode: "1101", side: "debit", amount: "48000", currencyCode: "YER", exchangeRateUsed: "1" },
          { accountCode: "1210", side: "credit", amount: "100", currencyCode: "USD", exchangeRateUsed: "480", contactId: CUST },
        ],
      });
      const outcome = await container.subledgerService.settleFromEntry({
        tenantId: TENANT_ID, transactionId: "fx-settle-2",
        payload: {}, primaryEntry: entry, baseCurrencyCode: "YER",
      });
      expect(outcome!.allocations[0].fxGainLossAmount.toFixed(4)).toBe("-2000.0000");

      const lossLine = container.db.prepare(`
        SELECT jl.base_amount t FROM journal_lines jl
        JOIN journal_entries je ON je.id = jl.entry_id
        JOIN accounts ac ON ac.id = jl.account_id
        WHERE je.tenant_id = ? AND ac.code = '5900' AND jl.side = 'debit'
      `).get(TENANT_ID) as { t: number };
      expect(lossLine.t).toBeCloseTo(2000, 3);
    } finally {
      container.db.close();
    }
  });

  it("بلا فرق عملة (نفس السعر) ⇒ لا قيد FX إطلاقًا", async () => {
    const { container } = fxSetup("500");
    try {
      await postSale(container, "10", "2026-01-10", CUST, "USD");
      const before = (container.db.prepare(`SELECT COUNT(*) n FROM journal_entries`).get() as { n: number }).n;
      const entry = await container.journalEngine.postEntry({
        tenantId: TENANT_ID, entryDate: new Date("2026-02-10"),
        descriptionSimple: "تحصيل بسعر مماثل", sourceType: "settlement", baseCurrencyCode: "YER",
        lines: [
          { accountCode: "1101", side: "debit", amount: "5000", currencyCode: "YER", exchangeRateUsed: "1" },
          { accountCode: "1210", side: "credit", amount: "10", currencyCode: "USD", exchangeRateUsed: "500", contactId: CUST },
        ],
      });
      const outcome = await container.subledgerService.settleFromEntry({
        tenantId: TENANT_ID, transactionId: "fx-none", payload: {}, primaryEntry: entry, baseCurrencyCode: "YER",
      });
      expect(outcome!.allocations[0].fxGainLossAmount.isZero()).toBe(true);
      const after = (container.db.prepare(`SELECT COUNT(*) n FROM journal_entries`).get() as { n: number }).n;
      expect(after).toBe(before + 1); // قيد التحصيل فقط، لا قيد FX إضافي
    } finally {
      container.db.close();
    }
  });
});

describe("الذمم الفرعية — التقارير والحوكمة", () => {
  let container: CoreContainer;
  beforeEach(() => { container = buildContainer().container; });
  afterEach(() => container.db.close());

  it("أعمار الديون (§5.1): توزيع صحيح على الخماسي (due_date ?? invoice_date)", async () => {
    await postSale(container, "100", "2025-06-01");  // age≈226 ⇒ over_90
    await postSale(container, "200", "2025-12-15");  // age≈29  ⇒ days_1_30
    await postSale(container, "300", "2026-01-10");  // age=3   ⇒ days_1_30? لا: 13-Jan−10-Jan=3 ⇒ days_1_30… نريده current:

    // الثالثة بتاريخ مستقبلي نسبيًا عن asOf ⇒ current
    await postSale(container, "50", "2026-02-01");   // age<0 ⇒ current

    const rows = container.subledgerService.calculateAging(TENANT_ID, "AR", "2026-01-13");
    expect(rows).toHaveLength(1);
    const r = rows[0];
    expect(r.total).toBe("650.0000");
    expect(r.over_90).toBe("100.0000");
    expect(r.days_1_30).toBe("500.0000"); // 200 + 300
    expect(r.current).toBe("50.0000");
  });

  it("agingSummary يجمع عبر كل الأطراف", async () => {
    await postSale(container, "100", "2025-06-01");
    await postSale(container, "50", "2025-06-01", "cust-2");
    const sum = container.subledgerService.agingSummary(TENANT_ID, "AR", "2026-01-13");
    expect(sum.over_90).toBe("150.0000");
    expect(sum.total).toBe("150.0000");
  });

  it("كشف الحساب (§6.1): أحداث مرتبة زمنيًا برصيد جارٍ صحيح", async () => {
    await postSale(container, "500", "2026-01-01");
    await postCollection(container, "200", "2026-01-10");
    await postSale(container, "300", "2026-01-15");

    const st = container.subledgerService.buildStatement(TENANT_ID, CUST);
    expect(st.lines.map((l) => l.date)).toEqual(["2026-01-01", "2026-01-10", "2026-01-15"]);
    expect(st.lines[0].debit).toBe("500.0000");
    expect(st.lines[1].credit).toBe("200.0000");
    expect(st.lines[2].running_balance).toBe("600.0000");
    expect(st.closingBalance).toBe("600.0000");
    expect(container.subledgerService.getBalance(TENANT_ID, CUST).ar).toBe("600.0000");
  });

  it("الشطب (§6.1): سبب إلزامي، يعمل على المفتوح، ويرفض المسدد/المشطوب/المفقود", async () => {
    await postSale(container, "100", "2026-01-01");
    const item = container.subledgerService.repo.findUnsettledItems(TENANT_ID, CUST, "AR")[0];

    expect(() => container.subledgerService.writeOff(TENANT_ID, item.id, "  ")).toThrow(/سبب الشطب إلزامي/);
    const off = container.subledgerService.writeOff(TENANT_ID, item.id, "إفلاس العميل");
    expect(off!.status).toBe("written_off");
    expect(container.subledgerService.findUnsettledItems(TENANT_ID, CUST, "AR")).toHaveLength(0);
    expect(() => container.subledgerService.writeOff(TENANT_ID, item.id, "مرتين")).toThrow(SubledgerOperationError);
    expect(() => container.subledgerService.writeOff(TENANT_ID, "ghost-id", "سبب")).toThrow(/غير موجود/);
  });

  it("منع العكس (§7): تخصيصات تمنع العكس، وبلا تخصيصات يمر", async () => {
    await postSale(container, "400", "2026-01-01");
    const txId = container.subledgerService.repo.findUnsettledItems(TENANT_ID, CUST, "AR")[0].sourceTransactionId;
    expect(() => container.subledgerService.assertReversible(TENANT_ID, txId)).not.toThrow();

    await postCollection(container, "100", "2026-01-05");
    expect(() => container.subledgerService.assertReversible(TENANT_ID, txId)).toThrow(/لا يمكن عكس هذه الفاتورة/);
  });

  it("trigger الحوكمة: المتبقي لا يتجاوز الأصلي حتى لو كُتب مباشرة (SQL-level guard)", () => {
    expect(() =>
      container.db.prepare(`UPDATE ar_ap_open_items SET remaining_amount = '999999'`).run()
    ).toThrow(/لا يمكن أن يتجاوز/);
  });
});

describe("الذمم الفرعية — Fuzz توزيع عشوائي حتمي (§8)", () => {
  it("20 جولة توزيع عشوائي على 5 فواتير: Σ أصلي = Σ متبقٍ + Σ مخصص، وحالات البنود متسقة", async () => {
    const { container } = buildContainer();
    try {
      const invoices = ["1000", "2500.55", "750.25", "3200", "999.99"];
      for (let i = 0; i < invoices.length; i++) {
        await postSale(container, invoices[i], `2026-0${i + 1}-05`);
      }
      const originalTotal = invoices.reduce((a, v) => a.plus(v), new Decimal(0));

      let rng = 42; // بذرة ثابتة — اختبار حتمي قابل للتكرار
      const rand = () => { rng = (rng * 1103515245 + 12345) % 2147483648; return rng / 2147483648; };

      for (let round = 0; round < 20; round++) {
        const open = container.subledgerService.findUnsettledItems(TENANT_ID, CUST, "AR");
        if (open.length === 0) break;
        const openTotal = open.reduce((a, i) => a.plus(i.remainingAmount), new Decimal(0));
        const pay = openTotal.times(rand()).toFixed(4);
        if (new Decimal(pay).gt(0)) {
          await postCollection(container, pay, `2026-06-${String(round + 1).padStart(2, "0")}`);
        }
      }

      const all = container.subledgerService.repo.findAllItemsForContact(TENANT_ID, CUST);
      const remainingTotal = all.reduce((a, i) => a.plus(i.remainingAmount), new Decimal(0));
      const allocated = (container.db.prepare(`
        SELECT COALESCE(SUM(a.allocated_amount),0) s FROM ar_ap_allocations a
        JOIN ar_ap_open_items o ON o.id = a.open_item_id WHERE o.tenant_id = ?
      `).get(TENANT_ID) as { s: number }).s;

      // invariant مع هامش تخزين 4 خانات لكل حركة (~25 حركة كحد أقصى)
      const drift = originalTotal.minus(remainingTotal).minus(new Decimal(allocated)).abs();
      expect(drift.lessThan(new Decimal("0.01"))).toBe(true);

      for (const item of all) {
        const rem = new Decimal(item.remainingAmount);
        const orig = new Decimal(item.originalAmount);
        expect(rem.gte(0)).toBe(true);
        expect(rem.lte(orig)).toBe(true);
        if (rem.eq(0)) expect(["settled", "written_off"]).toContain(item.status);
        else expect(["open", "partially_paid"]).toContain(item.status);
      }
    } finally {
      container.db.close();
    }
  });
});
