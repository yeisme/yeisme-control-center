import { defineConfig } from "vite";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { cpSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

// Machine-specific dev-preview settings stay out of git (.local/ is ignored):
// { "control_origin": "https://<host>:<port>", "allowed_hosts": ["<host>"] }
const local: { control_origin?: string; allowed_hosts?: string[] } = (() => {
  try { return JSON.parse(readFileSync(fileURLToPath(new URL("./.local/dev-preview.json", import.meta.url)), "utf8")); } catch { return {}; }
})();
const controlOrigin = process.env.V18_CONTROL_ORIGIN || local.control_origin || "http://127.0.0.1:4312";
const controlOriginUrl = new URL(controlOrigin);
const apiOrigin = process.env.V18_API_ORIGIN || "http://127.0.0.1:4312";

export default defineConfig(() => ({
  root: "app",
  base: "./",
  publicDir: "../public",
  plugins: [
    react(),
    tailwindcss(),
    {
      name: "control-center-api-target",
      apply: "serve",
      configureServer() {
        // 4312 is the installed release server: proxying there means server-side changes are not live.
        const release = !process.env.V18_API_ORIGIN;
        console.info(`[control-center] /api/control-center → ${apiOrigin}${release ? " (release server; server changes are not live — use bun run preview:real or preview:fixture)" : ""}`);
      },
    },
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
    allowedHosts: [...(local.allowed_hosts ?? []), ...(process.env.V18_ALLOWED_HOSTS?.split(",").map((host) => host.trim()).filter(Boolean) ?? [])],
    fs: { allow: [".."] },
    proxy: {
      "/api/control-center": {
        target: apiOrigin,
        changeOrigin: true,
        configure(proxy) {
          proxy.on("proxyReq", (request) => {
            request.setHeader("Host", controlOriginUrl.host);
            request.setHeader("Origin", controlOriginUrl.origin);
          });
          proxy.on("proxyRes", (response) => {
            const cookies = response.headers["set-cookie"];
            if (cookies) {
              response.headers["set-cookie"] = cookies.map((cookie) => cookie.replace(/;\s*Secure\b/gi, ""));
            }
          });
        },
      },
    },
  },
}));
