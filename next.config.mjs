/**
 * API_URL (in .env.local) = address of the NestJS backend in backend/ (PostgreSQL on Neon + Socket.IO).
 * When set, every /api/* call from the browser is forwarded to it, so pages, file links and the CSV export
 * keep working unchanged, and the session cookie stays on this site.
 * When not set, the web app falls back to its built-in demo server (app/api, JSON file).
 */
const API_URL = (process.env.API_URL ?? "").replace(/\/$/, "");

/** @type {import('next').NextConfig} */
const nextConfig = {
  env: {
    // where the browser opens the Socket.IO connection for live updates
    NEXT_PUBLIC_REALTIME_URL: API_URL,
  },
  async rewrites() {
    if (!API_URL) return [];
    return {
      // beforeFiles: the backend wins over the built-in app/api routes
      beforeFiles: [{ source: "/api/:path*", destination: `${API_URL}/api/:path*` }],
    };
  },
};

export default nextConfig;
