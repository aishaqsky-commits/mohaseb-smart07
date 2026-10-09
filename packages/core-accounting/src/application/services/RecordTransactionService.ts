// src/application/services/RecordTransactionService.ts

import { TemplateExecutionEngine, ExecuteTemplateResult } from "../../templates/TemplateExecutionEngine";
import { TenantContextProvider } from "../ports/TenantContextProvider";
import { MissingTenantContextError } from "../errors/ApplicationErrors";

export interface RecordTransactionCommand {
  templateCode: string;
  payload: Record<string, unknown>;
  warehouseId?: string | undefined;
}

/**
 * حالة الاستخدام المركزية في النظام بأكمله: "سجّل عملية".
 * أي زر يضغطه التاجر (بعت، اشتريت، مصروف...) يمر من هنا حصريًا:
 * سياق المستأجر ← محرك القوالب ← محرك القيود ← المستودع الذري.
 * لا يُسمح لأي طبقة عرض أو API بتكوين قيود يدويًا — نقطة تحكم واحدة للتدقيق.
 */
export class RecordTransactionService {
  constructor(
    private readonly templateEngine: TemplateExecutionEngine,
    private readonly tenantContextProvider: TenantContextProvider
  ) {}

  async execute(command: RecordTransactionCommand): Promise<ExecuteTemplateResult> {
    const ctx = await this.tenantContextProvider.getCurrentContext();
    if (!ctx?.tenantId) throw new MissingTenantContextError();

    return this.templateEngine.execute({
      templateCode: command.templateCode,
      tenantId: ctx.tenantId,
      baseCurrencyCode: ctx.baseCurrencyCode,
      payload: command.payload,
      ...(command.warehouseId !== undefined ? { warehouseId: command.warehouseId } : {}),
    });
  }
}
