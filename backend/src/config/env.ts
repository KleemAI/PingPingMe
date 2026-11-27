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
  /** videos may be bigger when they arrive — they are compressed to 720p before they are stored */
  get maxVideoBytes() { return Math.max(env.maxUploadBytes, Number(process.env.MAX_VIDEO_MB ?? 100) * 1024 * 1024); },
  /** total storage per user (all their uploads). Team members: TEAM_STORAGE_QUOTA_GB (0 = no limit). */
  get storageQuotaBytes() { return Number(process.env.STORAGE_QUOTA_GB ?? 20) * 1024 ** 3; },
  get teamStorageQuotaBytes() { return Number(process.env.TEAM_STORAGE_QUOTA_GB ?? 0) * 1024 ** 3; },
  /** Outgoing email (SMTP). Not set = codes are written to the backend log instead of being emailed. */
  get smtp() {
    const port = Number(process.env.SMTP_PORT ?? 587);
    return {
      host: process.env.SMTP_HOST ?? "", port, user: process.env.SMTP_USER ?? "", pass: process.env.SMTP_PASS ?? "",
      // empty MAIL_FROM: send as the SMTP account itself (what Gmail does anyway)
      from: process.env.MAIL_FROM || (process.env.SMTP_USER ? `Business Messaging <${process.env.SMTP_USER}>` : "Business Messaging <no-reply@localhost>"),
    };
  },
  /** Email can really be sent: SMTP_HOST, SMTP_USER and SMTP_PASS are all filled in (an empty password = not yet). */
  get mailReady() { const s = env.smtp; return !!(s.host && s.user && s.pass); },
  /**
   * New customers must confirm their email with a 6-digit code before they can sign in.
   * On by itself once email can be sent (SMTP host, user and password filled in); EMAIL_VERIFICATION=true/false decides
   * it yourself.
   */
  get emailVerification() { return bool(process.env.EMAIL_VERIFICATION, env.mailReady); },
  /**
   * Development helper: the sign-up / resend answers include the code (`devCode`) so the apps and tests can show it.
   * On by default only outside production and while SMTP isn't set.
   */
  get emailDevCodes() { return bool(process.env.EMAIL_DEV_CODES, !env.isProd && !env.mailReady); },
  /**
   * To-do voice clips (KittenTTS 2 service in tts/). TTS_URL empty = off (phones then ring with the normal sound).
   * TTS_SECRET is sent in x-tts-secret when the service is shared beyond this machine.
   */
  get ttsUrl() { return (process.env.TTS_URL ?? "http://127.0.0.1:4100").replace(/\/$/, ""); },
  get ttsSecret() { return process.env.TTS_SECRET ?? ""; },
  get corsOrigins() {
    return (process.env.CORS_ORIGINS ?? process.env.WEB_ORIGIN ?? "http://localhost:3000").split(",").map((s) => s.trim()).filter(Boolean);
  },
  /** CORS_ORIGINS=* allows any browser origin (handy when testing from a phone on Wi-Fi). */
  allowOrigin(origin?: string) {
    const list = env.corsOrigins;
    return !origin || list.includes("*") || list.includes(origin);
  },
};
