import { ExecutionContext, SetMetadata, createParamDecorator } from "@nestjs/common";
import type { Role, User } from "../common/contract";

export const IS_PUBLIC = "isPublic";
export const ROLES = "roles";
export const ALLOW_CUSTOMER = "allowCustomer";

/** Route needs no login. */
export const Public = () => SetMetadata(IS_PUBLIC, true);
/** Only these roles may call the route (checked on the server for every request). */
export const Roles = (...roles: Role[]) => SetMetadata(ROLES, roles);
export const TeamOnly = () => Roles("admin", "agent");
export const AdminOnly = () => Roles("admin");
export const ResellerOnly = () => Roles("reseller");

/** Customers (self-registered) may call this route. Every other route refuses them. */
export const AllowCustomer = () => SetMetadata(ALLOW_CUSTOMER, true);

/** The signed-in user (re-loaded from the database on every request). */
export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext): User => ctx.switchToHttp().getRequest().user);

/** Id of the signed-in device (session) — see "Linked devices". */
export const CurrentSession = createParamDecorator((_: unknown, ctx: ExecutionContext): string => ctx.switchToHttp().getRequest().sid);

export const isTeam = (u: User) => u.role === "admin" || u.role === "agent";
