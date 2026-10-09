// src/common/load-templates.ts
// ===== مشغّل مكتبة القوالب المعيارية (@platform/templates) =====
// يحمّل كل ملفات JSON من حزم القوالب ويحوّلها إلى TemplateDefinition متوافق مع المحرك.

import * as fs from 'fs';
import * as path from 'path';
import type { TemplateDefinition } from '@platform/core-accounting';

/** تحويل قالب JSON (بصيغة مخزن القرص) إلى TemplateDefinition (بصيغة المحرك) */
export function normalizeTemplate(raw: Record<string, any>): TemplateDefinition {
  return {
    template_code: raw.template_code ?? raw.code,
    template_version: raw.template_version ?? raw.version ?? 1,
    scope: raw.scope ?? ['core'],
    category: raw.category,
    ui: {
      button_group_ar: raw.ui?.button_group_ar ?? null,
      display_name_ar: raw.ui?.display_name_ar ?? raw.display_name_ar ?? raw.template_code,
      description_ar: raw.ui?.description_ar ?? raw.description_ar ?? '',
      icon: raw.ui?.icon ?? 'circle',
      sort_order: raw.ui?.sort_order ?? raw.sort_order ?? 999,
    },
    payment_mode: raw.payment_mode ?? null,
    requires_contact: raw.requires_contact,
    inventory_effect: raw.inventory_effect ?? 'none',
    allow_quick_mode: raw.allow_quick_mode ?? false,
    allow_distribution: raw.allow_distribution ?? false,
    one_time_only: raw.one_time_only ?? false,
    fields: raw.fields ?? [],
    journal_rules: (raw.journal_rules ?? []).map((r: any) => ({
      account_code_ref: r.account_code_ref,
      side: r.side,
      amount_formula: r.amount_formula,
      currency_ref: r.currency_ref,
      contact_ref: r.contact_ref ?? null,
      condition: r.condition ?? null,
      memo_ar: r.memo_ar ?? null,
      repeat_for: r.repeat_for ?? null,
      rounding_anchor_field: r.rounding_anchor_field ?? null,
    })),
    secondary_journal_rules: raw.secondary_journal_rules ?? null,
    post_actions: raw.post_actions ?? [],
    golden_test_cases: raw.golden_test_cases ?? undefined,
  };
}

/** تحميل جميع القوالب من مجلدات حزمة @platform/templates */
export function loadBundledTemplates(): TemplateDefinition[] {
  const pkgJson = require.resolve('@platform/templates/package.json');
  const templatesRoot = path.dirname(pkgJson);
  const categories = fs
    .readdirSync(templatesRoot, { withFileTypes: true })
    .filter((d) => d.isDirectory() && d.name !== 'schema')
    .map((d) => d.name);

  const defs: TemplateDefinition[] = [];
  for (const cat of categories) {
    const dir = path.join(templatesRoot, cat);
    for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.json'))) {
      const raw = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf-8'));
      // تجاوز أي ملف لا يطابق عقد القالب (حماية من ملفات الميتا داخل المجلدات)
      if (!raw || typeof raw.template_code !== 'string' || !Array.isArray(raw.journal_rules)) {
        continue;
      }
      defs.push(normalizeTemplate(raw));
    }
  }
  if (defs.length === 0) {
    throw new Error('لم يُعثر على أي قالب معياري — تحقّق من حزمة @platform/templates');
  }
  return defs;
}
