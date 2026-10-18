export declare class ExpressionSyntaxError extends Error {
    constructor(message: string, position: number);
}
export declare class ExpressionEvaluationError extends Error {
    constructor(message: string);
}
export declare class UnknownFunctionError extends ExpressionEvaluationError {
    constructor(name: string);
}
