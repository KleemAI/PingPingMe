import { Body, Controller, Get, HttpCode, Post, Req, Res } from "@nestjs/common";
import type { Request, Response } from "express";
import { AppError, badRequest, unauthorized } from "../common/errors";
import { clientIp } from "../security/client-ip";
import { LIMITS } from "../security/limits";
import { RateLimiter, tooMany } from "../security/rate-limiter.service";
import type { User } from "../common/contract";
import { AuthService } from "./auth.service";
import { AllowCustomer, CurrentUser, Public } from "./decorators";
import { clearSessionCookie, setSessionCookie } from "./session-cookie";

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
      result = await this.auth.login(body?.email, body?.password);
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
    const result = await this.auth.signup(body?.name, body?.email, body?.password);
    setSessionCookie(res, result.accessToken);
    return result;
  }

  @Get("me") @AllowCustomer()
  me(@CurrentUser() user: User) { return user; }

  /** Clears the session cookie (bearer tokens are stateless — the app simply forgets them). */
  @Public() @Post("logout") @HttpCode(200)
  logout(@Res({ passthrough: true }) res: Response) {
    clearSessionCookie(res);
    return { ok: true };
  }
}
