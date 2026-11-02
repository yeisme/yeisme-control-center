import type { ScopeBinding } from "./contracts";
import { credentialStatuses } from "./credentials";
import { credentialEventKey, type CredentialReading, type CredentialReminderFact, type ObservationServices } from "./observation-loop";
import { credentialStateLabels, isCredentialProblem, type CredentialStatus } from "../src/shared/credentials";
import type { OpenToolProjection } from "../src/shared/open-tools";
import type { TaskConnectionState } from "../src/task-observation";

/**
 * The credential problems the background loop reminds about. They come from `credentialStatuses()` over what the control
 * center already knows, never over a fresh read: the latest task connection observations and the open tool readings that
 * said something about the credential are taken from memory (`TaskConnections.cached`, `OpenToolService.credentialProjections`),
 * the rest is file metadata and the expiry that was recorded, so working out the facts costs no owner request and cannot
 * be a way to spend the loop's budget.
 */

/** How close an expiring credential is, in a title: the stages `credentialStatuses` reports. */
const stageWords: Record<string, string> = { "7d": "7 天内", "1d": "1 天内" };

/** "MCP Gateway · 凭据被拒", "DriveBridge · 即将到期（7 天内）": the label of the slot, then what is wrong with it. */
export function credentialTitle(row: Pick<CredentialStatus, "label" | "state" | "stage">) {
  const what = row.state === "expiring" ? `${credentialStateLabels.expiring}（${stageWords[row.stage ?? ""] ?? stageWords["7d"]}）` : credentialStateLabels[row.state];
  return `${row.label} · ${what}`;
}

/**
 * One reminder fact per credential that needs attention: unreadable, rejected, expired, expiring (at its 7-day or 1-day
 * stage) or limited. The slot, state and stage are the reminder's identity, so each step of a credential's decline is its
 * own reminder; `error_code` is the reason the row gave. A credential that is fine, or only has no recorded expiry, has none.
 */
export function credentialFacts(rows: readonly CredentialStatus[]): CredentialReminderFact[] {
  return rows.filter((row) => isCredentialProblem(row.state)).map((row) => ({
    slot: row.id,
    state: row.state,
    stage: row.stage ?? "-",
    title: credentialTitle(row),
    owner: row.owner,
    ...(row.reason ? { error_code: row.reason } : {}),
  }));
}

/**
 * The states only a reading of the owner can show. The file and the recorded expiry are known every cycle, so a
 * reminder about those is ended as soon as they stop holding; one about these is ended on a reading that says it is over.
 */
const observedStates = ["rejected", "unreadable", "limited"] as const;
const accessStates = ["rejected", "unreadable"] as const;

/**
 * Whether a cached connection observation says whether the owner accepts the credential: it was refused, it could not
 * be read, or a read went through with it. One whose reads all failed to get an answer says nothing.
 */
function accessKnown(entry: TaskConnectionState): boolean {
  const runtime = entry.runtime;
  if (!runtime) return false;
  return runtime.authorization === "verified" || runtime.authorization === "denied"
    || runtime.state === "credential_unreadable" || runtime.reason === "credential_unreadable"
    || !!runtime.last_success_at;
}

/**
 * Which observed states a slot has no reading of this cycle, so a reminder under them must stay. A connection nothing has
 * read since the process started (the memory of a refusal is not kept across a restart, and a cycle reads only as many
 * connections as its budget allows) and an open tool whose readings so far got no answer are unknown for all of them.
 * A connection that has been read but never got an answer is unknown for the refusal and the unreadable file only;
 * whether its content is refused is answered by the content reads that happened since the process started.
 */
function unknownStates(row: CredentialStatus, connections: readonly TaskConnectionState[], openTools: readonly OpenToolProjection[]): readonly string[] {
  if (row.id.startsWith("connection:")) {
    const entry = connections.find((candidate) => candidate.id === row.id.slice("connection:".length));
    if (!entry) return observedStates;
    return accessKnown(entry) ? [] : accessStates;
  }
  if (row.id.startsWith("open_tool:")) return openTools.some((projection) => projection.tool === row.owner) ? [] : observedStates;
  return [];
}

/** The event keys of the reminders a cycle must not end for want of a reading: see `CredentialReading`. */
export function credentialUnknown(rows: readonly CredentialStatus[], connections: readonly TaskConnectionState[], openTools: readonly OpenToolProjection[]): string[] {
  return rows.flatMap((row) => unknownStates(row, connections, openTools).map((state) => credentialEventKey({ slot: row.id, state, stage: "-" })));
}

/** The loop's `credentials` option: the facts of one observed scope, and what it has no reading of. Makes no owner request. */
export function credentialReminders(services: Pick<ObservationServices, "config" | "tasks" | "openTools">) {
  return (nowMs: number, scope: ScopeBinding): CredentialReading => {
    const connections = services.tasks.cached(scope);
    const openTools = services.openTools.credentialProjections(scope);
    const rows = credentialStatuses(services.config, scope, { connections, scopeConnections: services.tasks.connections(scope), openTools, now: nowMs });
    return { facts: credentialFacts(rows), unknown: credentialUnknown(rows, connections, openTools) };
  };
}
