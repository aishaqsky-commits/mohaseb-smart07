export type FieldType = "amount" | "date" | "number" | "text" | "contact_picker" | "item_picker" | "distribution_table" | "select" | "currency_picker" | "toggle";
export interface FieldOption {
    value: string;
    label_ar: string;
}
export interface FieldDefinition {
    key: string;
    type: FieldType;
    label_ar: string;
    required: boolean;
    default?: unknown;
    options?: Array<string | FieldOption>;
    options_source?: string | null;
    visible_when?: string | null;
    validation?: string | null;
}
export interface JournalLineRule {
    account_code_ref: string;
    side: "debit" | "credit";
    amount_formula: string;
    currency_ref?: string;
    contact_ref?: string | null;
    condition?: string | null;
    memo_ar?: string | null;
    repeat_for?: string | null;
    rounding_anchor_field?: string | null;
}
export interface TemplateUi {
    button_group_ar: string | null;
    display_name_ar: string;
    description_ar: string;
    icon: string;
    sort_order: number;
}
export type TemplateCategory = "purchases" | "sales" | "returns" | "settlements" | "damage" | "opening_balance" | "expenses" | "owner" | "services";
export interface TemplateDefinition {
    template_code: string;
    template_version: number;
    scope: string[];
    category: TemplateCategory;
    ui: TemplateUi;
    payment_mode?: "cash" | "credit" | "partial" | null;
    requires_contact?: {
        required: boolean;
        type?: string | null;
        allow_quick_add?: boolean;
    };
    inventory_effect?: "none" | "increase" | "decrease";
    allow_quick_mode?: boolean;
    allow_distribution?: boolean;
    one_time_only?: boolean;
    fields: FieldDefinition[];
    journal_rules: JournalLineRule[];
    secondary_journal_rules?: JournalLineRule[] | null;
    post_actions?: string[];
    golden_test_cases?: Array<{
        payload: Record<string, unknown>;
        expected_balanced: boolean;
        expected_debit_total?: number;
        expected_credit_total?: number;
    }>;
}
