import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  existsSync,
  statSync,
  renameSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { randomBytes } from "node:crypto";
import { hashPassword } from "../server/password";
import { connectionURL } from "../server/task-connections";
import { clientOrigin } from "../src/task-links";
import type { ServerConfig, TaskConnection, ProviderOwner } from "../server/contracts";
const [command, file, ...args] = process.argv.slice(2);
const usage =
  "Usage: bun scripts/personal-config.ts init|account|password|user|connect|provider|studio|cancel|content|disable|workspace-v18|status <config-file> [arguments]";
if (
  !file ||
  ![
    "init",
    "account",
    "password",
    "user",
    "connect",
    "provider",
    "studio",
    "cancel",
    "disable",
    "content",
  "workspace-v18",
    "status",
  ].includes(command)
)
  throw Error(usage);
const path = resolve(file);
const save = (config: ServerConfig) => {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const temp = path + "." + process.pid + ".tmp";
  writeFileSync(temp, JSON.stringify(config, null, 2) + "\n", {
    mode: 0o600,
    flag: "wx",
  });
  renameSync(temp, path);
  };
if (command === "init") {
  if (existsSync(path)) throw Error("Target exists; refusing overwrite.");
  const origin = clientOrigin(args[0] || "http://127.0.0.1:4312");
  const username = args[1];
  if (args.length > 2 || (username !== undefined && !/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,79}$/.test(username)))
    throw Error("init accepts [https-origin|loopback-origin] [admin-username].");
  const u = new URL(origin);
  save({
    origin,
    port: u.protocol === "http:" && u.port ? Number(u.port) : 4312,
    auth_mode: "personal",
    personal: {
      name: "Yeisme",
      ...(username ? { username, role: "admin" as const } : { role: "viewer" as const }),
      password_hash_ref: path + ".password",
      scope_ids: ["personal"],
    },
    connections: [],
    owners: {},
    principals: [
      {
        issuer: "config",
        subject: "personal",
        name: "Yeisme",
        scopes: [
          {
            id: "personal",
            tenant: "personal",
            team: "",
            project: "personal",
            label: "个人工作区",
            owners: {},
            connection_ids: [],
          },
        ],
      },
    ],
  });
  console.log(
    "Created unconfigured personal workspace. Set a password and explicit service connections.",
  );
} else {
  const config = JSON.parse(readFileSync(path, "utf8")) as ServerConfig;
  if (command === "account") {
    const [username, role] = args;
    if (!config.personal || args.length !== 2 || !/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,79}$/.test(username || "") || !["admin", "viewer"].includes(role))
      throw Error("account requires <username> admin|viewer in personal mode.");
    if (config.personal.username && config.personal.username !== username)
      throw Error("A different named account exists; refusing replacement.");
    config.personal.username = username;
    config.personal.role = role as "admin" | "viewer";
    save(config);
    console.log("Local account binding saved. Restart to reload; owner authorization is unchanged.");
  } else if (command === "password") {
    if (!config.personal) throw Error("Personal mode required.");
    let password = "";
    if (process.stdin.isTTY) {
      process.stdout.write("Enter a new password (input hidden), then Enter: ");
      process.stdin.setRawMode(true);
      process.stdin.resume();
      process.stdin.setEncoding("utf8");
      try {
        password = await new Promise<string>((ok, no) => {
          let input = "";
          const data = (chunk: string) => {
            for (const ch of chunk) {
              if (ch === "\u0003") {
                process.stdin.off("data", data);
                no(Error("Cancelled"));
                return;
              }
              if (ch === "\r" || ch === "\n") {
                process.stdin.off("data", data);
                ok(input);
                return;
              }
              if (ch === "\u007f") input = input.slice(0, -1);
              else if (ch >= " ") input += ch;
              if (Buffer.byteLength(input) > 1024) {
                process.stdin.off("data", data);
                no(Error("Password too long"));
                return;
              }
            }
          };
          process.stdin.on("data", data);
        });
      } finally {
        process.stdin.setRawMode(false);
        process.stdin.pause();
        process.stdout.write("\n");
      }
    } else {
      const input = createInterface({
        input: process.stdin,
        crlfDelay: Infinity,
      });
      for await (const line of input) {
        password = line;
        break;
      }
      input.close();
    }
    const hash = await hashPassword(password);
    mkdirSync(dirname(config.personal.password_hash_ref), {
      recursive: true,
      mode: 0o700,
    });
    const tmp = config.personal.password_hash_ref + ".tmp";
    writeFileSync(tmp, hash + "\n", { mode: 0o600, flag: "wx" });
    renameSync(tmp, config.personal.password_hash_ref);
    console.log(
      "Password digest updated; existing personal sessions will be invalidated.",
    );
  } else if (command === "user") {
    const action = args[0];
    if (!config.personal || !["add", "list", "revoke"].includes(action || ""))
      throw Error("user requires add|list|revoke in personal mode.");
    const users = config.personal.users || [];
    if (action === "list") {
      console.log(JSON.stringify(users.map(({ key_hash_ref: _key, ...user }) => ({ ...user, enabled: user.enabled !== false })), null, 2));
    } else if (action === "revoke") {
      const username = args[1];
      if (!username || args.length !== 2) throw Error("user revoke requires <username>.");
      if (!users.some((user) => user.username === username)) throw Error("User not found.");
      config.personal.users = users.map((user) => user.username === username ? { ...user, enabled: false } : user);
      save(config);
      console.log(JSON.stringify({ username, enabled: false }));
    } else {
      const [_, username, role, name, ...scopeArgs] = args;
      if (!username || !name || !["admin", "viewer"].includes(role || "") || !/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,79}$/.test(username) || users.some((user) => user.username === username))
        throw Error("user add requires <username> <admin|viewer> <display-name> [scope-id ...].");
      const scopes = config.principals.flatMap((principal) => principal.scopes.map((scope) => scope.id));
      const scope_ids = scopeArgs.length ? scopeArgs : scopes;
      if (!scope_ids.length || scope_ids.some((id) => !scopes.includes(id))) throw Error("Unknown scope id.");
      const access_key = "yk_live_" + randomBytes(32).toString("base64url");
      const key_hash_ref = resolve(path + ".users", username + ".key");
      mkdirSync(dirname(key_hash_ref), { recursive: true, mode: 0o700 });
      writeFileSync(key_hash_ref, (await hashPassword(access_key)) + "\n", { mode: 0o600, flag: "wx" });
      config.personal.users = [...users, { username, name, role: role as "admin" | "viewer", key_hash_ref, scope_ids, enabled: true, created_at: new Date().toISOString() }];
      save(config);
      console.log(JSON.stringify({ username, name, role, scope_ids, access_key, shown_once: true }, null, 2));
    }
  } else if (command === "connect") {
    const [id, owner, endpoint, project, credential_ref, ...flags] = args;
    if (
      !id ||
      !/^[-a-zA-Z0-9_]{1,80}$/.test(id) ||
      !["eikona", "sonora", "scaena"].includes(owner) ||
      !project ||
      !credential_ref
    )
      throw Error(
        "connect requires <id> <owner> <endpoint> <owner-project> <credential-file> [--private-http] [--content]",
      );
    const c: TaskConnection = {
      id,
      owner: owner as TaskConnection["owner"],
      instance_id: id,
      label: owner,
      environment: "personal",
      endpoint,
      project,
      credential_ref: resolve(credential_ref),
      enabled: true,
      allow_private_http: flags.includes("--private-http"),
      allow_cancel: false,
      allow_content: flags.includes("--content"),
    };
    connectionURL(c);
    const all = config.connections || [];
    if (all.some((v) => v.id === id))
      throw Error("Connection already exists; no credential replaced.");
    config.connections = [...all, c];
    const scope = config.principals
      .flatMap((p) => p.scopes)
      .find((s) => s.id === "personal");
    if (!scope) throw Error("Personal scope missing.");
    scope.connection_ids = [...(scope.connection_ids || []), id];
    scope.owners[c.owner] = {
      tenant: project,
      project,
      actor: "personal",
      audience: owner,
    };
    save(config);
    console.log(
      "Registered endpoint and credential reference; no network call or permission change.",
    );
  } else if (command === "provider") {
    const [owner, endpoint, project, credential_ref, model_ref, submit, status, ...rest] = args;
    if (!owner || !["eikona", "scaena", "sonora"].includes(owner) || !endpoint || !project || !credential_ref || !model_ref || !submit || args.length < 7)
      throw Error("provider requires <eikona|scaena|sonora> <https-mcp-endpoint> <project> <0600-credential-file> <model-ref> <submit-action> <status-action|->");
    const file = resolve(credential_ref);
    if (!existsSync(file) || (statSync(file).mode & 0o077)) throw Error("Provider credential file must exist and be 0600.");
    const allowedActions = new Set(["generate", "createVideoProviderTask", "voice.audition"]);
    if (!allowedActions.has(submit)) throw Error("Unsupported provider submit action.");
    const connection = {
      owner: owner as ProviderOwner,
      endpoint,
      project,
      credential_ref: file,
      enabled: true,
      model_refs: [model_ref],
      action_manifest: {
        submit,
        ...(status && status !== "-" ? { status, reconcile: status } : {}),
      },
    };
    config.providers = { ...(config.providers || {}), [owner]: connection };
    save(config);
    console.log(JSON.stringify({ owner, endpoint, project, model_ref, submit, status: status === "-" ? null : status, credential_configured: true, network_called: false }, null, 2));
  } else if (command === "studio") {
    const c = config.connections?.find((c) => c.id === args[0]);
    if (!c || c.owner !== "scaena" || args.length !== 2)
      throw Error(
        "studio requires <scaena-connection-id> <https-origin|loopback-origin>",
      );
    c.studio_origin = clientOrigin(args[1]);
    save(config);
    console.log(
      "Registered fixed Studio origin; no credentials or permissions changed. Restart to reload.",
    );
  } else if (command === "cancel") {
    const c = config.connections?.find((c) => c.id === args[0]);
    if (
      !c ||
      !["eikona", "sonora", "scaena"].includes(c.owner) ||
      !["on", "off"].includes(args[1]) ||
      args.length !== 2
    )
      throw Error(
        "cancel requires <connection-id> on|off; owner-supported queued run, local-job or delegation only",
      );
    c.allow_cancel = args[1] === "on";
    save(config);
    console.log(
      "Local cancellation preference saved; owner permission is still required. Restart to reload.",
    );
  } else if (command === "content") {
    const c = config.connections?.find((connection) => connection.id === args[0]);
    if (
      !c ||
      !["eikona", "sonora", "scaena"].includes(c.owner) ||
      !["on", "off"].includes(args[1]) ||
      args.length !== 2
    )
      throw Error("content requires <connection-id> on|off; owner authorization is separate.");
    c.allow_content = args[1] === "on";
    save(config);
    console.log(
      "Local content preference saved; owner authorization is unchanged. Restart to reload.",
    );
  } else if (command === "disable") {
    const c = config.connections?.find((c) => c.id === args[0]);
    if (!c) throw Error("Unknown connection.");
    c.enabled = false;
    save(config);
    console.log(
      "Connection disabled; restart the local control-center process to reload configuration.",
    );
  } else if (command === "workspace-v18") {
    if (!config.personal || !["on", "off"].includes(args[0] || "") || args.length !== 1)
      throw Error("workspace-v18 requires on|off in personal mode.");
    config.workspace_v18_demo = args[0] === "on";
    save(config);
    console.log("Workspace v18 demo API preference saved; restart the control center to reload.");
  } else
    console.log(
      JSON.stringify(
        {
          auth_mode: config.auth_mode,
          origin: config.origin,
          username: config.personal?.username,
          role: config.personal?.role === "admin" ? "admin" : "viewer",
          password_configured:
            !!config.personal && existsSync(config.personal.password_hash_ref),
          connections: (config.connections || []).map((c) => ({
            id: c.id,
            owner: c.owner,
            project: c.project,
            enabled: c.enabled,
            content_requested: c.allow_content === true,
            credential_configured: existsSync(c.credential_ref),
          })),
          providers: Object.fromEntries(Object.entries(config.providers || {}).map(([owner, p]) => [owner, {
            endpoint: p.endpoint,
            project: p.project,
            enabled: p.enabled,
            model_refs: p.model_refs,
            credential_configured: !!p.credential_ref && existsSync(p.credential_ref),
            action_manifest: p.action_manifest,
          }])),
        },
        null,
        2,
      ),
    );
}
