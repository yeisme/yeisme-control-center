import { defineConfig } from "vite";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { cpSync } from "node:fs";
import { join, resolve } from "node:path";
export default defineConfig(() => ({
  root: "app",
  base: "./",
  publicDir: "../public",
  plugins: [
    react(),
    tailwindcss(),
    {
      name: "control-center-docs",
      apply: "build",
      writeBundle(options) {
        if (options.dir)
          cpSync(
            fileURLToPath(new URL("./docs", import.meta.url)),
            join(options.dir, "docs"),
            { recursive: true },
          );
      },
    },
  ],
  resolve: {
    alias: { "/src": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  build: {
    outDir: "../dist",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        controlCenter: resolve("app/index.html"),
      },
      output: {
        manualChunks: {
          react: ["react", "react-dom", "react-dom/client"],
          controls: ["radix-ui"],
        },
      },
    },
  },
  server: {
    fs: { allow: [".."] },
    proxy: {
      "/api/control-center": {
        target: process.env.V18_API_ORIGIN || "http://127.0.0.1:4312",
        changeOrigin: true,
        configure(proxy) {
          proxy.on("proxyReq", (request) => {
            request.setHeader("Origin", process.env.V18_API_ORIGIN || "http://127.0.0.1:4312");
          });
        },
      },
    },
  },
}));
