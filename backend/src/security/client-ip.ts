import type { IncomingMessage } from "node:http";

const LOOPBACK = /^(::1|127\.\d+\.\d+\.\d+|::ffff:127\.\d+\.\d+\.\d+)$/;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)?.split(",")[0]?.trim() || undefined;

/**
 * The caller's IP address. Forwarding headers are trusted only when the request comes from this machine
 * (the Next.js web app and the Cloudflare tunnel run here); anyone else can't fake their address with a header.
 */
export function clientIp(req: IncomingMessage) {
  const socketIp = req.socket?.remoteAddress ?? "unknown";
  if (!LOOPBACK.test(socketIp)) return socketIp.replace(/^::ffff:/, "");
  const h = req.headers;
  return (first(h["cf-connecting-ip"]) ?? first(h["x-real-ip"]) ?? first(h["x-forwarded-for"]) ?? socketIp).replace(/^::ffff:/, "");
}
