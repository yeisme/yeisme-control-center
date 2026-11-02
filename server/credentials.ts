import { resolve } from "node:path";
import type { ScopeBinding, ServerConfig, Session, TaskConnection } from "./contracts";
import { credentialFileProblem, statCredentialFile, type CredentialStat } from "./credential-file";
import { openToolChecks } from "./open-tools/projection";
import { serviceDefinitions } from "../src/service-directory";
import type { TaskConnectionState } from "../src/task-observation";
import { openToolKinds, openToolNames, type OpenToolProjection } from "../src/shared/open-tools";
import { dayMs, expiringDays, parseRfc3339, type CredentialReason, type CredentialStage, type CredentialState, type CredentialStatus } from "../src/shared/credentials";

/**
 * Credential slots and their status. Owners do not report when a credential expires, so whoever issues one records the
 * expiry next to its `credential_ref` in config.json (`personal-config credential …`), and this module turns that
 * record, the file's metadata and the latest observations into one row per slot. Pure: it reads file metadata through
 * `stat`, never a file's content, makes no network call and keeps paths, addresses and tokens out of every row.
 */

const providerOwners = ["eikona", "scaena", "sonora"] as const;

/** One configured credential, with the config object that holds its reference and dates (for the CLI to write). */
interface SlotEntry {
  id: string;
  owner: string;
  label: string;
  enabled: boolean;
  target: Record<string, unknown>;
  refKey: string;
  expiresKey: string;
  issuedKey: string;
}

export interface CredentialSlot {
  id: string;
  owner: string;
  label: string;
  /** The credential file. Server side only: it is never part of a status row. */
  ref: string;
  /** False for a connection, tool or provider that is switched off; its credential is not in use. */
  enabled: boolean;
  expires_at?: string;
  issued_at?: string;
}

const nameOf = (id: string) => serviceDefinitions.find((definition) => definition.id === id)?.name || id;
const text = (value: unknown) => typeof value === "string" && value ? value : undefined;

/**
 * With a scope, a slot is listed only when this scope uses its credential: its own connections and open tools, an owner
 * or provider the scope binds, Auctra when the scope has an Auctra project. Without one (the command line) every
 * configured credential is. `connections` is the scope's connection list when the caller has it, which includes the tool
 * projects registered from the control center; those copy their template's credential file and dates.
 */
function slotEntries(config: ServerConfig, scope?: ScopeBinding, connections?: TaskConnection[]): SlotEntry[] {
  const entries: SlotEntry[] = [];
  const lifecycle = { expiresKey: "credential_expires_at", issuedKey: "credential_issued_at" };
  const listed = connections ?? (config.connections || []).filter((connection) => !scope || scope.connection_ids?.includes(connection.id));
  for (const connection of listed) {
    entries.push({ id: `connection:${connection.id}`, owner: connection.owner, label: connection.label || connection.id, enabled: connection.enabled !== false, target: connection as unknown as Record<string, unknown>, refKey: "credential_ref", ...lifecycle });
  }
  for (const kind of openToolKinds) {
    const tool = config.open_tools?.[kind];
    if (!tool || (scope && !scope.open_tools?.includes(kind))) continue;
    entries.push({ id: `open_tool:${kind}`, owner: kind, label: tool.label || openToolNames[kind], enabled: tool.enabled !== false, target: tool as unknown as Record<string, unknown>, refKey: "credential_ref", ...lifecycle });
  }
  const bound = (owner: string) => !scope || !!(scope.owners as Record<string, unknown>)[owner];
  for (const owner of providerOwners) {
    const provider = config.providers?.[owner];
    if (provider && bound(owner)) entries.push({ id: `provider:${owner}`, owner, label: `${nameOf(owner)} 生成`, enabled: provider.enabled !== false, target: provider as unknown as Record<string, unknown>, refKey: "credential_ref", ...lifecycle });
  }
  for (const [owner, target] of Object.entries(config.owners || {})) {
    if (target && bound(owner)) entries.push({ id: `owner:${owner}`, owner, label: `${nameOf(owner)} 请求读取`, enabled: true, target: target as unknown as Record<string, unknown>, refKey: "credential_ref", ...lifecycle });
  }
  const auctra = config.collection?.auctra;
  if (auctra && (!scope || scope.collection?.auctra)) {
    const target = auctra as unknown as Record<string, unknown>;
    entries.push({ id: "collection:auctra", owner: "auctra", label: "Auctra 收集密钥", enabled: auctra.enabled !== false, target, refKey: "credential_ref", ...lifecycle });
    entries.push({ id: "collection:auctra:flow", owner: "auctra", label: "Auctra 阶段读取密钥", enabled: auctra.enabled !== false, target, refKey: "flow_credential_ref", expiresKey: "flow_credential_expires_at", issuedKey: "flow_credential_issued_at" });
  }
  return entries.filter((entry) => text(entry.target[entry.refKey]));
}

