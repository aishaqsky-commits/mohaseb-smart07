export type PathSegment = {
    kind: "prop";
    name: string;
} | {
    kind: "index";
    value: number;
} | {
    kind: "indexVar";
} | {
    kind: "collect";
};
export type AstNode = {
    type: "Number";
    value: string;
} | {
    type: "String";
    value: string;
} | {
    type: "Bool";
    value: boolean;
} | {
    type: "Null";
} | {
    type: "Path";
    segments: PathSegment[];
} | {
    type: "Call";
    name: string;
    args: AstNode[];
} | {
    type: "Unary";
    op: "!" | "-";
    operand: AstNode;
} | {
    type: "Binary";
    op: string;
    left: AstNode;
    right: AstNode;
};
/**
 * محلِّل تنازلي تكراري (Recursive Descent Parser) بترتيب أولوية ثابت:
 * || ثم && ثم == != ثم < > <= >= ثم + - ثم * / ثم unary ثم primary
 */
export declare class Parser {
    private tokens;
    private pos;
    constructor(source: string);
    static parse(source: string): AstNode;
    private current;
    private expect;
    private matchOp;
    private lastConsumedOp;
    parseExpression(): AstNode;
    private parseLogicalOr;
    private parseLogicalAnd;
    private parseEquality;
    private parseComparison;
    private parseAdditive;
    private parseMultiplicative;
    private parseUnary;
    private parsePrimary;
    private parsePathSuffixes;
}
