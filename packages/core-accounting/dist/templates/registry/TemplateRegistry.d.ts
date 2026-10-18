import { TemplateDefinition } from "../types/TemplateDefinition";
export declare class TemplateNotFoundError extends Error {
    constructor(code: string);
}
export declare class TemplateRegistry {
    private readonly templates;
    register(definition: TemplateDefinition): void;
    registerMany(definitions: TemplateDefinition[]): void;
    resolve(code: string): TemplateDefinition;
    listByScope(scope: string): TemplateDefinition[];
    /**
     * تحقق بنيوي أساسي. في بيئة CI/CD الفعلية يُستبدَل/يُكمَّل بتحقق AJV
     * الكامل مقابل JSON Meta-Schema المصمَّم في مرحلة تصميم القوالب.
     */
    private assertStructuralValidity;
}
