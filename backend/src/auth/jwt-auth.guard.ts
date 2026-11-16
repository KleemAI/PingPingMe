import { CanActivate, ExecutionContext, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { Request } from "express";
import { forbidden } from "../common/errors";
import type { Role } from "../common/contract";
import { AuthService } from "./auth.service";
import { IS_PUBLIC, ROLES } from "./decorators";
import { tokenFrom } from "./session-cookie";

/** Global guard: session cookie (web), `Authorization: Bearer <token>` (mobile/API) or `?access_token=` (links) + role check. */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly auth: AuthService, private readonly reflector: Reflector) {}

  async canActivate(ctx: ExecutionContext) {
    if (ctx.getType() !== "http") return true;
    const targets = [ctx.getHandler(), ctx.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets)) return true;
    const req = ctx.switchToHttp().getRequest<Request & { user?: unknown }>();
    const user = await this.auth.verify(tokenFrom(req));
    req.user = user;
    const roles = this.reflector.getAllAndOverride<Role[] | undefined>(ROLES, targets);
    if (roles && !roles.includes(user.role)) throw forbidden(user.role === "reseller" ? "Team members only" : "Not allowed for your role");
    return true;
  }
}
