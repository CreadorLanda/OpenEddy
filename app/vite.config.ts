import { defineConfig } from "vite";

export default defineConfig({
  clearScreen: false,
  server: { port: 1430, strictPort: true, host: "127.0.0.1" },
  build: { target: "safari15", minify: "esbuild", sourcemap: false, emptyOutDir: true },
});
