import { ExecutionContext, SetMetadata, createParamDecorator } from "@nestjs/common";
import type { Role, User } from "../common/contract";

export const IS_PUBLIC = "isPublic";
export const ROLES = "roles";

/** Route needs no login. */
export const Public = () => SetMetadata(IS_PUBLIC, true);
/** Only these roles may call the route (checked on the server for every request). */
export const Roles = (...roles: Role[]) => SetMetadata(ROLES, roles);
export const TeamOnly = () => Roles("admin", "agent");
export const AdminOnly = () => Roles("admin");
export const ResellerOnly = () => Roles("reseller");

/** The signed-in user (re-loaded from the database on every request). */
export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext): User => ctx.switchToHttp().getRequest().user);

export const isTeam = (u: User) => u.role === "admin" || u.role === "agent";
