"use strict";
// src/templates/engine/Lexer.ts
Object.defineProperty(exports, "__esModule", { value: true });
exports.Lexer = void 0;
const errors_1 = require("./errors");
const MULTI_CHAR_OPERATORS = ["==", "!=", "<=", ">=", "&&", "||"];
const SINGLE_CHAR_OPERATORS = ["<", ">", "+", "-", "*", "/", "!"];
/**
 * محوّل سلسلة الصيغة النصية إلى قائمة Tokens.
 * لا يدعم أي بنية غير معرَّفة صراحة هنا - أي محرف غريب يُسبب خطأ فوري، لا تجاهل صامت.
 */
class Lexer {
    source;
    pos = 0;
    tokens = [];
    constructor(source) {
        this.source = source;
    }
    tokenize() {
        while (this.pos < this.source.length) {
            this.skipWhitespace();
            if (this.pos >= this.source.length)
                break;
            const char = this.source[this.pos];
            if (this.tryMultiCharOperator())
                continue;
            if (/[0-9]/.test(char)) {
                this.readNumber();
                continue;
            }
            if (char === "'" || char === '"') {
                this.readString(char);
                continue;
            }
            if (/[a-zA-Z_\u0600-\u06FF]/.test(char)) {
                this.readIdentifier();
                continue;
            }
            if (char === ".") {
                this.push("DOT", ".");
                this.pos++;
                continue;
            }
            if (char === ",") {
                this.push("COMMA", ",");
                this.pos++;
                continue;
            }
            if (char === "(") {
                this.push("LPAREN", "(");
                this.pos++;
                continue;
            }
            if (char === ")") {
                this.push("RPAREN", ")");
                this.pos++;
                continue;
            }
            if (char === "[") {
                this.push("LBRACKET", "[");
                this.pos++;
                continue;
            }
            if (char === "]") {
                this.push("RBRACKET", "]");
                this.pos++;
                continue;
            }
            if (SINGLE_CHAR_OPERATORS.includes(char)) {
                this.push("OP", char);
                this.pos++;
                continue;
            }
            throw new errors_1.ExpressionSyntaxError(`محرف غير متوقع "${char}"`, this.pos);
        }
        this.push("EOF", "");
        return this.tokens;
    }
    tryMultiCharOperator() {
        const two = this.source.slice(this.pos, this.pos + 2);
        if (MULTI_CHAR_OPERATORS.includes(two)) {
            this.push("OP", two);
            this.pos += 2;
            return true;
        }
        return false;
    }
    readNumber() {
        const start = this.pos;
        while (this.pos < this.source.length && /[0-9.]/.test(this.source[this.pos])) {
            this.pos++;
        }
        this.push("NUMBER", this.source.slice(start, this.pos));
    }
    readString(quote) {
        this.pos++; // تجاوز علامة الاقتباس الفاتحة
        const start = this.pos;
        while (this.pos < this.source.length && this.source[this.pos] !== quote) {
            this.pos++;
        }
        if (this.pos >= this.source.length) {
            throw new errors_1.ExpressionSyntaxError("نص غير مُغلَق بعلامة اقتباس", start);
        }
        const value = this.source.slice(start, this.pos);
        this.pos++; // تجاوز علامة الإغلاق
        this.push("STRING", value);
    }
    readIdentifier() {
        const start = this.pos;
        while (this.pos < this.source.length &&
            /[a-zA-Z0-9_\u0600-\u06FF]/.test(this.source[this.pos])) {
            this.pos++;
        }
        const value = this.source.slice(start, this.pos);
        if (value === "true" || value === "false") {
            this.push("BOOL", value);
        }
        else if (value === "null") {
            this.push("NULL", value);
        }
        else {
            this.push("IDENT", value);
        }
    }
    skipWhitespace() {
        while (this.pos < this.source.length && /\s/.test(this.source[this.pos])) {
            this.pos++;
        }
    }
    push(type, value) {
        this.tokens.push({ type, value, position: this.pos });
    }
}
exports.Lexer = Lexer;
//# sourceMappingURL=Lexer.js.map