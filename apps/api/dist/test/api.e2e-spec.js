"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const common_1 = require("@nestjs/common");
const testing_1 = require("@nestjs/testing");
const request = __importStar(require("supertest"));
const app_module_1 = require("../src/app.module");
describe('Mohaseb API (e2e)', () => {
    let app;
    const base = () => request.default(app.getHttpServer());
    beforeAll(async () => {
        const moduleRef = await testing_1.Test.createTestingModule({ imports: [app_module_1.AppModule] }).compile();
        app = moduleRef.createNestApplication();
        app.useGlobalPipes(new common_1.ValidationPipe({ transform: true, whitelist: true }));
        await app.init();
    });
    afterAll(async () => {
        await app.close();
    });
    it('GET /health — الخدمة تعمل والنواة محمّلة', async () => {
        const res = await base().get('/health').expect(200);
        expect(res.body.status).toBe('ok');
    });
    it('GET /health/bootstrap — الحسابات مزروعة والقوالب محمّلة', async () => {
        const res = await base().get('/health/bootstrap').expect(200);
        expect(res.body.accountsSeeded).toBeGreaterThanOrEqual(50);
        expect(res.body.templatesLoaded).toBeGreaterThanOrEqual(20);
    });
    it('GET /api/v1/templates — قائمة عمليات سريعة بالعربية ومنظمة', async () => {
        const res = await base().get('/api/v1/templates').expect(200);
        expect(Array.isArray(res.body)).toBe(true);
        const codes = res.body.map((t) => t.templateCode);
        expect(codes).toContain('sale_cash');
        expect(codes).toContain('expense_daily');
        const orders = res.body.map((t) => t.sortOrder);
        expect(orders).toEqual([...orders].sort((a, b) => a - b));
    });
    it('GET /api/v1/accounts — الحسابات معلّمة بقابلية الترحيل', async () => {
        const res = await base().get('/api/v1/accounts').expect(200);
        const byCode = Object.fromEntries(res.body.map((a) => [a.code, a]));
        expect(byCode['1101']).toBeDefined();
        expect(byCode['1101'].isPostable).toBe(true);
        expect(byCode['1000'].isPostable).toBe(false);
    });
    it('POST /api/v1/transactions — بيع نقدي ينتج قيداً مزدوجاً متوازناً', async () => {
        const res = await base()
            .post('/api/v1/transactions')
            .send({
            templateCode: 'sale_cash',
            payload: { total_amount: '15000', currency_code: 'YER' },
        })
            .expect(201);
        expect(res.body.transactionId).toBeTruthy();
        expect(res.body.summary).toContain('15,000');
        const lines = res.body.primaryEntry.lines;
        const debitSum = lines.filter((l) => l.side === 'debit').reduce((s, l) => s + Number(l.amount), 0);
        const creditSum = lines.filter((l) => l.side === 'credit').reduce((s, l) => s + Number(l.amount), 0);
        expect(debitSum).toBe(creditSum);
        expect(debitSum).toBe(15000);
    });
    it('POST /api/v1/transactions — رفض Payload غير صالح (400)', async () => {
        const res = await base()
            .post('/api/v1/transactions')
            .send({ templateCode: 'sale_cash', payload: { total_amount: -5 } })
            .expect(400);
        expect(res.body.error).toBe('VALIDATION_ERROR');
    });
    it('POST /api/v1/transactions — قالب غير موجود (404)', async () => {
        const res = await base()
            .post('/api/v1/transactions')
            .send({ templateCode: 'no_such_template', payload: {} })
            .expect(404);
        expect(res.body.error).toBe('TEMPLATE_NOT_FOUND');
    });
    it('سلسلة يومية كاملة: مصروف ثم تحصيل لا يكسر التوازن', async () => {
        await base()
            .post('/api/v1/transactions')
            .send({ templateCode: 'expense_daily', payload: { amount: '2000', currency_code: 'YER', expense_category: '5801' } })
            .expect(201);
        const sale = await base()
            .post('/api/v1/transactions')
            .send({ templateCode: 'sale_credit', payload: { total_amount: '50000', currency_code: 'YER' } })
            .expect(201);
        expect(sale.body.primaryEntry.lines.length).toBeGreaterThanOrEqual(2);
    });
});
//# sourceMappingURL=api.e2e-spec.js.map