/** Every credential a scope uses (see `slotEntries`), or every configured one when there is no scope. */
export function credentialSlots(config: ServerConfig, scope?: ScopeBinding, connections?: TaskConnection[]): CredentialSlot[] {
  return slotEntries(config, scope, connections).map((entry) => ({
    id: entry.id,
    owner: entry.owner,
    label: entry.label,
    ref: String(entry.target[entry.refKey]),
    enabled: entry.enabled,
    ...(text(entry.target[entry.expiresKey]) ? { expires_at: String(entry.target[entry.expiresKey]) } : {}),
    ...(text(entry.target[entry.issuedKey]) ? { issued_at: String(entry.target[entry.issuedKey]) } : {}),
  }));
}

/**
 * Whether a session is a personal administrator: the rule `SessionAuth.role` applies, from the configuration alone, so
 * the service directory can decide who gets credential rows without the auth object.
 */
export function isPersonalAdmin(config: ServerConfig, session: Pick<Session, "personal" | "issuer" | "subject">): boolean {
  if (!session.personal || session.issuer !== "yeisme:personal") return false;
  const user = config.personal?.users?.find((candidate) => candidate.enabled !== false && candidate.username === session.subject);
  if (user) return user.role === "admin";
  return config.auth_mode === "personal" && !!config.personal && session.subject === (config.personal.username || "owner") && config.personal.role === "admin";
}

/** Where a slot's reference and dates live, so `personal-config` can change them; undefined for an unknown slot. */
export function credentialHolder(config: ServerConfig, id: string): Pick<SlotEntry, "target" | "refKey" | "expiresKey" | "issuedKey"> | undefined {
  const entry = slotEntries(config).find((candidate) => candidate.id === id);
  return entry && { target: entry.target, refKey: entry.refKey, expiresKey: entry.expiresKey, issuedKey: entry.issuedKey };
}

export interface CredentialStatusInput {
  /** Latest task connection observations; a slot without one is judged by its file and expiry alone. */
  connections?: TaskConnectionState[];
  /** The scope's connections as the connection catalog lists them (tool projects included); default: the configured ones the scope names. */
  scopeConnections?: TaskConnection[];
  openTools?: OpenToolProjection[];
  now?: number;
  /** File metadata lookup; tests inject theirs. */
  stat?: CredentialStat;
  /** Rows for switched-off slots too; the server leaves them out, `personal-config credential list` shows them. */
  includeDisabled?: boolean;
}

interface Observed {
  /** The control center could not read its own credential file when it last tried, whatever the file looks like now. */
  unreadable?: true;
  rejected?: CredentialReason;
  limited?: CredentialReason;
  accepted?: string;
}

function observeConnection(observation: TaskConnectionState | undefined): Observed {
  const runtime = observation?.runtime;
  if (!runtime) return {};
  if (runtime.state === "credential_unreadable" || runtime.reason === "credential_unreadable") return { unreadable: true };
  return {
    ...(runtime.authorization === "denied" ? { rejected: "owner_denied" as const } : runtime.content === "denied" ? { limited: "content_denied" as const } : {}),
    ...(runtime.last_success_at ? { accepted: runtime.last_success_at } : {}),
  };
}

