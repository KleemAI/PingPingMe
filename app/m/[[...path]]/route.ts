import fs from "node:fs";
import path from "node:path";

/**
 * Serves the Expo (React Native) mobile app's web build at /m.
 * Static files come from public/m; every other /m/... path gets index.html so
 * deep links like /m/request/rq1 work (single-page app fallback).
 * Rebuild with:  npm run mobile:web
 */
export const dynamic = "force-dynamic";

export async function GET() {
  const file = path.join(process.cwd(), "public", "m", "index.html");
  if (!fs.existsSync(file)) {
    return new Response("Mobile web build not found. Run: npm run mobile:web", { status: 404 });
  }
  // "Add to Home screen" support: opens full-screen like an installed app
  const head = [
    '<link rel="manifest" href="/m/manifest.json">',
    '<meta name="theme-color" content="#07090c">',
    '<meta name="mobile-web-app-capable" content="yes">',
    '<meta name="apple-mobile-web-app-capable" content="yes">',
    '<meta name="apple-mobile-web-app-title" content="BizMsg">',
    '<meta name="apple-mobile-web-app-status-bar-style" content="default">',
    '<link rel="apple-touch-icon" href="/m/icon-180.png">',
  ].join("");
  const html = fs.readFileSync(file, "utf8").replace("</head>", head + "</head>");
  return new Response(html, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
}
