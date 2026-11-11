import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // API_PORT lets a second dev server (e.g. the worst-case data set) run beside the normal one.
    proxy: { "/api": `http://localhost:${process.env.API_PORT ?? 8787}` },
  },
});
