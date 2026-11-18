import { Body, Controller, Get, HttpCode, Post, Res } from "@nestjs/common";
import type { Response } from "express";
import type { User } from "../common/contract";
import { AuthService } from "./auth.service";
import { AllowCustomer, CurrentUser, Public } from "./decorators";
import { clearSessionCookie, setSessionCookie } from "./session-cookie";

@Controller("auth")
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  /**
   * `{ email, password }` → `{ accessToken, role, name, user }` and an httpOnly session cookie.
   * Web app: the cookie is used automatically. Mobile / API clients: send `Authorization: Bearer <accessToken>`.
   */
  @Public() @Post("login") @HttpCode(200)
  async login(@Body() body: { email?: string; password?: string }, @Res({ passthrough: true }) res: Response) {
    const result = await this.auth.login(body?.email, body?.password);
    setSessionCookie(res, result.accessToken);
    return result;
  }

  /** `{ email }` → `{ email, exists }`. The login screen asks for the password when it exists, else shows sign-up. */
  @Public() @Post("check-email") @HttpCode(200)
  checkEmail(@Body() body: { email?: string }) {
    return this.auth.emailExists(body?.email);
  }

  /** Customer sign-up: `{ name, email, password }` → signed in (same answer as login). Name: letters and spaces only. */
  @Public() @Post("signup") @HttpCode(201)
  async signup(@Body() body: { name?: string; email?: string; password?: string }, @Res({ passthrough: true }) res: Response) {
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
