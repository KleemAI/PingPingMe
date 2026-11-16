import type { User } from "./contract";

/** Actor used for writes that no person triggered (webhooks, delivery receipts, background jobs). */
export const SYSTEM_USER: User = { id: "system", name: "System", email: "system@local", role: "admin", active: true };
