import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  existsSync,
  statSync,
  renameSync,
  rmSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { randomBytes } from "node:crypto";
import { hashPassword } from "../server/password";
import { connectionURL, endpointURL } from "../server/task-connections";
import { isOpenToolKind } from "../src/shared/open-tools";
import { clientOrigin } from "../src/task-links";
import type { ServerConfig, TaskConnection, ProviderOwner, ObservationConfig } from "../server/contracts";
const [command, first, ...rest] = process.argv.slice(2);
const userActions = ["add", "list", "revoke", "rotate", "enable"];
// `user <config-file> add …` is the form every command uses; `user add <config-file> …` is accepted as well.
const [file, ...args] = command === "user" && userActions.includes(first) && rest.length ? [rest[0], first, ...rest.slice(1)] : [first, ...rest];
const usage =
  "Usage: bun scripts/personal-config.ts init|account|password|user|connect|auctra|provider|open-tool|studio|cancel|content|disable|observe|status <config-file> [arguments]";
if (
  !file ||
  ![
    "init",
    "account",
    "password",
    "user",
    "connect",
    "auctra",
    "provider",
    "open-tool",
    "studio",
    "cancel",
    "disable",
    "content",
    "observe",
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
/** Takes `--name <value>` out of an argument list; whatever else starts with `--` is not understood. */
const takeOption = (list: string[], name: string) => {
  const at = list.indexOf(name);
  if (at < 0) return { rest: list, value: undefined as string | undefined };
  const value = list[at + 1];
  if (!value || value.startsWith("--")) throw Error(`${name} requires a value.`);
  return { rest: [...list.slice(0, at), ...list.slice(at + 2)], value };
};
const newAccessKey = () => "yk_live_" + randomBytes(32).toString("base64url");
/** Writes a one-time access key to a new 0600 file. Refuses to touch a file that exists, whoever made it. */
const writeKeyFile = (target: string, key: string) => {
  const resolved = resolve(target);
  mkdirSync(dirname(resolved), { recursive: true, mode: 0o700 });
  try {
    writeFileSync(resolved, key + "\n", { mode: 0o600, flag: "wx" });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") throw Error("Key file exists; refusing overwrite.");
    throw error;
  }
  return resolved;
};
/** Replaces a private file through a temporary file in the same directory, so a reader sees the old or the new content, never a mix. */
const replacePrivate = (target: string, content: string) => {
  const temp = target + "." + process.pid + ".tmp";
  writeFileSync(temp, content, { mode: 0o600, flag: "wx" });
  try { renameSync(temp, target); } catch (error) { rmSync(temp, { force: true }); throw error; }
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
    bind: "127.0.0.1",
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
    if (!config.personal || !userActions.includes(action || ""))
      throw Error("user requires add|list|revoke|rotate|enable in personal mode.");
    const users = config.personal.users || [];
    const keyed = takeOption(args, "--key-file");
    if (keyed.rest.some((arg) => arg.startsWith("--"))) throw Error("Unknown option for user " + action + ".");
    // The key goes to a new 0600 file (and stays off the screen) when --key-file is given; without it, it is printed once.
    if (keyed.value !== undefined && !["add", "rotate"].includes(action)) throw Error("--key-file only applies to user add and user rotate.");
    const [, username, ...more] = keyed.rest;
    if (action === "list") {
      console.log(JSON.stringify(users.map(({ key_hash_ref: _key, ...user }) => ({ ...user, enabled: user.enabled !== false })), null, 2));
    } else if (action === "revoke") {
      if (!username || keyed.rest.length !== 2) throw Error("user revoke requires <username>.");
      if (!users.some((user) => user.username === username)) throw Error("User not found.");
      config.personal.users = users.map((user) => user.username === username ? { ...user, enabled: false } : user);
      save(config);
      console.log(JSON.stringify({ username, enabled: false }));
    } else if (action === "enable") {
      if (!username || keyed.rest.length !== 2) throw Error("user enable requires <username>.");
      const account = users.find((user) => user.username === username);
      if (!account) throw Error("User not found.");
      if (account.enabled !== false) {
        console.log(JSON.stringify({ username, enabled: true, changed: false }));
      } else {
        config.personal.users = users.map((user) => user.username === username ? { ...user, enabled: true } : user);
        save(config);
        console.log(JSON.stringify({ username, enabled: true, changed: true, key_unchanged: true, note: "The account's previous access key works again; run user rotate if the key may have leaked.", next: "restart the control center to reload" }, null, 2));
      }
    } else if (action === "rotate") {
      if (!username || keyed.rest.length !== 2) throw Error("user rotate requires <username> [--key-file <new file>].");
      const user = users.find((entry) => entry.username === username);
      if (!user) throw Error("User not found.");
      if (!existsSync(user.key_hash_ref)) throw Error("The account's key digest is missing; refusing to rotate.");
      const access_key = newAccessKey();
      const digest = await hashPassword(access_key);
      // Refuses an existing key file before anything changes. The running server compares every session with the digest file
      // on each request, so replacing it ends the account's sessions at once and only the new key signs in again.
      const key_file = keyed.value === undefined ? undefined : writeKeyFile(keyed.value, access_key);
      try {
        replacePrivate(user.key_hash_ref, digest + "\n");
      } catch (error) {
        if (key_file) rmSync(key_file, { force: true });
        throw error;
      }
      console.log(JSON.stringify({ username, rotated: true, sessions_ended: true, ...(key_file ? { key_file } : { access_key, shown_once: true }) }, null, 2));
    } else {
      const [role, name, ...scopeArgs] = more;
      if (!username || !name || !["admin", "viewer"].includes(role || "") || !/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,79}$/.test(username) || users.some((user) => user.username === username))
        throw Error("user add requires <username> <admin|viewer> <display-name> [scope-id ...] [--key-file <new file>].");
      const scopes = config.principals.flatMap((principal) => principal.scopes.map((scope) => scope.id));
      const scope_ids = scopeArgs.length ? scopeArgs : scopes;
      if (!scope_ids.length || scope_ids.some((id) => !scopes.includes(id))) throw Error("Unknown scope id.");
      const access_key = newAccessKey();
      const key_hash_ref = resolve(path + ".users", username + ".key");
      const digest = await hashPassword(access_key);
      // Everything that can be refused is checked before the first file is made: the key file must be new, and so must the digest file.
      if (existsSync(key_hash_ref)) throw Error("A key digest for this username already exists; refusing overwrite.");
      const key_file = keyed.value === undefined ? undefined : writeKeyFile(keyed.value, access_key);
      try {
        mkdirSync(dirname(key_hash_ref), { recursive: true, mode: 0o700 });
        writeFileSync(key_hash_ref, digest + "\n", { mode: 0o600, flag: "wx" });
        config.personal.users = [...users, { username, name, role: role as "admin" | "viewer", key_hash_ref, scope_ids, enabled: true, created_at: new Date().toISOString() }];
        save(config);
      } catch (error) {
        if (key_file) rmSync(key_file, { force: true });
        throw error;
      }
      console.log(JSON.stringify({ username, name, role, scope_ids, ...(key_file ? { key_file, shown_once: false } : { access_key, shown_once: true }) }, null, 2));
    }
  } else if (command === "observe") {
    // Server-side observation (reminders with no browser open). The server reads this at start, so restart afterwards.
    const [mode, ...flags] = args;
    if (!["on", "off"].includes(mode || "")) throw Error("observe requires on|off [--interval-minutes N] [--open-tools-every N] [--recipients issuer|subject,...|default].");
    const known = ["--interval-minutes", "--open-tools-every", "--recipients"];
    const given: Record<string, string> = {};
    for (let at = 0; at < flags.length; at += 2) {
      const name = flags[at];
      const value = flags[at + 1];
      if (!known.includes(name) || value === undefined || value.startsWith("--") || name in given) throw Error("observe accepts each of " + known.join(", ") + " once, with a value.");
      given[name] = value;
    }
    const whole = (name: string, min: number, max: number) => {
      const value = given[name];
      if (value === undefined) return undefined;
      const number = Number(value);
      if (!/^\d+$/.test(value) || !Number.isSafeInteger(number) || number < min || number > max) throw Error(`${name} must be a whole number from ${min} to ${max}.`);
      return number;
    };
    const interval = whole("--interval-minutes", 5, 1440);
    const every = whole("--open-tools-every", 1, 1000);
    let recipients: string[] | undefined | null;
    if (given["--recipients"] !== undefined) {
      if (given["--recipients"] === "default") recipients = null;
      else {
        recipients = [...new Set(given["--recipients"].split(",").map((entry) => entry.trim()))];
        if (!recipients.length || recipients.some((entry) => !/^[^\s,|]+\|[^\s,|]+$/.test(entry))) throw Error("--recipients takes issuer|subject entries separated by commas, or default.");
      }
    }
    const before: ObservationConfig = config.observation ?? { enabled: false };
    const { recipients: kept, ...base } = before;
    const next: ObservationConfig = { ...base, enabled: mode === "on" };
    if (interval !== undefined) next.interval_minutes = interval;
    if (every !== undefined) next.open_tools_every = every;
    if (mode === "on") {
      next.interval_minutes ??= 10;
      next.open_tools_every ??= 3;
    }
    const chosen = recipients === undefined ? kept : recipients ?? undefined;
    config.observation = { ...next, ...(chosen?.length ? { recipients: chosen } : {}) };
    save(config);
    console.log(JSON.stringify({ observation: config.observation, network_called: false, next: "restart the control center to reload" }, null, 2));
  } else if (command === "connect") {
    const [id, owner, endpoint, project, credential_ref, ...flags] = args;
    if (
      !id ||
      !/^[-a-zA-Z0-9_]{1,80}$/.test(id) ||
      !["eikona", "sonora", "scaena", "anatomia"].includes(owner) ||
      !project ||
      !credential_ref
    )
      throw Error(
        "connect requires <id> <eikona|sonora|scaena|anatomia> <endpoint> <owner-project> <credential-file> [--private-http] [--content]",
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
    // The scope pins one default project per owner (delegated reads). Connecting another project of the same owner
    // used to replace that pin silently; it now stays unless --default is given. Every connected project can be bound
    // to shared projects either way.
    // Anatomia has no request projection, so there is no delegated-read default to pin.
    const pinned = c.owner === "anatomia" ? project : scope.owners[c.owner]?.project;
    if (c.owner !== "anatomia" && (!pinned || flags.includes("--default")))
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
    if (c.owner !== "anatomia" && pinned && pinned !== project && !flags.includes("--default"))
      console.log(`Kept ${c.owner} default project ${pinned}; pass --default to make ${project} the default.`);
  } else if (command === "auctra") {
    // Auctra refuses collection.* to every key but a service-collector one, and refuses everything else to that key, so the
    // stage read (creative.flow.read) needs a second, service-consumer key. One file is accepted for a single-token deployment.
    const [origin, project, collectorRef, readerRef, ...flags] = args.filter((arg) => arg !== "--replace");
    const replace = args.includes("--replace");
    if (!origin || !project || !collectorRef || flags.length)
      throw Error("auctra requires <https-origin|loopback-origin> <project:id> <collector-key-file> [reader-key-file] [--replace]");
    const auctraOrigin = clientOrigin(origin);
    if (!/^project:[^\s\\/\x00-\x1f]{1,256}$/.test(project)) throw Error("Auctra project must be the exact project ref, such as project:my-drama.");
    const keyFiles = [collectorRef, ...(readerRef ? [readerRef] : [])].map((ref) => resolve(ref));
    for (const keyFile of keyFiles) if (!existsSync(keyFile) || (statSync(keyFile).mode & 0o077)) throw Error("Auctra key files must exist and be 0600.");
    if (config.collection?.auctra && !replace) throw Error("Auctra collection already configured; pass --replace to change it.");
    const scope = config.principals.flatMap((p) => p.scopes).find((s) => s.id === "personal");
    if (!scope) throw Error("Personal scope missing.");
    config.collection = { ...config.collection, auctra: { origin: auctraOrigin, audience: "auctra", credential_ref: keyFiles[0], ...(keyFiles[1] ? { flow_credential_ref: keyFiles[1] } : {}), enabled: true } };
    scope.collection = { ...scope.collection, auctra: { tenant: project, project, actor: "personal", audience: "auctra" } };
    save(config);
    console.log(JSON.stringify({ origin: auctraOrigin, project, scope: scope.id, collector_key_configured: true, reader_key_configured: !!keyFiles[1], network_called: false, next: "restart the control center, then sync from Services" }, null, 2));
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
  } else if (command === "open-tool") {
    // A read-only open tool (DriveBridge, MCP Gateway) for the personal scope; `off` disables it and keeps the entry.
    const [tool, endpoint, credentialRef, ...flags] = args;
    const scope = config.principals.flatMap((p) => p.scopes).find((s) => s.id === "personal");
    if (!scope) throw Error("Personal scope missing.");
    if (!isOpenToolKind(tool) || !endpoint) throw Error("open-tool requires <drivebridge|gateway> <endpoint> <0600-credential-file> [--private-http] [--replace], or <drivebridge|gateway> off");
    if (endpoint === "off" && args.length === 2) {
      const existing = config.open_tools?.[tool];
      if (!existing) throw Error("Open tool not configured.");
      existing.enabled = false;
      scope.open_tools = (scope.open_tools || []).filter((kind) => kind !== tool);
      save(config);
      console.log(JSON.stringify({ tool, enabled: false, network_called: false, next: "restart the control center to reload" }, null, 2));
    } else {
      const unknown = flags.filter((flag) => !["--private-http", "--replace"].includes(flag));
      if (!credentialRef || unknown.length) throw Error("open-tool requires <drivebridge|gateway> <endpoint> <0600-credential-file> [--private-http] [--replace]");
      const allowPrivateHttp = flags.includes("--private-http");
      endpointURL(endpoint, allowPrivateHttp, "open_tool_endpoint_denied");
      const credential_ref = resolve(credentialRef);
      if (!existsSync(credential_ref) || (statSync(credential_ref).mode & 0o077)) throw Error("Open tool credential file must exist and be 0600.");
      if (config.open_tools?.[tool] && !flags.includes("--replace")) throw Error("Open tool already configured; pass --replace to change it.");
      config.open_tools = { ...config.open_tools, [tool]: { endpoint, credential_ref, ...(allowPrivateHttp ? { allow_private_http: true } : {}), enabled: true } };
      scope.open_tools = [...new Set([...(scope.open_tools || []), tool])];
      save(config);
      console.log(JSON.stringify({ tool, scope: scope.id, credential_configured: true, private_http: allowPrivateHttp, network_called: false, next: "restart the control center, then check Services" }, null, 2));
    }
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
      !["eikona", "sonora", "scaena", "anatomia"].includes(c.owner) ||
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
          open_tools: Object.fromEntries(Object.entries(config.open_tools || {}).map(([tool, entry]) => [tool, {
            enabled: entry?.enabled !== false,
            private_http: entry?.allow_private_http === true,
            credential_configured: !!entry?.credential_ref && existsSync(entry.credential_ref),
          }])),
          observation: config.observation ? {
            enabled: config.observation.enabled === true,
            interval_minutes: config.observation.interval_minutes ?? 10,
            open_tools_every: config.observation.open_tools_every ?? 3,
            recipients: config.observation.recipients ?? "default",
          } : null,
          // Like connections, the address stays out of status output; only whether each piece is in place.
          auctra: config.collection?.auctra ? {
            origin_configured: !!config.collection.auctra.origin,
            enabled: config.collection.auctra.enabled !== false,
            project: config.principals.flatMap((p) => p.scopes).find((s) => s.id === "personal")?.collection?.auctra?.project || null,
            collector_key_configured: !!config.collection.auctra.credential_ref && existsSync(config.collection.auctra.credential_ref),
            reader_key_configured: !!config.collection.auctra.flow_credential_ref && existsSync(config.collection.auctra.flow_credential_ref),
          } : null,
        },
        null,
        2,
      ),
    );
}
