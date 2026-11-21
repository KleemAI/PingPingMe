import { Logger } from "@nestjs/common";
import { promises as dns } from "node:dns";
import { isIP, Socket, type LookupFunction } from "node:net";

const log = new Logger("Database");

/** DNS-over-HTTPS providers (JSON API). Used only when the computer's own DNS can't find the database host. */
const DOH = [
  (name: string) => `https://dns.google/resolve?name=${encodeURIComponent(name)}&type=A`,
  (name: string) => `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(name)}&type=A`,
];

type DohAnswer = { Status: number; Answer?: { type: number; data: string }[] };

/** Look a hostname up through public DNS over HTTPS (works even when the local DNS server fails). */
export async function resolveViaDoh(host: string, fetcher: typeof fetch = fetch): Promise<string | null> {
  for (const url of DOH) {
    try {
      const res = await fetcher(url(host), { headers: { accept: "application/dns-json" }, signal: AbortSignal.timeout(5000) });
      if (!res.ok) continue;
      const body = (await res.json()) as DohAnswer;
      const ip = body.Answer?.find((a) => a.type === 1 && isIP(a.data) === 4)?.data;
      if (ip) return ip;
    } catch {
      /* try the next provider */
    }
  }
  return null;
}

export type PgConnection =
  | { url: string; ssl: boolean | { rejectUnauthorized: boolean } }
  | { host: string; port: number; username: string; password: string; database: string; ssl: false | { servername: string; rejectUnauthorized: boolean } };

/**
 * Connection settings for TypeORM.
 * Normally just the DATABASE_URL. If this computer's DNS can't resolve the host (common with some
 * ISP DNS servers and Neon hostnames), connect to the IP found via public DNS while TLS still
 * verifies the certificate against the real hostname (SNI), so Neon routes and secures the connection as usual.
 */
export async function pgConnection(
  url: string,
  ssl: boolean,
  deps: { lookup?: (h: string) => Promise<unknown>; doh?: (h: string) => Promise<string | null> } = {},
): Promise<PgConnection> {
  const lookup = deps.lookup ?? ((h: string) => dns.lookup(h));
  const doh = deps.doh ?? ((h: string) => resolveViaDoh(h));
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("DATABASE_URL is not a valid postgresql:// connection string");
  }
  const host = parsed.hostname;
  const sslOpt = ssl ? { rejectUnauthorized: true } : false;
  if (!host || isIP(host) || host === "localhost") return { url, ssl: ssl ? true : false };
  try {
    await lookup(host);
    return { url, ssl: ssl ? true : false };
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code !== "ENOTFOUND" && code !== "EAI_AGAIN") return { url, ssl: ssl ? true : false };
    const ip = await doh(host);
    if (!ip) {
      throw new Error(
        `Can't find the database server "${host}". Check your internet connection. ` +
          `If the internet works, change your Wi-Fi/Ethernet DNS to 8.8.8.8 and 1.1.1.1 and try again.`,
      );
    }
    log.warn(`This network's DNS can't resolve ${host}; connecting to ${ip} found via public DNS (certificate still checked for ${host}).`);
    return {
      host: ip,
      port: Number(parsed.port || 5432),
      username: decodeURIComponent(parsed.username),
      password: decodeURIComponent(parsed.password),
      database: decodeURIComponent(parsed.pathname.replace(/^\//, "")) || "postgres",
      ssl: sslOpt ? { servername: host, rejectUnauthorized: true } : false,
    };
  }
}

// ------------------------------------------------------------------ every new connection

type Address = { address: string; family: number };
const DNS_DOWN = new Set(["ENOTFOUND", "EAI_AGAIN"]);
const WARN_EVERY = 60_000;

/**
 * DNS lookup for each new database connection that survives the local DNS failing while the API is running
 * (Wi-Fi switch, ISP DNS hiccup): system DNS first, then public DNS over HTTPS, then the last address that worked.
 * Without this, a DNS outage after start-up made every new connection fail with "getaddrinfo ENOTFOUND".
 */
export function resilientLookup(
  deps: { lookup?: (h: string, family?: number) => Promise<Address[]>; doh?: (h: string) => Promise<string | null> } = {},
): LookupFunction {
  const system = deps.lookup ?? ((h: string, family?: number) => dns.lookup(h, { all: true, family: family ?? 0 }));
  const doh = deps.doh ?? ((h: string) => resolveViaDoh(h));
  const lastGood = new Map<string, Address[]>();
  let warnedAt = 0;

  const resolve = async (host: string, family?: number): Promise<Address[]> => {
    try {
      const found = await system(host, family);
      if (found.length) lastGood.set(host, found);
      return found;
    } catch (e) {
      if (!DNS_DOWN.has((e as NodeJS.ErrnoException).code ?? "")) throw e;
      const ip = await doh(host);
      const fallback = ip ? [{ address: ip, family: 4 }] : lastGood.get(host);
      if (!fallback?.length) throw e;
      if (ip) lastGood.set(host, fallback);
      if (Date.now() - warnedAt > WARN_EVERY) {
        warnedAt = Date.now();
        log.warn(`This network's DNS can't resolve ${host} right now; using ${fallback[0].address} (${ip ? "public DNS" : "last known address"}).`);
      }
      return fallback;
    }
  };

  return ((hostname: string, options: { all?: boolean; family?: number | string } | number, callback: (...a: unknown[]) => void) => {
    const opts = typeof options === "object" && options ? options : { family: typeof options === "number" ? options : undefined };
    const family = opts.family === "IPv4" ? 4 : opts.family === "IPv6" ? 6 : Number(opts.family) || undefined;
    resolve(hostname, family).then(
      (list) => (opts.all ? callback(null, list) : callback(null, list[0].address, list[0].family)),
      (err) => callback(err),
    );
  }) as unknown as LookupFunction;
}

/**
 * Socket factory for node-postgres (`extra.stream`): a plain TCP socket whose connect() uses resilientLookup.
 * The hostname is kept, so TLS still checks the certificate against the real database host.
 */
export function resilientStream(lookup: LookupFunction = resilientLookup()) {
  return () => {
    const socket = new Socket();
    const connect = socket.connect.bind(socket) as (...a: unknown[]) => Socket;
    (socket as unknown as { connect: (...a: unknown[]) => Socket }).connect = (...args: unknown[]) => {
      const [port, host] = args;
      // pg calls connect(port, host); leave unix sockets, IPs and localhost alone
      if (typeof host !== "string" || host.startsWith("/") || isIP(host) || host === "localhost") return connect(...args);
      return connect({ port: Number(port), host, lookup });
    };
    return socket;
  };
}
