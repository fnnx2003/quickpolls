import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// In local dev, `npm run dev` proxies /api to the backend so you don't need CORS.
// In production the built static files are served by whatever you choose (nginx, etc.),
// and /api must be routed to the backend by that server or by your Ingress.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": process.env.API_PROXY_TARGET ?? "http://localhost:3000",
    },
  },
});
