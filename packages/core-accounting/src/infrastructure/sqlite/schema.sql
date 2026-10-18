-- src/infrastructure/sqlite/schema.sql

CREATE TABLE IF NOT EXISTS accounts (
    id              TEXT PRIMARY KEY,
    tenant_id       TEXT NOT NULL,
    code            TEXT NOT NULL,
    name_ar_simple  TEXT NOT NULL,
    account_type    TEXT NOT NULL CHECK (account_type IN ('asset','liability','equity','revenue','expense')),
    normal_balance  TEXT NOT NULL CHECK (normal_balance IN ('debit','credit')),
    is_header       INTEGER NOT NULL DEFAULT 0,
    is_postable     INTEGER NOT NULL DEFAULT 1,
    is_active       INTEGER NOT NULL DEFAULT 1,
    CHECK (is_header != is_postable),
    UNIQUE(tenant_id, code)
);

CREATE INDEX IF NOT EXISTS idx_accounts_tenant_type ON accounts(tenant_id, account_type);

CREATE TABLE IF NOT EXISTS fiscal_periods (
    id              TEXT PRIMARY KEY,
    tenant_id       TEXT NOT NULL,
    period_key      TEXT NOT NULL,
    start_date      TEXT NOT NULL,
    end_date        TEXT NOT NULL,
    status          TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed')),
    closed_at       TEXT,
    closed_by_user_id TEXT,
    reopened_at     TEXT,
    reopened_by_user_id TEXT,
    reopen_reason   TEXT,
    UNIQUE(tenant_id, period_key)
);

-- =========================================================================
-- وحدة التقارير المالية وإقفال الفترات — docs/04-modules/financial-reporting.md §2
-- نموذج "الفترات الساخنة والباردة" (Hot/Cold): مصدر الحقيقة Ledger ← اللقطات المجمّدة
-- =========================================================================

-- §2.2 اللقطة المجمّدة (Cold Data): تُنشأ مرة واحدة عند إقفال الفترة ولا تُعدَّل أبدًا بعدها
CREATE TABLE IF NOT EXISTS account_period_balances (
    tenant_id               TEXT NOT NULL,
    fiscal_period_id        TEXT NOT NULL REFERENCES fiscal_periods(id),
    account_code            TEXT NOT NULL,
    opening_balance_base    TEXT NOT NULL DEFAULT '0',  -- نص Decimal لتفادي فقد الدقة (§ تعليمات PRD: لا float)
    period_debit_total_base TEXT NOT NULL DEFAULT '0',
    period_credit_total_base TEXT NOT NULL DEFAULT '0',
    closing_balance_base    TEXT NOT NULL DEFAULT '0',
    created_at              TEXT NOT NULL,
    PRIMARY KEY (fiscal_period_id, account_code)
);
CREATE INDEX IF NOT EXISTS idx_apb_tenant_account ON account_period_balances(tenant_id, account_code);

-- §2.3 الرصيد الحي (Hot Data): سجل واحد لكل حساب يمثّل الفترة المفتوحة دائمًا،
-- يُحدَّث تدريجيًا ضمن نفس المعاملة الذرية لكل قيد (مثل stock_balances/contact_balances)
CREATE TABLE IF NOT EXISTS account_running_balances (
    tenant_id                TEXT NOT NULL,
    account_code             TEXT NOT NULL,
    opening_balance_base     TEXT NOT NULL DEFAULT '0',
    period_debit_total_base  TEXT NOT NULL DEFAULT '0',
    period_credit_total_base TEXT NOT NULL DEFAULT '0',
    current_balance_base     TEXT NOT NULL DEFAULT '0', -- = opening + debit - credit (بإشارة الرصيد الطبيعي)
    updated_at               TEXT NOT NULL,
    PRIMARY KEY (tenant_id, account_code)
);

