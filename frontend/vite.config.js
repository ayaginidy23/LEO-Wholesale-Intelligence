import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    // Any request starting with /api is forwarded to the FastAPI server
    proxy: { "/api": "http://127.0.0.1:8000" },
  },
});