export type TokenType = "NUMBER" | "STRING" | "IDENT" | "BOOL" | "NULL" | "DOT" | "COMMA" | "LPAREN" | "RPAREN" | "LBRACKET" | "RBRACKET" | "OP" | "EOF";
export interface Token {
    type: TokenType;
    value: string;
    position: number;
}
/**
 * محوّل سلسلة الصيغة النصية إلى قائمة Tokens.
 * لا يدعم أي بنية غير معرَّفة صراحة هنا - أي محرف غريب يُسبب خطأ فوري، لا تجاهل صامت.
 */
export declare class Lexer {
    private readonly source;
    private pos;
    private readonly tokens;
    constructor(source: string);
    tokenize(): Token[];
    private tryMultiCharOperator;
    private readNumber;
    private readString;
    private readIdentifier;
    private skipWhitespace;
    private push;
}
