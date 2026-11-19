/**
 * Abuse limits (all can be changed in backend/.env). RATE_LIMIT_SCALE multiplies the per-IP / per-user request limits —
 * e.g. 100 for load tests; the per-account wrong-password lock and the upload limits are not scaled.
 */
const num = (name: string, d: number) => {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v > 0 ? v : d;
};
const scale = () => num("RATE_LIMIT_SCALE", 1);
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const MB = 1024 * 1024;

export const LIMITS = {
  /** any API call, per IP address */
  get ipRequests() { return { limit: Math.round(num("RATE_IP_PER_MIN", 300) * scale()), windowMs: MIN }; },
  /** any API call, per signed-in user (team gets 5×) */
  get userRequests() { return { limit: Math.round(num("RATE_USER_PER_MIN", 240) * scale()), windowMs: MIN }; },
  /** actions (send, save, order…) per signed-in user per minute (team gets 5×) */
  get userActions() { return { limit: Math.round(num("RATE_ACTIONS_PER_MIN", 60) * scale()), windowMs: MIN }; },

  /** login tries per IP */
  get loginPerIp() { return { limit: Math.round(20 * scale()), windowMs: 15 * MIN }; },
  /** wrong passwords in a row before an account is locked for a while */
  get wrongPasswords() { return num("LOGIN_MAX_WRONG", 5); },
  get lockMs() { return num("LOGIN_LOCK_MIN", 15) * MIN; },
  /** "does this email exist?" checks per IP (stops people listing our users) */
  get checkEmailPerIp() { return { limit: Math.round(30 * scale()), windowMs: 10 * MIN }; },

  /** new accounts per IP — per hour and per day */
  get signupPerIpHour() { return { limit: Math.round(num("SIGNUP_PER_IP_HOUR", 3) * scale()), windowMs: HOUR }; },
  get signupPerIpDay() { return { limit: Math.round(num("SIGNUP_PER_IP_DAY", 10) * scale()), windowMs: DAY }; },
  /** new accounts in total — a flood of sign-ups from many addresses */
  get signupGlobalHour() { return { limit: Math.round(num("SIGNUP_PER_HOUR", 200) * scale()), windowMs: HOUR }; },

  /** new Socket.IO connections per IP */
  get socketPerIp() { return { limit: Math.round(60 * scale()), windowMs: MIN }; },

  /** uploads in the last 24 hours, per user */
  uploadsPerDay(kind: "new" | "member" | "team") {
    if (kind === "team") return { files: num("UPLOAD_TEAM_FILES_DAY", 2000), bytes: num("UPLOAD_TEAM_MB_DAY", 5120) * MB };
    if (kind === "new") return { files: num("UPLOAD_NEW_FILES_DAY", 30), bytes: num("UPLOAD_NEW_MB_DAY", 50) * MB };
    return { files: num("UPLOAD_FILES_DAY", 300), bytes: num("UPLOAD_MB_DAY", 1024) * MB };
  },
  /** an account younger than this counts as "new" (smaller upload allowance) */
  get newAccountMs() { return num("NEW_ACCOUNT_HOURS", 24) * HOUR; },
  /** uploads running at the same time, per user */
  get parallelUploads() { return num("UPLOAD_PARALLEL", 3); },
};

/** Throw-away mailbox services — sign-ups from these are refused. */
export const DISPOSABLE_DOMAINS = new Set([
  "mailinator.com", "guerrillamail.com", "guerrillamail.net", "guerrillamail.org", "sharklasers.com", "grr.la", "10minutemail.com",
  "10minutemail.net", "tempmail.com", "temp-mail.org", "temp-mail.io", "tempmail.net", "tempmailo.com", "tempmail.dev", "throwawaymail.com",
  "yopmail.com", "yopmail.net", "yopmail.fr", "getnada.com", "nada.email", "trashmail.com", "trashmail.de", "trashmail.net", "dispostable.com",
  "maildrop.cc", "mailnesia.com", "mintemail.com", "fakeinbox.com", "spamgourmet.com", "mytemp.email", "emailondeck.com", "moakt.com",
  "mohmal.com", "tempr.email", "discard.email", "mailcatch.com", "inboxkitten.com", "burnermail.io", "33mail.com", "spambox.us",
  "fakemail.net", "tempinbox.com", "mail.tm", "mailpoof.com", "emailfake.com", "tmpmail.org", "tmpmail.net", "minuteinbox.com",
  "dropmail.me", "1secmail.com", "1secmail.net", "1secmail.org", "linshiyouxiang.net", "cock.li", "byom.de", "harakirimail.com",
]);
