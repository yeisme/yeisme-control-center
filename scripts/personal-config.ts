import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  existsSync,
  renameSync,
  rmSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { randomBytes } from "node:crypto";
import { hashPassword } from "../server/password";
import { secret } from "../server/auth";
import { connectionURL, endpointURL } from "../server/task-connections";
import { isOpenToolKind } from "../src/shared/open-tools";
import { clientOrigin } from "../src/task-links";
import { credentialReasonOf, type CredentialFileReason } from "../server/credential-file";
import { credentialHolder, credentialSlots, credentialStatuses } from "../server/credentials";
import { observationBounds, observationProblems } from "../server/observation-config";
import { isNeverExpires, neverExpires, parseRfc3339 } from "../src/shared/credentials";
import type { ServerConfig, TaskConnection, ProviderOwner, ObservationConfig } from "../server/contracts";
const [command, first, ...rest] = process.argv.slice(2);
const userActions = ["add", "list", "revoke", "rotate", "enable"];
// `user <config-file> add …` is the form every command uses; `user add <config-file> …` is accepted as well.
const [file, ...args] = command === "user" && userActions.includes(first) && rest.length ? [rest[0], first, ...rest.slice(1)] : [first, ...rest];
const usage =
  "Usage: bun scripts/personal-config.ts init|account|password|user|connect|auctra|provider|open-tool|credential|studio|cancel|content|disable|observe|status <config-file> [arguments]\n" +
  "Credential expiry: connect, open-tool, provider and auctra take [--expires-at <RFC3339|never> | --expires-in <N>d|<N>h] [--issued-at <RFC3339>], recorded next to the credential reference (for auctra the dates apply to both keys); never marks a credential that does not expire.\n" +
  "auctra also takes --private-http, like connect and open-tool: plain http to a private IPv4 address is accepted for its origin.\n" +
  "  credential <config-file> list | expiry <slot> <RFC3339|never|none> | replace <slot> <file> [--expires-at|--expires-in] [--issued-at]";
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
    "credential",
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
/**
 * An RFC 3339 date-time as a UTC ISO string. Seconds and a zone are required: a bare date or a local time is refused.
 * Only an expiry (`allowNever`) may also be the word `never`, kept as it is; nothing else that is not a time gets through.
 */
const instant = (value: string, name: string, allowNever = false) => {
  if (allowNever && isNeverExpires(value)) return neverExpires;
  const at = parseRfc3339(value);
  if (at === undefined) throw Error(`${name} must be an RFC 3339 time with seconds and a zone, such as 2026-11-30T00:00:00Z or 2026-11-30T23:59:59+08:00${allowNever ? ", or never for a credential that does not expire" : ""}.`);
  return new Date(at).toISOString();
};
/** Whether an issue time is before the expiry; a credential that never expires is issued before it. */
const issuedBefore = (issued: string, expires: string) => isNeverExpires(expires) || Date.parse(issued) < Date.parse(expires);
/**
 * A credential file the control center itself can use: it must pass `secret()`, the function the server reads it with,
 * so a missing, loose, unreadable, empty or blank file is refused here and not found out when a read fails. The content
 * is read to check it and never printed.
 */
