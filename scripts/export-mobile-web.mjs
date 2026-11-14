// Rebuilds the mobile app's web preview into public/m (served at /m by the Next.js server).
import { spawnSync } from "node:child_process";
const r = spawnSync("npx", ["expo", "export", "--platform", "web", "--output-dir", "../public/m"], {
  cwd: new URL("../mobile/", import.meta.url),
  stdio: "inherit",
  shell: true,
  env: { ...process.env, EXPO_WEB_BASE_URL: "/m" },
});
process.exit(r.status ?? 1);
