import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    // /api (analysis + explain) runs on the Python processing server locally
    proxy: {
      "/api": {
        target: process.env.ANALYSIS_PROXY ?? "http://127.0.0.1:8788",
        changeOrigin: true,
      },
    },
  },
});