-- §2.4 إقفال اليوم (مرن — لا يمنع القيود اللاحقة بتاريخ اليوم نفسه، فقط لقطة تسوية وتنبيه فروقات)
CREATE TABLE IF NOT EXISTS daily_closures (
    id                    TEXT PRIMARY KEY,
    tenant_id             TEXT NOT NULL,
    business_date         TEXT NOT NULL,
    cash_expected_balance TEXT NOT NULL DEFAULT '0',
    cash_actual_counted   TEXT,
    cash_variance         TEXT,
    total_revenue_base    TEXT NOT NULL DEFAULT '0',
    total_expenses_base   TEXT NOT NULL DEFAULT '0',
    net_result_base       TEXT NOT NULL DEFAULT '0',
    status                TEXT NOT NULL DEFAULT 'closed' CHECK (status IN ('open','closed')),
    closed_by_user_id     TEXT,
    closed_at             TEXT,
    UNIQUE (tenant_id, business_date)
);

-- §2.5 الجدول التجميعي لنتيجة اليوم: يُحدَّث تدريجيًا (Increment) عند كل معاملة، لا بمسح كامل أبدًا
CREATE TABLE IF NOT EXISTS daily_business_results (
    tenant_id            TEXT NOT NULL,
    business_date        TEXT NOT NULL,
    revenue_total_base   TEXT NOT NULL DEFAULT '0',
    cogs_total_base      TEXT NOT NULL DEFAULT '0',
    gross_profit_base    TEXT NOT NULL DEFAULT '0',   -- محسوب = revenue - cogs
    expenses_total_base  TEXT NOT NULL DEFAULT '0',   -- يشمل حصة المصروفات الموزَّعة المستهلكة
    net_profit_base      TEXT NOT NULL DEFAULT '0',   -- محسوب = gross - expenses
    cash_in_base         TEXT NOT NULL DEFAULT '0',
    cash_out_base        TEXT NOT NULL DEFAULT '0',
    transactions_count   INTEGER NOT NULL DEFAULT 0,
    updated_at           TEXT NOT NULL,
    PRIMARY KEY (tenant_id, business_date)
);

-- §2.6 سجل تعريفات التقارير — قابلية توسع بنفس فلسفة template_registry (§ تعليمات المرحلة 5: تقرير جديد = تعريف مُسجَّل لا تعديل بنية)
CREATE TABLE IF NOT EXISTS report_definitions (
    report_code        TEXT PRIMARY KEY,
    name_ar            TEXT NOT NULL,
    category           TEXT NOT NULL CHECK (category IN ('financial','operational','inventory','ar_ap')),
    description_ar     TEXT,
    data_source_type   TEXT NOT NULL CHECK (data_source_type IN ('hybrid','live_query','materialized')),
    required_permission TEXT,
    supported_filters  TEXT NOT NULL DEFAULT '[]',  -- JSON array كنص
    is_system_report   INTEGER NOT NULL DEFAULT 1,
    is_active          INTEGER NOT NULL DEFAULT 1,  -- Feature Flag: تحكم بإظهار/إخفاء التقرير دون إصدار تحديث
    sort_order         INTEGER NOT NULL DEFAULT 0
);

