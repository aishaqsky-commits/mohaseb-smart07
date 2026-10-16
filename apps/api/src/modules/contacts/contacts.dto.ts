// src/modules/contacts/contacts.dto.ts
import { z } from 'zod';

export const ContactTypeEnum = z.enum(['customer', 'supplier', 'employee', 'other']);
export type ContactType = z.infer<typeof ContactTypeEnum>;

export const CreateContactDtoSchema = z.object({
  contact_type: ContactTypeEnum,
  full_name: z.string().min(1, 'الاسم الكامل مطلوب').max(150),
  phone: z.string().max(30).optional(),
  address: z.string().max(255).optional(),
  tax_number: z.string().max(50).optional(),
  credit_limit: z.union([z.string(), z.number()]).optional().default('0'),
  notes: z.string().optional(),
});

export type CreateContactDto = z.infer<typeof CreateContactDtoSchema>;

export interface ContactRow {
  id: string;
  tenant_id: string;
  contact_type: ContactType;
  full_name: string;
  phone: string | null;
  address: string | null;
  tax_number: string | null;
  credit_limit: string;
  is_credit_hold: number;
  notes: string | null;
  is_active: number;
  created_at: string;
  updated_at: string;
  /** الرصيد القائم الحالي المحسوب من دفتر الذمم الفرعية (AR/AP) */
  current_balance: string;
}
