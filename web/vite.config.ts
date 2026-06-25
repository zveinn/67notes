import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Frontend talks only to the Go backend. During `vite dev` we proxy /api to it.
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
  server: {
    proxy: {
      "/api": "http://127.0.0.1:6767",
    },
  },
});
