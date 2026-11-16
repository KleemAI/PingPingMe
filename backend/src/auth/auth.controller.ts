import { Body, Controller, Get, HttpCode, Post, Res } from "@nestjs/common";
import type { Response } from "express";
import type { User } from "../common/contract";
import { AuthService } from "./auth.service";
import { CurrentUser, Public } from "./decorators";
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

  @Get("me")
  me(@CurrentUser() user: User) { return user; }

  /** Clears the session cookie (bearer tokens are stateless — the app simply forgets them). */
  @Public() @Post("logout") @HttpCode(200)
  logout(@Res({ passthrough: true }) res: Response) {
    clearSessionCookie(res);
    return { ok: true };
  }
}
