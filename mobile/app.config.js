// The web preview is served by the Next.js server under /m (see ../scripts/export-mobile-web.mjs).
// That base path is applied only for that web export, never for the phone app.
module.exports = ({ config }) => ({
  ...config,
  experiments: {
    ...(config.experiments ?? {}),
    ...(process.env.EXPO_WEB_BASE_URL ? { baseUrl: process.env.EXPO_WEB_BASE_URL } : {}),
  },
});
