import { TemplateExecutionEngine, ExecuteTemplateResult } from "../../templates/TemplateExecutionEngine";
import { TenantContextProvider } from "../ports/TenantContextProvider";
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
export declare class RecordTransactionService {
    private readonly templateEngine;
    private readonly tenantContextProvider;
    constructor(templateEngine: TemplateExecutionEngine, tenantContextProvider: TenantContextProvider);
    execute(command: RecordTransactionCommand): Promise<ExecuteTemplateResult>;
}
