import { TemplateDefinition } from "../types/TemplateDefinition";
export declare class TemplateValidationError extends Error {
    readonly fieldErrors: Array<{
        key: string;
        message: string;
    }>;
    constructor(fieldErrors: Array<{
        key: string;
        message: string;
    }>);
}
export declare class TemplateValidator {
    validate(template: TemplateDefinition, payload: Record<string, unknown>): void;
    /**
     * تنفيذ التحقق مع تسامح خاص لصيغ "sum(...percentage) == N" لتفادي هوامش IEEE-754
     * في مجموع النسب العشرية المولّدة من واجهة المستخدم.
     */
    private isValid;
    private isHiddenByVisibility;
}
