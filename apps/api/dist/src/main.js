"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
require("reflect-metadata");
const core_1 = require("@nestjs/core");
const common_1 = require("@nestjs/common");
const app_module_1 = require("./app.module");
async function bootstrap() {
    const app = await core_1.NestFactory.create(app_module_1.AppModule, { logger: ['error', 'warn', 'log'] });
    app.useGlobalPipes(new common_1.ValidationPipe({ transform: true, whitelist: true }));
    app.enableShutdownHooks();
    const port = Number(process.env.PORT ?? 3000);
    await app.listen(port);
    console.log(`🚀 Mohaseb API listening on http://localhost:${port} (scope=${process.env.BUSINESS_SCOPE ?? 'retail'})`);
}
void bootstrap();
//# sourceMappingURL=main.js.map