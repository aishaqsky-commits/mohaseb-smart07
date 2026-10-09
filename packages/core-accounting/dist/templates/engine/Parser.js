"use strict";
// src/templates/engine/Parser.ts
Object.defineProperty(exports, "__esModule", { value: true });
exports.Parser = void 0;
const Lexer_1 = require("./Lexer");
const errors_1 = require("./errors");
/**
 * محلِّل تنازلي تكراري (Recursive Descent Parser) بترتيب أولوية ثابت:
 * || ثم && ثم == != ثم < > <= >= ثم + - ثم * / ثم unary ثم primary
 */
class Parser {
    tokens;
    pos = 0;
    constructor(source) {
        this.tokens = new Lexer_1.Lexer(source).tokenize();
    }
    static parse(source) {
        const parser = new Parser(source);
        const node = parser.parseExpression();
        parser.expect("EOF");
        return node;
    }
    current() { return this.tokens[this.pos]; }
    expect(type) {
        const tok = this.current();
        if (tok.type !== type) {
            throw new errors_1.ExpressionSyntaxError(`متوقَّع ${type} لكن وُجد ${tok.type} ("${tok.value}")`, tok.position);
        }
        this.pos++;
        return tok;
    }
    matchOp(...ops) {
        const tok = this.current();
        if (tok.type === "OP" && ops.includes(tok.value)) {
            this.pos++;
            return true;
        }
        return false;
    }
    lastConsumedOp() {
        return this.tokens[this.pos - 1].value;
    }
    parseExpression() { return this.parseLogicalOr(); }
    parseLogicalOr() {
        let left = this.parseLogicalAnd();
        while (this.matchOp("||")) {
            const op = this.lastConsumedOp();
            left = { type: "Binary", op, left, right: this.parseLogicalAnd() };
        }
        return left;
    }
    parseLogicalAnd() {
        let left = this.parseEquality();
        while (this.matchOp("&&")) {
            const op = this.lastConsumedOp();
            left = { type: "Binary", op, left, right: this.parseEquality() };
        }
        return left;
    }
    parseEquality() {
        let left = this.parseComparison();
        while (this.matchOp("==", "!=")) {
            const op = this.lastConsumedOp();
            left = { type: "Binary", op, left, right: this.parseComparison() };
        }
        return left;
    }
    parseComparison() {
        let left = this.parseAdditive();
        while (this.matchOp("<", ">", "<=", ">=")) {
            const op = this.lastConsumedOp();
            left = { type: "Binary", op, left, right: this.parseAdditive() };
        }
        return left;
    }
    parseAdditive() {
        let left = this.parseMultiplicative();
        while (this.matchOp("+", "-")) {
            const op = this.lastConsumedOp();
            left = { type: "Binary", op, left, right: this.parseMultiplicative() };
        }
        return left;
    }
    parseMultiplicative() {
        let left = this.parseUnary();
        while (this.matchOp("*", "/")) {
            const op = this.lastConsumedOp();
            left = { type: "Binary", op, left, right: this.parseUnary() };
        }
        return left;
    }
    parseUnary() {
        if (this.matchOp("!", "-")) {
            const op = this.lastConsumedOp();
            return { type: "Unary", op, operand: this.parseUnary() };
        }
        return this.parsePrimary();
    }
    parsePrimary() {
        const tok = this.current();
        if (tok.type === "NUMBER") {
            this.pos++;
            return { type: "Number", value: tok.value };
        }
        if (tok.type === "STRING") {
            this.pos++;
            return { type: "String", value: tok.value };
        }
        if (tok.type === "BOOL") {
            this.pos++;
            return { type: "Bool", value: tok.value === "true" };
        }
        if (tok.type === "NULL") {
            this.pos++;
            return { type: "Null" };
        }
        if (tok.type === "LPAREN") {
            this.pos++;
            const expr = this.parseExpression();
            this.expect("RPAREN");
            return expr;
        }
        if (tok.type === "IDENT") {
            const name = tok.value;
            this.pos++;
            // نداء دالة: identifier مباشرة متبوع بقوس فتح
            if (this.current().type === "LPAREN") {
                this.pos++;
                const args = [];
                if (this.current().type !== "RPAREN") {
                    args.push(this.parseExpression());
                    while (this.current().type === "COMMA") {
                        this.pos++;
                        args.push(this.parseExpression());
                    }
                }
                this.expect("RPAREN");
                return { type: "Call", name, args };
            }
            // مسار (Path): identifier متبوع اختياريًا بسلسلة .prop أو [index]
            const segments = [{ kind: "prop", name }];
            this.parsePathSuffixes(segments);
            return { type: "Path", segments };
        }
        throw new errors_1.ExpressionSyntaxError(`رمز غير متوقَّع "${tok.value}"`, tok.position);
    }
    parsePathSuffixes(segments) {
        while (true) {
            if (this.current().type === "DOT") {
                this.pos++;
                const propTok = this.expect("IDENT");
                segments.push({ kind: "prop", name: propTok.value });
                continue;
            }
            if (this.current().type === "LBRACKET") {
                this.pos++;
                const inner = this.current();
                if (inner.type === "RBRACKET") {
                    segments.push({ kind: "collect" });
                    this.pos++;
                }
                else if (inner.type === "NUMBER") {
                    segments.push({ kind: "index", value: Number(inner.value) });
                    this.pos++;
                    this.expect("RBRACKET");
                }
                else if (inner.type === "IDENT" && inner.value === "i") {
                    segments.push({ kind: "indexVar" });
                    this.pos++;
                    this.expect("RBRACKET");
                }
                else {
                    throw new errors_1.ExpressionSyntaxError(`محتوى غير صالح داخل []: "${inner.value}"`, inner.position);
                }
                continue;
            }
            break;
        }
    }
}
exports.Parser = Parser;
//# sourceMappingURL=Parser.js.map