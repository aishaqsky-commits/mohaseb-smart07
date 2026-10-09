"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizeTemplate = normalizeTemplate;
exports.loadBundledTemplates = loadBundledTemplates;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
function normalizeTemplate(raw) {
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
        journal_rules: (raw.journal_rules ?? []).map((r) => ({
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
function loadBundledTemplates() {
    const pkgJson = require.resolve('@platform/templates/package.json');
    const templatesRoot = path.dirname(pkgJson);
    const categories = fs
        .readdirSync(templatesRoot, { withFileTypes: true })
        .filter((d) => d.isDirectory() && d.name !== 'schema')
        .map((d) => d.name);
    const defs = [];
    for (const cat of categories) {
        const dir = path.join(templatesRoot, cat);
        for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.json'))) {
            const raw = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf-8'));
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
//# sourceMappingURL=load-templates.js.map