import { Body, Controller, Get, HttpCode, Param, Post, Req, Res } from "@nestjs/common";
import type { Request, Response } from "express";
import { AppError, badRequest, unauthorized } from "../common/errors";
import { clientIp } from "../security/client-ip";
import { LIMITS } from "../security/limits";
import { RateLimiter, tooMany } from "../security/rate-limiter.service";
import type { User } from "../common/contract";
import { AuthService, type SignInContext } from "./auth.service";
import { AllowCustomer, CurrentSession, CurrentUser, Public } from "./decorators";
import { clearSessionCookie, setSessionCookie, tokenFrom } from "./session-cookie";

/** For "Linked devices": the mobile app sends its model in `X-Device-Name`; browsers are named from the User-Agent. */
const signInContext = (req: Request): SignInContext => ({
  ip: clientIp(req),
  userAgent: String(req.headers["user-agent"] ?? ""),
  deviceName: typeof req.headers["x-device-name"] === "string" ? req.headers["x-device-name"] : undefined,
});

@Controller("auth")
export class AuthController {
  constructor(private readonly auth: AuthService, private readonly limiter: RateLimiter) {}

  /**
   * `{ email, password }` → `{ accessToken, role, name, user }` and an httpOnly session cookie.
   * Web app: the cookie is used automatically. Mobile / API clients: send `Authorization: Bearer <accessToken>`.
   */
  /**
   * `{ email, password }` → `{ accessToken, role, name, user }` and an httpOnly session cookie.
   * Web app: the cookie is used automatically. Mobile / API clients: send `Authorization: Bearer <accessToken>`.
   * Limits: tries per IP, and an account is locked for a while after several wrong passwords in a row.
   */
  @Public() @Post("login") @HttpCode(200)
  async login(@Body() body: { email?: string; password?: string }, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    this.limiter.take(`login:${clientIp(req)}`, LIMITS.loginPerIp, "Too many sign-in attempts from your network");
    const lockKey = `lock:${String(body?.email ?? "").trim().toLowerCase()}`;
    const locked = this.limiter.lockedFor(lockKey);
    if (locked) throw tooMany("This account is locked for a while after too many wrong passwords", locked);
    let result: Awaited<ReturnType<AuthService["login"]>>;
    try {
      result = await this.auth.login(body?.email, body?.password, signInContext(req));
    } catch (e) {
      if (e instanceof AppError && e.getStatus() === 401) {
        const left = this.limiter.failure(lockKey, LIMITS.wrongPasswords, LIMITS.lockMs);
        if (left === 0) throw tooMany("Too many wrong passwords — this account is locked", LIMITS.lockMs);
        if (left <= 2) throw unauthorized(`Wrong email or password — ${left} ${left === 1 ? "try" : "tries"} left before the account is locked for a while`);
      }
      throw e;
    }
    this.limiter.success(lockKey);
    setSessionCookie(res, result.accessToken);
    return result;
  }

  /** `{ email }` → `{ email, exists }`. The login screen asks for the password when it exists, else shows sign-up. */
  @Public() @Post("check-email") @HttpCode(200)
  checkEmail(@Body() body: { email?: string }, @Req() req: Request) {
    this.limiter.take(`check:${clientIp(req)}`, LIMITS.checkEmailPerIp, "Too many checks from your network");
    return this.auth.emailExists(body?.email);
  }

  /**
   * Customer sign-up: `{ name, email, password }` → signed in (same answer as login). Name: letters and spaces only.
   * With EMAIL_VERIFICATION=true: `{ needsVerification: true, email }` and a 6-digit code by email instead;
   * POST /auth/verify-email with the code signs them in.
   * Limits: a few new accounts per IP per hour / day, a cap on sign-ups per hour overall, no throw-away mailboxes,
   * and a hidden "website" field that only bots fill in.
   */
  @Public() @Post("signup") @HttpCode(201)
  async signup(@Body() body: { name?: string; email?: string; password?: string; website?: string }, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    if (body?.website) throw badRequest("Sign-up failed — please try again"); // honeypot: people never see this field
    const ip = clientIp(req);
    this.limiter.take(`signup-h:${ip}`, LIMITS.signupPerIpHour, "Too many new accounts from your network");
    this.limiter.take(`signup-d:${ip}`, LIMITS.signupPerIpDay, "Too many new accounts from your network today");
    this.limiter.take("signup-all", LIMITS.signupGlobalHour, "Sign-ups are busy right now");
    const result = await this.auth.signup(body?.name, body?.email, body?.password, signInContext(req));
    // signed in at once — or, with EMAIL_VERIFICATION on, `{ needsVerification, email }` and a code is emailed
    if ("accessToken" in result) setSessionCookie(res, result.accessToken);
    return result;
  }

  /** `{ email, code }` → email confirmed and signed in (same answer as login, plus the session cookie). */
  @Public() @Post("verify-email") @HttpCode(200)
  async verifyEmail(@Body() body: { email?: string; code?: string }, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    this.limiter.take(`verify:${clientIp(req)}`, LIMITS.verifyPerIp, "Too many tries from your network");
    const result = await this.auth.verifyEmail(body?.email, body?.code, signInContext(req));
    setSessionCookie(res, result.accessToken);
    return result;
  }

  /** `{ email }` → sends a new code (one a minute). */
  @Public() @Post("resend-code") @HttpCode(200)
  resendCode(@Body() body: { email?: string }, @Req() req: Request) {
    this.limiter.take(`resend:${clientIp(req)}`, LIMITS.resendPerIp, "Too many codes requested from your network");
    return this.auth.resendCode(body?.email);
  }

  @Get("me") @AllowCustomer()
  me(@CurrentUser() user: User) { return user; }

  /** Signs this device out: ends its session on the server and clears the session cookie. */
  @Public() @Post("logout") @HttpCode(200)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    await this.auth.logout(tokenFrom(req)).catch(() => {});
    clearSessionCookie(res);
    return { ok: true };
  }

  /** Linked devices: every device signed in to your account (at most 50), the current one marked `current`. */
  @Get("devices") @AllowCustomer()
  devices(@CurrentUser() user: User, @CurrentSession() sid: string) {
    return this.auth.devices(user, sid);
  }

  /** Sign one device out. `:id` = "others" signs out every device except this one. */
  @Post("devices/:id/logout") @HttpCode(200) @AllowCustomer()
  async logoutDevice(@CurrentUser() user: User, @CurrentSession() sid: string, @Param("id") id: string) {
    return { ok: true, signedOut: await this.auth.revokeDevices(user, sid, String(id)) };
  }
}
