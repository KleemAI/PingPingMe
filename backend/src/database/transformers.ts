import type { ValueTransformer } from "typeorm";

/** timestamptz in PostgreSQL ⇄ epoch milliseconds in the API. */
export const epochMs: ValueTransformer = {
  to: (v?: number | null) => (v === undefined || v === null ? v : new Date(v)),
  from: (v?: Date | string | null) => (v === undefined || v === null ? v : new Date(v).getTime()),
};

/** numeric(…) comes back from pg as a string — expose it as a number. */
export const decimal: ValueTransformer = {
  to: (v?: number | null) => v,
  from: (v?: string | number | null) => (v === undefined || v === null ? v : Number(v)),
};

export const TS = { type: "timestamptz" as const, transformer: epochMs };
export const TS_NULL = { type: "timestamptz" as const, transformer: epochMs, nullable: true };
