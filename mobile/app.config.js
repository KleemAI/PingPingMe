// The web preview is served by the Next.js server under /m (see ../scripts/export-mobile-web.mjs).
// That base path is applied only for that web export, never for the phone app.
const fs = require("fs");
const path = require("path");

// Push notifications on Android need Firebase: put google-services.json next to this file (see PUSH-SETUP.md).
const googleServices = path.join(__dirname, "google-services.json");

module.exports = ({ config }) => ({
  ...config,
  android: {
    ...(config.android ?? {}),
    ...(fs.existsSync(googleServices) ? { googleServicesFile: "./google-services.json" } : {}),
  },
  experiments: {
    ...(config.experiments ?? {}),
    ...(process.env.EXPO_WEB_BASE_URL ? { baseUrl: process.env.EXPO_WEB_BASE_URL } : {}),
  },
});
