import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// During local development Vite forwards /api to the backend,
// so the frontend uses the same URLs as in production.
export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: 5173,
    proxy: {
      "/api": process.env.VITE_BACKEND_URL || "http://localhost:3000",
    },
  },
});
