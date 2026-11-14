import "server-only";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import type { DB } from "../types";
import { seed } from "./seed";

/**
 * Central data store.
 * MVP: a single JSON file (data/db.json) with serialised writes so every agent shares
 * the same records and reloads preserve them. The repository API (read / mutate) is the
 * only access path, so swapping to PostgreSQL later only touches this file.
 */

const DATA_DIR = process.env.DATA_DIR ?? path.join(process.cwd(), "data");
const DB_FILE = path.join(DATA_DIR, "db.json");
export const UPLOAD_DIR = path.join(DATA_DIR, "uploads");

type G = typeof globalThis & { __bmLock?: Promise<unknown> };
const g = globalThis as G;

export function hashPassword(pw: string, salt = crypto.randomBytes(8).toString("hex")) {
  return `${salt}:${crypto.scryptSync(pw, salt, 32).toString("hex")}`;
}
export function checkPassword(pw: string, stored?: string) {
  if (!stored) return false;
  const [salt, hash] = stored.split(":");
  const test = crypto.scryptSync(pw, salt, 32);
  return crypto.timingSafeEqual(test, Buffer.from(hash, "hex"));
}

function ensure(): void {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  if (!fs.existsSync(DB_FILE)) {
    const db = seed();
    const demo = hashPassword("demo123");
    db.users = db.users.map((u) => ({ ...u, passwordHash: demo }));
    write(db);
  }
}

function write(db: DB) {
  const tmp = DB_FILE + "." + process.pid + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(db));
  fs.renameSync(tmp, DB_FILE); // atomic replace
}

export function readDB(): DB {
  ensure();
  return JSON.parse(fs.readFileSync(DB_FILE, "utf8")) as DB;
}

/** Serialised read-modify-write. The mutator may throw to abort (nothing is written). */
export async function mutate<T>(fn: (db: DB) => T): Promise<T> {
  const prev = g.__bmLock ?? Promise.resolve();
  let release!: () => void;
  g.__bmLock = new Promise<void>((r) => (release = r));
  await prev.catch(() => {});
  try {
    const db = readDB();
    const result = fn(db);
    db.version += 1;
    write(db);
    return result;
  } finally {
    release();
  }
}

export function resetDB() {
  if (fs.existsSync(DB_FILE)) fs.unlinkSync(DB_FILE);
  ensure();
}

export const newId = (p: string) => `${p}_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;

export function nextRef(db: DB, key: "REQ" | "ORD" | "CASE") {
  db.counters[key] = (db.counters[key] ?? 0) + 1;
  const n = db.counters[key];
  return key === "CASE" ? `CASE-${String(n).padStart(3, "0")}` : `${key}-${n}`;
}
