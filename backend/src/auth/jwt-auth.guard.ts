import { CanActivate, ExecutionContext, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { Request } from "express";
import { forbidden } from "../common/errors";
import type { Role } from "../common/contract";
import { AuthService } from "./auth.service";
import { ALLOW_CUSTOMER, IS_PUBLIC, ROLES } from "./decorators";
import { tokenFrom } from "./session-cookie";
import { LIMITS } from "../security/limits";
import { RateLimiter } from "../security/rate-limiter.service";

/** Global guard: session cookie (web), `Authorization: Bearer <token>` (mobile/API) or `?access_token=` (links) + role check. */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly auth: AuthService, private readonly reflector: Reflector, private readonly limiter: RateLimiter) {}

  async canActivate(ctx: ExecutionContext) {
    if (ctx.getType() !== "http") return true;
    const targets = [ctx.getHandler(), ctx.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets)) return true;
    const req = ctx.switchToHttp().getRequest<Request & { user?: unknown; sid?: string }>();
    const { user, sid } = await this.auth.verifySession(tokenFrom(req));
    req.user = user;
    req.sid = sid;
    // every signed-in account has its own request budget (the team gets more)
    const rule = LIMITS.userRequests;
    this.limiter.take(`user:${user.id}`, user.role === "admin" || user.role === "agent" ? { ...rule, limit: rule.limit * 5 } : rule, "Too many requests from your account");
    // Customers can only reach routes that are explicitly opened to them.
    if (user.role === "customer" && !this.reflector.getAllAndOverride<boolean>(ALLOW_CUSTOMER, targets)) throw forbidden("Not available for customer accounts");
    const roles = this.reflector.getAllAndOverride<Role[] | undefined>(ROLES, targets);
    if (roles && !roles.includes(user.role)) throw forbidden(user.role === "reseller" ? "Team members only" : "Not allowed for your role");
    return true;
  }
}
