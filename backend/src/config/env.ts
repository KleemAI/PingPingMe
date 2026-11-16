/** Typed access to environment variables (backend/.env). */
const bool = (v: string | undefined, d: boolean) => (v === undefined || v === "" ? d : ["1", "true", "yes", "on"].includes(v.toLowerCase()));

export const env = {
  get nodeEnv() { return process.env.NODE_ENV ?? "development"; },
  get isProd() { return env.nodeEnv === "production"; },
  get port() { return Number(process.env.PORT ?? 4000); },
  get databaseUrl() { return process.env.DATABASE_URL ?? ""; },
  get dbSync() { return bool(process.env.DB_SYNC, !env.isProd); },
  get dbSsl() {
    const url = env.databaseUrl;
    if (process.env.DB_SSL !== undefined) return bool(process.env.DB_SSL, true);
    return /sslmode=require|neon\.tech/.test(url);
  },
  get seedDemo() { return bool(process.env.SEED_DEMO, !env.isProd); },
  get allowReset() { return bool(process.env.ALLOW_RESET, !env.isProd); },
  get jwtSecret() {
    const s = process.env.JWT_SECRET ?? "";
    if (!s && env.isProd) throw new Error("JWT_SECRET is required in production");
    return s || "dev-only-jwt-secret-change-me";
  },
  get jwtExpiresIn() { return process.env.JWT_EXPIRES_IN ?? "7d"; },
  get webhookSecret() { return process.env.WEBHOOK_SECRET ?? "dev-webhook-secret"; },
  /** Set COOKIE_SECURE=true when the web app is served over HTTPS. */
  get cookieSecure() { return bool(process.env.COOKIE_SECURE, false); },
  get maxUploadBytes() { return Number(process.env.MAX_UPLOAD_MB ?? 10) * 1024 * 1024; },
  get corsOrigins() {
    return (process.env.CORS_ORIGINS ?? process.env.WEB_ORIGIN ?? "http://localhost:3000").split(",").map((s) => s.trim()).filter(Boolean);
  },
  /** CORS_ORIGINS=* allows any browser origin (handy when testing from a phone on Wi-Fi). */
  allowOrigin(origin?: string) {
    const list = env.corsOrigins;
    return !origin || list.includes("*") || list.includes(origin);
  },
};
