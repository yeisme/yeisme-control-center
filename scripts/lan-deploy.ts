import { existsSync, mkdirSync, readFileSync, writeFileSync, cpSync, chmodSync, statSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { homedir } from "node:os";
import { spawnSync } from "node:child_process";

const [command, origin = "https://10.10.1.101:8443"] = process.argv.slice(2);
if (command !== "prepare" || process.argv.length > 4) throw new Error("Usage: bun scripts/lan-deploy.ts prepare [https://10.10.1.101:8443]");
const url = new URL(origin);
if (url.origin !== origin || url.hostname !== "10.10.1.101" || url.protocol !== "https:" || url.port !== "8443")
  throw new Error("This delivery is restricted to https://10.10.1.101:8443.");
const root = resolve(import.meta.dirname, "..");
const configHome = join(homedir(), ".config/yeisme-control-center");
const state = join(homedir(), ".local/state/yeisme-control-center");
const unitHome = join(homedir(), ".config/systemd/user");
const config = join(configHome, "config.json");
const appUnit = join(unitHome, "yeisme-control-center.service");
const tlsUnit = join(unitHome, "yeisme-control-center-tls.service");
const caddyfile = join(configHome, "Caddyfile");
for (const p of [appUnit, tlsUnit, caddyfile]) if (existsSync(p)) throw new Error("Deployment file already exists; refusing overwrite: " + p);
if (!existsSync(join(root, "dist/index.html"))) throw new Error("Run bun run build before preparing deployment.");
const run = (binary: string, args: string[]) => {
  const result = spawnSync(binary, args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  if (result.status !== 0) throw new Error("Command failed: " + binary + " " + args[0]);
  return result.stdout.trim();
};
const bun = process.execPath;
const caddy = run("which", ["caddy"]);
for (const p of [root, configHome, state, bun, caddy]) if (!/^[/a-zA-Z0-9_.-]+$/.test(p)) throw new Error("Unsupported path for service unit.");
for (const p of [configHome, state, unitHome]) mkdirSync(p, { recursive: true, mode: 0o700 });
if (existsSync(config)) {
  const current = JSON.parse(readFileSync(config, "utf8"));
  if (current.origin !== origin || current.port !== 4312 || current.auth_mode !== "personal" || current.personal?.username !== "yeisme" || current.personal?.role !== "admin")
    throw new Error("Existing configuration differs; refusing replacement.");
  if (statSync(config).mode & 0o077) throw new Error("Configuration must be private.");
} else run(bun, ["scripts/personal-config.ts", "init", config, origin, "yeisme"]);
const releaseId = new Date().toISOString().replace(/[:.]/g, "-");
const release = join(state, "releases", releaseId);
mkdirSync(join(release, "dist"), { recursive: true, mode: 0o700 });
// Deploy only application bytes, not source archives, internal docs or test evidence.
cpSync(join(root, "dist/assets"), join(release, "dist/assets"), { recursive: true });
cpSync(join(root, "dist/index.html"), join(release, "dist/index.html"));
run(bun, ["build", "server/index.ts", "--target=bun", "--outfile=" + join(release, "server.mjs")]);
const dataHome = join(state, "caddy-data");
const cacheHome = join(state, "caddy-config");
for (const p of [dataHome, cacheHome]) mkdirSync(p, { recursive: true, mode: 0o700 });
const privateWrite = (file: string, content: string) => writeFileSync(file, content, { flag: "wx", mode: 0o600 });
privateWrite(caddyfile, `{
  admin off
  auto_https disable_redirects
  skip_install_trust
  servers {
    protocols h1 h2
  }
}
${origin} {
  bind 10.10.1.101
  tls internal
  header {
    X-Content-Type-Options nosniff
    Referrer-Policy same-origin
    Permissions-Policy "camera=(), microphone=(), geolocation=()"
  }
  @blocked path /docs/* /source.zip /source/*
  respond @blocked 404
  reverse_proxy 127.0.0.1:4312
}
`);
const common = `Restart=on-failure
RestartSec=3
TimeoutStopSec=15
UMask=0077
NoNewPrivileges=yes
PrivateTmp=yes
ProtectSystem=strict
RestrictSUIDSGID=yes
LimitNOFILE=4096
StandardOutput=journal
StandardError=journal
`;
privateWrite(appUnit, `[Unit]
Description=Yeisme control center (loopback application)
After=network.target

[Service]
Type=simple
WorkingDirectory=${release}
Environment=YEISME_CONTROL_CONFIG=${config}
ExecStart=${bun} ${release}/server.mjs
${common}
[Install]
WantedBy=default.target
`);
privateWrite(tlsUnit, `[Unit]
Description=Yeisme control center private LAN HTTPS
After=network-online.target yeisme-control-center.service
Wants=network-online.target yeisme-control-center.service

[Service]
Type=simple
Environment=XDG_DATA_HOME=${dataHome}
Environment=XDG_CONFIG_HOME=${cacheHome}
ExecStart=${caddy} run --config ${caddyfile} --adapter caddyfile
ReadWritePaths=${dataHome} ${cacheHome}
${common}
[Install]
WantedBy=default.target
`);
const manifest = { schema_version: "yeisme.control_center_deployment.v1", prepared_at: new Date().toISOString(), origin, application_port: 4312, release, config, caddyfile, app_unit: appUnit, tls_unit: tlsUnit, ca_certificate: join(dataHome, "caddy/pki/authorities/local/root.crt"), owner_configuration_changed: false, activated: false };
privateWrite(join(state, "deployment.json"), JSON.stringify(manifest, null, 2) + "\n");
chmodSync(configHome, 0o700);
console.log(JSON.stringify({ prepared: true, origin, release, password_configured: existsSync(config + ".password"), units_started: false, manifest: join(state, "deployment.json") }, null, 2));
