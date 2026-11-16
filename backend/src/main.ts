import "dotenv/config";
import { createWriteStream, mkdirSync } from "node:fs";
import { join } from "node:path";

/** Also save everything printed to backend/logs/backend.log (handy for troubleshooting). */
function logToFile() {
  try {
    const dir = join(__dirname, "..", "logs");
    mkdirSync(dir, { recursive: true });
    const file = createWriteStream(join(dir, "backend.log"), { flags: "a" });
    file.write(`\n===== start ${new Date().toISOString()} =====\n`);
    const strip = (c: unknown) => String(c).replace(/\x1b\[[0-9;]*m/g, "");
    for (const stream of [process.stdout, process.stderr]) {
      const write = stream.write.bind(stream) as (...a: unknown[]) => boolean;
      stream.write = ((chunk: unknown, ...rest: unknown[]) => { file.write(strip(chunk)); return write(chunk, ...rest); }) as typeof stream.write;
    }
    process.on("uncaughtException", (e) => { file.write(`uncaughtException: ${e?.stack ?? e}\n`); });
  } catch { /* logging must never stop the API */ }
}
logToFile();
import "reflect-metadata";
import { Logger } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import type { NextFunction, Request, Response } from "express";
import { AppModule } from "./app.module";
import { env } from "./config/env";

/**
 * The web app calls /api/v1/…; the mobile app (and older builds) call /api/…
 * Map the old paths so both work against this server.
 */
const LEGACY: [RegExp, string][] = [
  [/^\/api\/upload(?=$|\?)/, "/api/v1/files"],
  [/^\/api\/export\/orders(?=$|\?)/, "/api/v1/export/orders.csv"],
  [/^\/api\/(?!v1\/)/, "/api/v1/"],
];

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bufferLogs: false });
  app.use((req: Request, _res: Response, next: NextFunction) => {
    for (const [re, to] of LEGACY) if (re.test(req.url)) { req.url = req.url.replace(re, to); break; }
    next();
  });
  app.setGlobalPrefix("api/v1");
  app.useBodyParser("json", { limit: "1mb" });
  app.disable("x-powered-by");
  app.use((_req: Request, res: Response, next: NextFunction) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    next();
  });
  app.enableCors({ origin: (origin: string | undefined, cb: (e: Error | null, ok?: boolean) => void) => cb(null, env.allowOrigin(origin)), credentials: true });
  app.enableShutdownHooks();
  await app.listen(env.port, "0.0.0.0");
  Logger.log(`API ready → http://localhost:${env.port}/api/v1   (Socket.IO on the same port)`, "Bootstrap");
}

bootstrap().catch((e) => {
  Logger.error(e?.message ?? e, "Bootstrap");
  process.exit(1);
});
