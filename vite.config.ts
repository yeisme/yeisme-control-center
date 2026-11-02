import { defineConfig } from "vite";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { existsSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { unservedTopLevel } from "./server/served-entries.mjs";

// Machine-specific dev-preview settings stay out of git (.local/ is ignored):
// { "control_origin": "https://<host>:<port>", "allowed_hosts": ["<host>"] }
const local: { control_origin?: string; allowed_hosts?: string[] } = (() => {
  try { return JSON.parse(readFileSync(fileURLToPath(new URL("./.local/dev-preview.json", import.meta.url)), "utf8")); } catch { return {}; }
})();
const controlOrigin = process.env.V18_CONTROL_ORIGIN || local.control_origin || "http://127.0.0.1:4312";
const controlOriginUrl = new URL(controlOrigin);
const apiOrigin = process.env.V18_API_ORIGIN || "http://127.0.0.1:4312";
let outDir = resolve("dist");

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
      name: "control-center-served-entries",
      apply: "build",
      configResolved(config) {
        outDir = resolve(config.root, config.build.outDir);
      },
      closeBundle() {
        // public/ is copied whole, and holds files that must not be served: an ignored source archive and licence texts.
        // Nothing but the server's served entries stays in dist/; the files in public/ itself are left alone.
        if (!existsSync(outDir)) return;
        for (const name of unservedTopLevel(readdirSync(outDir))) rmSync(join(outDir, name), { recursive: true, force: true });
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
        // The public guide: same styles and guide components, no session and no API.
        guide: resolve("app/guide.html"),
      },
      output: {
        // By module path, so React's CommonJS wrappers stay with React. Listed by package name they landed in the
        // Radix chunk, and every page (the public guide too) had to load all of Radix to render anything.
        manualChunks(id: string) {
          if (/node_modules[\\/](?:react|react-dom|scheduler)[\\/]/.test(id)) return "react";
          if (/node_modules[\\/](?:radix-ui|@radix-ui)[\\/]/.test(id)) return "controls";
          return undefined;
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
          proxy.on("proxyReq", (request, req) => {
            request.setHeader("Host", controlOriginUrl.host);
            request.setHeader("Origin", controlOriginUrl.origin);
            // The control center counts sign-ins by the client address in the last entry of this header, and believes it from a
            // proxy on this machine, which is what this is. What the client wrote there is its own claim: left to pass through,
            // anyone who can reach this server could count as any address they liked. So it is replaced by whoever is really on
            // this connection (and removed when the connection is already gone, so the control center counts the proxy itself).
            const peer = req.socket.remoteAddress;
            if (peer) request.setHeader("X-Forwarded-For", peer);
            else request.removeHeader("X-Forwarded-For");
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