const credentialFile = (file: string, what: string) => {
  const ref = resolve(file);
  try {
    secret(ref);
  } catch (error) {
    const problems: Record<CredentialFileReason, string> = {
      missing: "does not exist or cannot be reached",
      not_file: "is not a regular file",
      permissions: "must be mode 0600 (no group or other access) and readable by the user running this command",
      empty: "is empty or holds only whitespace",
    };
    throw Error(`${what} ${problems[credentialReasonOf(error) ?? "missing"]}.`);
  }
  return ref;
};
interface CredentialDates { expires?: string; issued?: string }
/** Takes `--expires-at`, `--expires-in` (exclusive with it) and `--issued-at` out of an argument list. */
const takeDates = (list: string[]) => {
  let rest = list;
  const take = (name: string) => {
    const taken = takeOption(rest, name);
    if (taken.rest.includes(name)) throw Error(`${name} may be given only once.`);
    rest = taken.rest;
    return taken.value;
  };
  const expiresAt = take("--expires-at");
  const expiresIn = take("--expires-in");
  const issuedAt = take("--issued-at");
  if (expiresAt !== undefined && expiresIn !== undefined) throw Error("--expires-at and --expires-in cannot be used together.");
  let lasting: number | undefined;
  if (expiresIn !== undefined) {
    const parts = /^([1-9]\d{0,4})([dh])$/.exec(expiresIn);
    if (!parts) throw Error("--expires-in takes <N>d or <N>h, such as 30d.");
    lasting = Number(parts[1]) * (parts[2] === "d" ? 86_400_000 : 3_600_000);
  }
  const dates: CredentialDates = {
    ...(expiresAt !== undefined ? { expires: instant(expiresAt, "--expires-at", true) } : lasting !== undefined ? { expires: new Date(Date.now() + lasting).toISOString() } : {}),
    ...(issuedAt !== undefined ? { issued: instant(issuedAt, "--issued-at") } : {}),
  };
  if (dates.expires && dates.issued && !issuedBefore(dates.issued, dates.expires)) throw Error("--issued-at must be earlier than the expiry.");
  return { rest, dates };
};
/** The dates as config keys next to a credential reference: `credential_*`, or `flow_credential_*` for Auctra's reader key. */
const datesFor = (dates: CredentialDates, prefix = "credential") => ({
  ...(dates.expires ? { [`${prefix}_expires_at`]: dates.expires } : {}),
  ...(dates.issued ? { [`${prefix}_issued_at`]: dates.issued } : {}),
});
/**
 * The dates to write beside a credential reference. New ones win; otherwise the recorded ones stay while the same file
 * stays (a re-run that only changes an endpoint or a model), and go when the file changes, because they described the
 * old credential.
 */
const datesToKeep = (given: CredentialDates, previous: object | undefined, sameFile: boolean, prefix = "credential"): CredentialDates => {
  const recorded = (previous ?? {}) as Record<string, unknown>;
  const kept = (key: string) => sameFile && typeof recorded[`${prefix}_${key}`] === "string" ? recorded[`${prefix}_${key}`] as string : undefined;
  const dates = { expires: given.expires ?? kept("expires_at"), issued: given.issued ?? kept("issued_at") };
  if (dates.expires && dates.issued && !issuedBefore(dates.issued, dates.expires)) throw Error("The issue time must be earlier than the expiry, counting the dates already recorded for this file.");
  return dates;
};
const hadExpiry = (entry: object | undefined, prefix = "credential") => !!entry && `${prefix}_expires_at` in entry;
/**
 * An owner origin: https or loopback http as `clientOrigin` has it. With `--private-http`, also plain http to a private
 * IPv4 address, by the rule `endpointURL` applies to open tools (127/8, 10/8, 172.16/12, 192.168/16); a public http
 * address stays refused, and so does anything that is not a bare origin.
 */
const originFor = (value: string, privateHttp: boolean) => {
  try {
    return clientOrigin(value);
  } catch (error) {
    if (!privateHttp) throw error;
  }
  try {
    const url = endpointURL(value, true, "invalid_client_origin");
    if (url.origin === value) return url.origin;
  } catch {
    // Falls through to the one message below.
  }
  throw Error("The origin must be https, loopback http, or with --private-http plain http to a private IPv4 address; give it without a path.");
};
/**
 * What a command says about the expiry it wrote: the date (and that it was carried over from the same file), or, with
 * none, a notice on how to record it and, if there was one, that it was cleared with the old file.
 */
