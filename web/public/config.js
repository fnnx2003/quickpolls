// Runtime configuration for the frontend.
// This file is copied as-is into the build output, so you can replace it per environment
// without rebuilding the image (e.g. mount it from a ConfigMap).
window.__APP_CONFIG__ = {
  // Empty = same origin (the server/Ingress routes /api to the backend).
  // Set e.g. "http://localhost:3000" to call the API directly (requires CORS_ORIGIN on the API).
  apiBaseUrl: "",
  environment: "local",
};
