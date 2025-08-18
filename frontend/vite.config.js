import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

// Allow pointing the dev proxy to a remote backend (e.g., Railway)
// Set VITE_API_BASE to your backend origin, e.g. https://your-app.up.railway.app
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const apiBase = env.VITE_API_BASE || "http://localhost:3000";
  return {
    plugins: [react()],
    server: {
      port: 5173,
      proxy: {
        "/api": {
          target: apiBase,
          changeOrigin: true,
        },
        "/line": {
          target: apiBase,
          changeOrigin: true,
        },
      },
    },
    build: {
      outDir: "dist",
      sourcemap: true,
      minify: false,
    },
  };
});