-- §2.7 سجل تنفيذ التقارير (تدقيق وأداء — رصد التقارير البطيئة)
CREATE TABLE IF NOT EXISTS report_execution_log (
    id                  TEXT PRIMARY KEY,
    tenant_id           TEXT NOT NULL,
    user_id             TEXT,
    report_code         TEXT NOT NULL,
    filters_used        TEXT,
    execution_time_ms   INTEGER,
    exported_format     TEXT,
    executed_at         TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_rel_tenant_report ON report_execution_log(tenant_id, report_code);

CREATE TABLE IF NOT EXISTS journal_entries (
    id                      TEXT PRIMARY KEY,
    tenant_id               TEXT NOT NULL,
    entry_date              TEXT NOT NULL,
    description_simple      TEXT NOT NULL,
    source_type             TEXT NOT NULL,
    source_transaction_id   TEXT,
    reversal_of_entry_id    TEXT,
    is_reversed             INTEGER NOT NULL DEFAULT 0,
    base_currency_code      TEXT NOT NULL,
    created_at              TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_journal_entries_tenant_date ON journal_entries(tenant_id, entry_date);
-- مسار التراجع (reverseTransaction): بحث كل قيود عملية مصدرية واحدة — فهارس أداء إلزامية
CREATE INDEX IF NOT EXISTS idx_journal_entries_source_tx ON journal_entries(tenant_id, source_transaction_id);
CREATE INDEX IF NOT EXISTS idx_journal_entries_reversal_of ON journal_entries(reversal_of_entry_id);

CREATE TABLE IF NOT EXISTS journal_lines (
    id                    TEXT PRIMARY KEY,
    journal_entry_id      TEXT NOT NULL REFERENCES journal_entries(id),
    account_id            TEXT NOT NULL REFERENCES accounts(id),
    contact_id            TEXT,
    side                  TEXT NOT NULL CHECK (side IN ('debit','credit')),
    amount                TEXT NOT NULL,       -- نص لتفادي فقد الدقة (Decimal كنص)
    currency_code         TEXT NOT NULL,
    exchange_rate_used    TEXT NOT NULL,
    base_amount           TEXT NOT NULL,       -- نص أيضًا
    line_order            INTEGER NOT NULL,
    memo_ar               TEXT
);

CREATE INDEX IF NOT EXISTS idx_journal_lines_account ON journal_lines(account_id, journal_entry_id);
CREATE INDEX IF NOT EXISTS idx_journal_lines_entry ON journal_lines(journal_entry_id);

-- ===== وحدة المخزون (مخطط مصغّر لـ SQLite المحلي وفق database/schemas/002_inventory.sql) =====
-- ملاحظة توثيقية مهمة: stock_movements هو دفتر الحركة المرجعي (Append-only)، بينما
-- item_batches.quantity_remaining و stock_balances جداول تجميعية للأداء تُحدَّث ذريًا
-- مع كل حركة ضمن نفس المعاملة (قرار تصميمي موثّق — فصل «الرصيد» عن «الحركة»).

CREATE TABLE IF NOT EXISTS warehouses (
    id          TEXT PRIMARY KEY,
    tenant_id   TEXT NOT NULL,
    code        TEXT NOT NULL,
    name_ar     TEXT NOT NULL,
    is_default  INTEGER NOT NULL DEFAULT 0,
    is_active   INTEGER NOT NULL DEFAULT 1,
    UNIQUE(tenant_id, code)
);

CREATE TABLE IF NOT EXISTS items (
    id                  TEXT PRIMARY KEY,
    tenant_id           TEXT NOT NULL,
    sku                 TEXT,
    name_ar             TEXT NOT NULL,
    item_type           TEXT NOT NULL DEFAULT 'stock'
                        CHECK (item_type IN ('stock', 'service', 'composite')),
    has_expiry_date     INTEGER NOT NULL DEFAULT 0,
    current_avg_cost    TEXT NOT NULL DEFAULT '0',   -- نص لتفادي فقد الدقة (Decimal كنص)
    is_active           INTEGER NOT NULL DEFAULT 1,
    UNIQUE(tenant_id, sku)
);

CREATE TABLE IF NOT EXISTS item_batches (
    id                  TEXT PRIMARY KEY,
    tenant_id           TEXT NOT NULL,
    item_id             TEXT NOT NULL REFERENCES items(id),
    warehouse_id        TEXT NOT NULL REFERENCES warehouses(id),
    batch_number        TEXT NOT NULL,
    expiry_date         TEXT,                        -- YYYY-MM-DD | NULL عند غياب الصلاحية
    unit_cost           TEXT NOT NULL,               -- Decimal كنص
    quantity_received   TEXT NOT NULL,
    quantity_remaining  TEXT NOT NULL,
    created_at          TEXT NOT NULL,
    UNIQUE(tenant_id, item_id, warehouse_id, batch_number)
);

-- فهرس FEFO الحرج: الترتب حسب الصلاحية ثم تاريخ الاستلام داخل نفس المعاملة
CREATE INDEX IF NOT EXISTS idx_batches_fefo
    ON item_batches(tenant_id, item_id, warehouse_id, expiry_date, created_at);

CREATE TABLE IF NOT EXISTS stock_movements (
    id                  TEXT PRIMARY KEY,
    tenant_id           TEXT NOT NULL,
    warehouse_id        TEXT NOT NULL REFERENCES warehouses(id),
    item_id             TEXT NOT NULL REFERENCES items(id),
    batch_id            TEXT REFERENCES item_batches(id),  -- NULL لحركة مجمّعة متعددة الدفعات
    movement_type       TEXT NOT NULL CHECK (
        movement_type IN ('purchase_in', 'sale_out', 'return_in', 'return_out',
                          'transfer_in', 'transfer_out', 'damage_out', 'opening_balance',
                          'inventory_count_adj_in', 'inventory_count_adj_out')
    ),
    quantity            TEXT NOT NULL,   -- موجبة دائمًا؛ الاتجاه ضمن movement_type
    unit_cost           TEXT NOT NULL,   -- المتوسط الفعلي المستهلك لهذه الحركة
    total_cost          TEXT NOT NULL,
    movement_date       TEXT NOT NULL,
    journal_entry_id    TEXT,            -- الربط المحاسبي الإلزامي للحركات ذات الأثر المالي
    source_reference    TEXT,            -- sourceTransactionId من محرك القوالب
    created_at          TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_stock_movements_item
    ON stock_movements(tenant_id, item_id, movement_date);
CREATE INDEX IF NOT EXISTS idx_stock_movements_source
    ON stock_movements(tenant_id, source_reference);

CREATE TABLE IF NOT EXISTS stock_movement_cost_layers (
    id                      TEXT PRIMARY KEY,
    tenant_id               TEXT NOT NULL,
    stock_movement_id       TEXT NOT NULL REFERENCES stock_movements(id),
    consumed_batch_id       TEXT NOT NULL REFERENCES item_batches(id),
    qty_consumed            TEXT NOT NULL,
    unit_cost_at_consumption TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_cost_layers_movement
    ON stock_movement_cost_layers(stock_movement_id);

CREATE TABLE IF NOT EXISTS stock_balances (
    tenant_id           TEXT NOT NULL,
    warehouse_id        TEXT NOT NULL REFERENCES warehouses(id),
    item_id             TEXT NOT NULL REFERENCES items(id),
    current_quantity    TEXT NOT NULL DEFAULT '0',
    total_cost_value    TEXT NOT NULL DEFAULT '0',
    updated_at          TEXT NOT NULL,
    PRIMARY KEY (tenant_id, warehouse_id, item_id)
);

-- ===== وحدة جهات الاتصال (Contacts: العملاء / الموردون / الموظفون) =====
CREATE TABLE IF NOT EXISTS contacts (
    id                  TEXT PRIMARY KEY,
    tenant_id           TEXT NOT NULL,
    contact_type        TEXT NOT NULL CHECK (contact_type IN ('customer', 'supplier', 'employee', 'other')),
    full_name           TEXT NOT NULL,
    phone               TEXT,
    address             TEXT,
    tax_number          TEXT,
    credit_limit        TEXT NOT NULL DEFAULT '0',
    is_credit_hold      INTEGER NOT NULL DEFAULT 0,
    notes               TEXT,
    is_active           INTEGER NOT NULL DEFAULT 1,
    created_at          TEXT NOT NULL,
    updated_at          TEXT NOT NULL,
    UNIQUE(tenant_id, phone, contact_type)
);

CREATE INDEX IF NOT EXISTS idx_contacts_tenant_type ON contacts(tenant_id, contact_type);
CREATE INDEX IF NOT EXISTS idx_contacts_tenant_phone ON contacts(tenant_id, phone);

-- ===== وحدة الذمم الفرعية (AR/AP Sub-Ledger) — وفق database/schemas/003_ar_ap_subledger.sql =====
-- نمط "الفاتورة المفتوحة" (Open Item Accounting): كل بيع/شراء آجل يُنشئ بندًا مفتوحًا،
-- وكل تحصيل يُخصَّص لبند محدد (FIFO افتراضيًا). الأرقام كنص Decimal كبقية المخطط المحلي.
-- انحراف موثّق عن مخطط 003 الخادمي: لا UUID/TIMESTAMPTZ في SQLite المحلي — TEXT بدلها،
-- وحذف FK إلى transactions (جدول المعاملات نفسه غير موجود في المخطط المحلي؛ العملية تُشار
-- بـ source_transaction_id كما في journal_entries)، مع الإبقاء على جوهر القيود والفهارس.

CREATE TABLE IF NOT EXISTS ar_ap_open_items (
    id                      TEXT PRIMARY KEY,
    tenant_id               TEXT NOT NULL,
    contact_id              TEXT NOT NULL,
    subledger_type          TEXT NOT NULL CHECK (subledger_type IN ('AR', 'AP')),
    source_transaction_id   TEXT NOT NULL,
    journal_entry_id        TEXT NOT NULL REFERENCES journal_entries(id),
    invoice_date            TEXT NOT NULL,                -- YYYY-MM-DD (أساس حساب العمر)
    due_date                TEXT,                         -- NULL = يُستخدم invoice_date في الأعمار
    original_amount         TEXT NOT NULL,                -- Decimal كنص، > 0 بعملة الفاتورة
    remaining_amount        TEXT NOT NULL CHECK (remaining_amount >= 0),
    currency_code           TEXT NOT NULL,
    exchange_rate           TEXT NOT NULL DEFAULT '1',    -- مثبّت وقت الإنشاء → الأساس
    base_remaining_amount   TEXT NOT NULL,
    status                  TEXT NOT NULL DEFAULT 'open'
                            CHECK (status IN ('open', 'partially_paid', 'settled', 'written_off')),
    -- بند الفائض (القسم 3.3): رصيد دائن للطرف نشأ من دفعة زائدة — يُستهلك في أول تسوية لاحقة
    -- ويتصدر طابور FIFO بتاريخه؛ لا يحتاج حماية من استهلاك مزدوج لأن قيد الفائض لم يسدد شيئًا.
    is_overpayment          INTEGER NOT NULL DEFAULT 0,
    write_off_reason        TEXT,
    created_at              TEXT NOT NULL,
    updated_at              TEXT NOT NULL
);

-- قيد ذرّي (Trigger): المتبقي لا يتجاوز الأصلي أبدًا (القسم 8 من التصميم — حوكمة آلية).
-- مقارنة رقمية حقيقية (CAST REAL): المقارنة النصية lexically خاطئة ("999" > "1000" نصيًا!).
-- SQLite يقبل TEXT في عمود رقمي بصرامة CHECK ضعيفة، لذا هذا الحارس هو خط الدفاع الأخير.
CREATE TRIGGER IF NOT EXISTS trg_open_items_amount_bound
BEFORE UPDATE OF remaining_amount ON ar_ap_open_items
FOR EACH ROW WHEN CAST(NEW.remaining_amount AS REAL) > CAST(OLD.original_amount AS REAL) + 1e-9
BEGIN
    SELECT RAISE(ABORT, 'ar_ap_open_items: المتبقي لا يمكن أن يتجاوز المبلغ الأصلي');
END;

-- حارس مكافئ عند الإدراج (INSERT): لا يُقبل متبقٍ أكبر من الأصلي منذ لحظة الإنشاء
CREATE TRIGGER IF NOT EXISTS trg_open_items_amount_bound_insert
BEFORE INSERT ON ar_ap_open_items
FOR EACH ROW WHEN CAST(NEW.remaining_amount AS REAL) > CAST(NEW.original_amount AS REAL) + 1e-9
BEGIN
    SELECT RAISE(ABORT, 'ar_ap_open_items: المتبقي لا يمكن أن يتجاوز المبلغ الأصلي');
END;

CREATE INDEX IF NOT EXISTS idx_open_items_contact ON ar_ap_open_items(tenant_id, contact_id, status);
CREATE INDEX IF NOT EXISTS idx_open_items_aging   ON ar_ap_open_items(tenant_id, subledger_type, due_date, invoice_date);
CREATE INDEX IF NOT EXISTS idx_open_items_source  ON ar_ap_open_items(tenant_id, source_transaction_id);

CREATE TABLE IF NOT EXISTS ar_ap_allocations (
    id                          TEXT PRIMARY KEY,
    tenant_id                   TEXT NOT NULL,
    open_item_id                TEXT NOT NULL REFERENCES ar_ap_open_items(id),
    settlement_transaction_id   TEXT NOT NULL,
    allocated_amount            TEXT NOT NULL CHECK (allocated_amount > 0),
    allocated_amount_base       TEXT NOT NULL,
    fx_gain_loss_amount         TEXT NOT NULL DEFAULT '0',
    allocation_date             TEXT NOT NULL,
    created_at                  TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_allocations_open_item    ON ar_ap_allocations(open_item_id);
CREATE INDEX IF NOT EXISTS idx_allocations_settlement   ON ar_ap_allocations(tenant_id, settlement_transaction_id);