const expiryReport = (written: CredentialDates, given: CredentialDates, slot: string, hadOne = false) => ({
  ...(written.expires ? { expires_at: written.expires, ...(given.expires ? {} : { expiry_kept: true }) } : {
    expiry_recorded: false,
    ...(hadOne ? { expiry_cleared: true } : {}),
    notice: (hadOne ? "The expiry recorded for the previous credential was cleared. Record the new one" : "No expiry is recorded, so the control center cannot warn before the credential runs out. Record it") + ` with: credential <config-file> expiry ${slot} <RFC3339> (or never, if the credential does not expire).`,
  }),
  ...(written.issued ? { issued_at: written.issued } : {}),
});
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
    if (!["on", "off"].includes(mode || "")) throw Error(`observe requires on|off [--interval-minutes N (${observationBounds.minIntervalMinutes}-${observationBounds.maxIntervalMinutes})] [--open-tools-every N (${observationBounds.minOpenToolsEvery}-${observationBounds.maxOpenToolsEvery})] [--recipients issuer|subject,... (at most ${observationBounds.maxRecipients})|default].`);
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
    // The bounds are the server's own: a block outside them would be read as switched off, so it is not written.
    const interval = whole("--interval-minutes", observationBounds.minIntervalMinutes, observationBounds.maxIntervalMinutes);
    const every = whole("--open-tools-every", observationBounds.minOpenToolsEvery, observationBounds.maxOpenToolsEvery);
    let recipients: string[] | undefined | null;
    if (given["--recipients"] !== undefined) {
      if (given["--recipients"] === "default") recipients = null;
      else {
        recipients = [...new Set(given["--recipients"].split(",").map((entry) => entry.trim()))];
        if (!recipients.length || recipients.some((entry) => !/^[^\s,|]+\|[^\s,|]+$/.test(entry))) throw Error("--recipients takes issuer|subject entries separated by commas, or default.");
        if (recipients.length > observationBounds.maxRecipients) throw Error(`--recipients takes at most ${observationBounds.maxRecipients} entries.`);
        if (recipients.some((entry) => entry.length > observationBounds.maxRecipientLength)) throw Error(`--recipients entries are at most ${observationBounds.maxRecipientLength} characters each.`);
      }
    }
    // A block that is not an object (a hand edit such as "yes") cannot be carried over, and no flag can repair what is not
    // an object, so it is refused by its code instead of being spread into the new block. `null` counts as no block, as on the server.
    const existing: unknown = config.observation;
    if (existing !== undefined && existing !== null && (typeof existing !== "object" || Array.isArray(existing))) {
      throw Error(`The observation block in the configuration is not an object (${observationProblems(existing).join(", ")}), and the server treats it as off; nothing was written. Correct or remove it in the file, then run observe again.`);
    }
    const before: ObservationConfig = (existing as ObservationConfig | null | undefined) ?? { enabled: false };
    const { recipients: kept, ...base } = before;
    const next: ObservationConfig = { ...base, enabled: mode === "on" };
    if (interval !== undefined) next.interval_minutes = interval;
    if (every !== undefined) next.open_tools_every = every;
    if (mode === "on") {
      next.interval_minutes ??= observationBounds.defaultIntervalMinutes;
      next.open_tools_every ??= observationBounds.defaultOpenToolsEvery;
    }
    const chosen = recipients === undefined ? kept : recipients ?? undefined;
    const observation: ObservationConfig = { ...next, ...(chosen?.length ? { recipients: chosen } : {}) };
    // The whole block, as the server will read it: the flags are checked above, this also catches a value an earlier hand edit left.
    const problems = observationProblems(observation);
    if (problems.length) throw Error(`The observation block would be invalid (${problems.join(", ")}), and the server treats an invalid block as off; nothing was written.`);
    config.observation = observation;
    save(config);
    console.log(JSON.stringify({ observation: config.observation, network_called: false, next: "restart the control center to reload" }, null, 2));
  } else if (command === "connect") {
    const { rest: connectArgs, dates } = takeDates(args);
    const [id, owner, endpoint, project, credential_ref, ...flags] = connectArgs;
    if (
      !id ||
      !/^[-a-zA-Z0-9_]{1,80}$/.test(id) ||
      !["eikona", "sonora", "scaena", "anatomia"].includes(owner) ||
      !project ||
      !credential_ref
    )
      throw Error(
        "connect requires <id> <eikona|sonora|scaena|anatomia> <endpoint> <owner-project> <credential-file> [--private-http] [--content] [--expires-at <RFC3339|never> | --expires-in <N>d|<N>h] [--issued-at <RFC3339>]",
      );
    const c: TaskConnection = {
      id,
      owner: owner as TaskConnection["owner"],
      instance_id: id,
      label: owner,
      environment: "personal",
      endpoint,
      project,
      credential_ref: credentialFile(credential_ref, "The credential file"),
      enabled: true,
      allow_private_http: flags.includes("--private-http"),
      allow_cancel: false,
      allow_content: flags.includes("--content"),
      ...datesFor(dates),
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
    console.log(dates.expires
      ? isNeverExpires(dates.expires) ? `Recorded that the credential never expires for connection:${id}.` : `Recorded credential expiry ${dates.expires} for connection:${id}.`
      : `No credential expiry recorded; add one with: credential <config-file> expiry connection:${id} <RFC3339> (or never, if the credential does not expire).`);
    if (c.owner !== "anatomia" && pinned && pinned !== project && !flags.includes("--default"))
      console.log(`Kept ${c.owner} default project ${pinned}; pass --default to make ${project} the default.`);
  } else if (command === "auctra") {
    // Auctra refuses collection.* to every key but a service-collector one, and refuses everything else to that key, so the
    // stage read (creative.flow.read) needs a second, service-consumer key. One file is accepted for a single-token deployment.
    // Dates given here apply to both keys; give the reader key its own afterwards with `credential <config-file> expiry collection:auctra:flow …`.
    const { rest: auctraArgs, dates } = takeDates(args);
    const [origin, project, collectorRef, readerRef, ...flags] = auctraArgs.filter((arg) => arg !== "--replace" && arg !== "--private-http");
    const replace = auctraArgs.includes("--replace");
    const privateHttp = auctraArgs.includes("--private-http");
    if (!origin || !project || !collectorRef || flags.length)
      throw Error("auctra requires <https-origin|loopback-origin> <project:id> <collector-key-file> [reader-key-file] [--private-http] [--replace] [--expires-at <RFC3339|never> | --expires-in <N>d|<N>h] [--issued-at <RFC3339>]");
    const auctraOrigin = originFor(origin, privateHttp);
    if (!/^project:[^\s\\/\x00-\x1f]{1,256}$/.test(project)) throw Error("Auctra project must be the exact project ref, such as project:my-drama.");
    const keyFiles = [credentialFile(collectorRef, "The Auctra collector key file"), ...(readerRef ? [credentialFile(readerRef, "The Auctra reader key file")] : [])];
    if (config.collection?.auctra && !replace) throw Error("Auctra collection already configured; pass --replace to change it.");
    const scope = config.principals.flatMap((p) => p.scopes).find((s) => s.id === "personal");
    if (!scope) throw Error("Personal scope missing.");
    // A key whose file stays keeps its recorded dates (an endpoint or project change is not a new credential).
    const previous = config.collection?.auctra;
    const collectorDates = datesToKeep(dates, previous, !!previous?.credential_ref && resolve(previous.credential_ref) === keyFiles[0]);
    const readerDates = datesToKeep(dates, previous, !!keyFiles[1] && !!previous?.flow_credential_ref && resolve(previous.flow_credential_ref) === keyFiles[1], "flow_credential");
    config.collection = { ...config.collection, auctra: { origin: auctraOrigin, audience: "auctra", credential_ref: keyFiles[0], ...datesFor(collectorDates), ...(keyFiles[1] ? { flow_credential_ref: keyFiles[1], ...datesFor(readerDates, "flow_credential") } : {}), ...(privateHttp ? { allow_private_http: true } : {}), enabled: true } };
    scope.collection = { ...scope.collection, auctra: { tenant: project, project, actor: "personal", audience: "auctra" } };
    save(config);
    console.log(JSON.stringify({ origin: auctraOrigin, project, scope: scope.id, collector_key_configured: true, reader_key_configured: !!keyFiles[1], private_http: privateHttp, network_called: false, ...expiryReport(collectorDates, dates, "collection:auctra", hadExpiry(previous)), ...(keyFiles[1] && readerDates.expires !== collectorDates.expires ? { reader_expires_at: readerDates.expires ?? null } : {}), next: "restart the control center, then sync from Services" }, null, 2));
  } else if (command === "provider") {
    const { rest: providerArgs, dates } = takeDates(args);
    const [owner, endpoint, project, credential_ref, model_ref, submit, status, ...rest] = providerArgs;
    if (!owner || !["eikona", "scaena", "sonora"].includes(owner) || !endpoint || !project || !credential_ref || !model_ref || !submit || providerArgs.length < 7)
      throw Error("provider requires <eikona|scaena|sonora> <https-mcp-endpoint> <project> <0600-credential-file> <model-ref> <submit-action> <status-action|-> [--expires-at <RFC3339|never> | --expires-in <N>d|<N>h] [--issued-at <RFC3339>]");
    const file = credentialFile(credential_ref, "The provider credential file");
    const allowedActions = new Set(["generate", "createVideoProviderTask", "voice.audition"]);
    if (!allowedActions.has(submit)) throw Error("Unsupported provider submit action.");
    const replaced = config.providers?.[owner as ProviderOwner];
    const written = datesToKeep(dates, replaced, !!replaced?.credential_ref && resolve(replaced.credential_ref) === file);
    const connection = {
      owner: owner as ProviderOwner,
      endpoint,
      project,
      credential_ref: file,
      ...datesFor(written),
      enabled: true,
      model_refs: [model_ref],
      action_manifest: {
        submit,
        ...(status && status !== "-" ? { status, reconcile: status } : {}),
      },
    };
    config.providers = { ...(config.providers || {}), [owner]: connection };
    save(config);
    console.log(JSON.stringify({ owner, endpoint, project, model_ref, submit, status: status === "-" ? null : status, credential_configured: true, network_called: false, ...expiryReport(written, dates, `provider:${owner}`, hadExpiry(replaced)) }, null, 2));
  } else if (command === "open-tool") {
    // A read-only open tool (DriveBridge, MCP Gateway) for the personal scope; `off` disables it and keeps the entry.
    const { rest: toolArgs, dates } = takeDates(args);
    const [tool, endpoint, credentialRef, ...flags] = toolArgs;
    const scope = config.principals.flatMap((p) => p.scopes).find((s) => s.id === "personal");
    if (!scope) throw Error("Personal scope missing.");
    if (!isOpenToolKind(tool) || !endpoint) throw Error("open-tool requires <drivebridge|gateway> <endpoint> <0600-credential-file> [--private-http] [--replace] [--expires-at <RFC3339|never> | --expires-in <N>d|<N>h] [--issued-at <RFC3339>], or <drivebridge|gateway> off");
    if (endpoint === "off" && toolArgs.length === 2) {
      if (args.length !== toolArgs.length) throw Error("open-tool off takes no expiry options.");
      const existing = config.open_tools?.[tool];
      if (!existing) throw Error("Open tool not configured.");
      existing.enabled = false;
      scope.open_tools = (scope.open_tools || []).filter((kind) => kind !== tool);
      save(config);
      console.log(JSON.stringify({ tool, enabled: false, network_called: false, next: "restart the control center to reload" }, null, 2));
    } else {
      const unknown = flags.filter((flag) => !["--private-http", "--replace"].includes(flag));
      if (!credentialRef || unknown.length) throw Error("open-tool requires <drivebridge|gateway> <endpoint> <0600-credential-file> [--private-http] [--replace] [--expires-at <RFC3339|never> | --expires-in <N>d|<N>h] [--issued-at <RFC3339>]");
      const allowPrivateHttp = flags.includes("--private-http");
      endpointURL(endpoint, allowPrivateHttp, "open_tool_endpoint_denied");
      const credential_ref = credentialFile(credentialRef, "The open tool credential file");
      if (config.open_tools?.[tool] && !flags.includes("--replace")) throw Error("Open tool already configured; pass --replace to change it.");
      const replaced = config.open_tools?.[tool];
      const written = datesToKeep(dates, replaced, !!replaced && resolve(replaced.credential_ref) === credential_ref);
      config.open_tools = { ...config.open_tools, [tool]: { endpoint, credential_ref, ...datesFor(written), ...(allowPrivateHttp ? { allow_private_http: true } : {}), enabled: true } };
      scope.open_tools = [...new Set([...(scope.open_tools || []), tool])];
      save(config);
      console.log(JSON.stringify({ tool, scope: scope.id, credential_configured: true, private_http: allowPrivateHttp, network_called: false, ...expiryReport(written, dates, `open_tool:${tool}`, hadExpiry(replaced)), next: "restart the control center, then check Services" }, null, 2));
    }
  } else if (command === "credential") {
    // Owners do not report when a credential expires, so it is recorded here, next to the reference it describes. A slot id
    // names one credential: connection:<id>, open_tool:<kind>, provider:<owner>, owner:<owner>, collection:auctra[:flow].
    const [action, slotId, ...more] = args;
    const slots = credentialSlots(config);
    const holderOf = (id: string | undefined) => {
      const holder = id ? credentialHolder(config, id) : undefined;
      if (!id || !holder) throw Error(`Unknown credential slot${id ? ` "${id}"` : ""}. Valid slots: ${slots.length ? slots.map((slot) => slot.id).join(", ") : "none configured"}.`);
      return holder;
    };
    if (action === "list") {
      if (args.length !== 1) throw Error("credential list takes no arguments.");
      // State comes from the file's metadata and the recorded expiry only; the running server adds what the owners answer.
      const rows = credentialStatuses(config, undefined, { includeDisabled: true }).map((row) => ({
        slot: row.id,
        owner: row.owner,
        enabled: slots.find((slot) => slot.id === row.id)?.enabled !== false,
        state: row.state,
        ...(row.reason ? { reason: row.reason } : {}),
        ...(row.never_expires ? { expires_at: neverExpires } : row.expires_at ? { expires_at: row.expires_at } : {}),
        ...(row.days_left !== undefined ? { days_left: row.days_left } : {}),
        ...(row.shared_with.length ? { shared_with: row.shared_with } : {}),
      }));
      console.log(JSON.stringify({ credentials: rows, network_called: false }, null, 2));
    } else if (action === "expiry") {
      const [value, ...extra] = more;
      if (!slotId || value === undefined || extra.length) throw Error("credential expiry requires <slot> <RFC3339|never|none>.");
      const holder = holderOf(slotId);
      const expires = value === "none" ? undefined : instant(value, "The expiry", true);
      const issued = holder.target[holder.issuedKey];
      if (expires && typeof issued === "string" && !issuedBefore(issued, expires)) throw Error("The expiry must be later than the recorded issue time.");
      if (expires) holder.target[holder.expiresKey] = expires;
      else delete holder.target[holder.expiresKey];
      save(config);
      // Every slot records its own expiry, so a file several slots share has to be told to each of them.
      const file = resolve(String(holder.target[holder.refKey]));
      const sharing = slots.filter((slot) => slot.id !== slotId && resolve(slot.ref) === file).map((slot) => slot.id);
      console.log(JSON.stringify({ slot: slotId, ...(expires ? { expires_at: expires } : { expiry_recorded: false }), network_called: false, ...(sharing.length ? { shared_with: sharing, notice: `These slots use the same credential file and each records its own expiry: ${sharing.join(", ")}. Set the same one on them if it applies.` } : {}), next: "restart the control center to reload" }, null, 2));
    } else if (action === "replace") {
      const { rest: replaceArgs, dates } = takeDates(more);
      const [fileArg, ...extra] = replaceArgs;
      if (!slotId || !fileArg || extra.length) throw Error("credential replace requires <slot> <credential-file> [--expires-at <RFC3339|never> | --expires-in <N>d|<N>h] [--issued-at <RFC3339>].");
      const holder = holderOf(slotId);
      const next = credentialFile(fileArg, "The new credential file");
      const previous = resolve(String(holder.target[holder.refKey]));
      // Other slots on the old file keep using it; they are named so they are not forgotten.
      const sharing = slots.filter((slot) => slot.id !== slotId && resolve(slot.ref) === previous).map((slot) => slot.id);
      const cleared = !!holder.target[holder.expiresKey];
      holder.target[holder.refKey] = next;
      // The old dates described the old credential: they go, unless this command gives new ones.
      delete holder.target[holder.expiresKey];
      delete holder.target[holder.issuedKey];
      if (dates.expires) holder.target[holder.expiresKey] = dates.expires;
      if (dates.issued) holder.target[holder.issuedKey] = dates.issued;
      save(config);
      console.log(JSON.stringify({ slot: slotId, credential_configured: true, network_called: false, ...expiryReport(dates, dates, slotId, cleared), ...(sharing.length ? { still_using_previous_file: sharing } : {}), next: "restart the control center to reload" }, null, 2));
    } else throw Error("credential requires list | expiry <slot> <RFC3339|never|none> | replace <slot> <credential-file> [--expires-at|--expires-in] [--issued-at].");
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
