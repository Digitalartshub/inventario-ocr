import { defineConfig } from "vite";

export default defineConfig({
  base: "./",
  server: {
    allowedHosts: true,
    proxy: {
      "/api": "http://localhost:3000",
    },
  },
});