/**
 * Only reads that carry the credential say anything about it (`health` is read without one). A 401 on a read the
 * credential is expected to pass means the tool does not recognise it, and then nothing was accepted; every such read
 * refused with 403 is the adapter's own `forbidden` verdict. A refusal of a read the credential may simply not be
 * granted (Gateway usage without an audit scope), or of only some reads, leaves it accepted but limited.
 */
function observeOpenTool(projection: OpenToolProjection | undefined): Observed {
  if (!projection) return {};
  const reads = openToolChecks[projection.tool];
  const credentialed = projection.checks.filter((check) => !reads.open.includes(check.id));
  const expected = credentialed.filter((check) => !reads.optional.includes(check.id));
  if (credentialed.some((check) => check.reason === "open_tool_credential_unreadable")) return { unreadable: true };
  if (expected.some((check) => check.reason === "open_tool_unauthenticated")) return { rejected: "unauthenticated" };
  if (projection.state === "forbidden" && projection.reason === "open_tool_forbidden") return { rejected: "forbidden" };
  const accepted = projection.freshness === "fresh" && credentialed.some((check) => check.state === "ok") ? { accepted: projection.observed_at } : {};
  return credentialed.some((check) => check.state === "forbidden") ? { limited: "read_forbidden", ...accepted } : accepted;
}

export function credentialStatuses(config: ServerConfig, scope: ScopeBinding | undefined, input: CredentialStatusInput = {}): CredentialStatus[] {
  const now = input.now ?? Date.now();
  const stat = input.stat ?? statCredentialFile;
  // A switched-off connection or tool does not use its credential, so it has nothing to expire or be refused.
  const slots = credentialSlots(config, scope, input.scopeConnections).filter((slot) => slot.enabled || input.includeDisabled);
  const fileOf = (slot: CredentialSlot) => resolve(slot.ref);
  const byFile = new Map<string, string[]>();
  for (const slot of slots) byFile.set(fileOf(slot), [...(byFile.get(fileOf(slot)) || []), slot.id]);
  return slots.map((slot): CredentialStatus => {
    const observed = slot.id.startsWith("connection:") ? observeConnection(input.connections?.find((observation) => observation.id === slot.id.slice("connection:".length)))
      : slot.id.startsWith("open_tool:") ? observeOpenTool(input.openTools?.find((projection) => projection.tool === slot.owner))
      : {};
    const expiresAt = slot.expires_at ? parseRfc3339(slot.expires_at) : undefined;
    const remaining = expiresAt === undefined ? undefined : expiresAt - now;
    const problem = credentialFileProblem(slot.ref, stat);
    let state: CredentialState;
    let reason: CredentialReason | undefined;
    let stage: CredentialStage | undefined;
    if (problem) {
      state = "unreadable";
      reason = problem;
    } else if (observed.unreadable) {
      state = "unreadable";
      reason = "read_failed";
    } else if (observed.rejected) {
      state = "rejected";
      reason = observed.rejected;
    } else if (remaining !== undefined && remaining <= 0) {
      state = "expired";
    } else if (remaining !== undefined && remaining <= expiringDays * dayMs) {
      state = "expiring";
      stage = remaining <= dayMs ? "1d" : "7d";
    } else if (observed.limited) {
      state = "limited";
      reason = observed.limited;
    } else {
      state = remaining !== undefined ? "ok" : "unknown_expiry";
      // A recorded expiry that cannot be read (no zone, not a date) is a mistake to fix, not the same as none.
      if (remaining === undefined && slot.expires_at) reason = "invalid_expiry";
    }
    return {
      id: slot.id,
      owner: slot.owner,
      label: slot.label,
      state,
      ...(reason ? { reason } : {}),
      ...(stage ? { stage } : {}),
      ...(remaining !== undefined && expiresAt !== undefined ? { expires_at: new Date(expiresAt).toISOString() } : {}),
      ...(remaining !== undefined && remaining > 0 ? { days_left: Math.ceil(remaining / dayMs) } : {}),
      ...(observed.accepted ? { last_accepted_at: observed.accepted } : {}),
      shared_with: (byFile.get(fileOf(slot)) || []).filter((id) => id !== slot.id),
    };
  });
}
