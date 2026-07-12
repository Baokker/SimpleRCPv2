import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const apiOrigin = process.env.VITE_SIMPLERCP_API_ORIGIN ?? "http://127.0.0.1:4000";
const devPort = Number(process.env.VITE_SIMPLERCP_CLIENT_PORT ?? 5173);

export default defineConfig({
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    port: devPort,
    proxy: {
      "/api": apiOrigin,
      "/ws": {
        target: apiOrigin.replace(/^http/, "ws"),
        ws: true
      },
      "/yjs": {
        target: apiOrigin.replace(/^http/, "ws"),
        ws: true
      }
    }
  }
});
