import type { CoverageState } from "../../src/request-visibility";
import {
  emptyOperationCounts,
  openToolNames,
  openToolProjectionSchema,
  type OpenToolCheck,
  type OpenToolKind,
  type OpenToolOperation,
  type OpenToolProjection,
  type OpenToolState,
} from "../../src/shared/open-tools";

const listLimit = 20;
const attentionWindowMs = 7 * 24 * 60 * 60 * 1000;

/**
 * Which of a tool's checks the adapter reads without the credential (`auth: false`), and which of the others only
 * mean the credential was not granted that read when they are refused. The adapters build their projections from this
 * list and the credential status reads the same one, so they cannot disagree about what a refusal says.
 */
export const openToolChecks: Record<OpenToolKind, { open: string[]; optional: string[] }> = {
  drivebridge: { open: ["health"], optional: [] },
  gateway: { open: ["health"], optional: ["usage"] },
};

/**
 * Whether a reading says anything about the credential: a read that needs it was answered, accepted or refused (401 or
 * 403), or the credential could not be read at all. A reading that only failed to get an answer (the network, a 5xx, a
 * 429, a route that is not there) says nothing, and a credential judged from it would be called fine, then refused again,
 * with every blip. The optional reads do not count: a refusal of one is about a scope the credential may simply lack.
 */
export function carriesCredentialVerdict(projection: Pick<OpenToolProjection, "tool" | "checks">): boolean {
  const reads = openToolChecks[projection.tool];
  return projection.checks.some((check) => !reads.open.includes(check.id) && !reads.optional.includes(check.id) && (check.state === "ok" || check.state === "forbidden"));
}

const coverageFor: Record<OpenToolState, CoverageState> = {
  ready: "complete",
  degraded: "partial",
  unavailable: "unavailable",
  forbidden: "forbidden",
  needs_contract: "needs_contract",
  rate_limited: "unavailable",
};

/** A tool that could not be read at all: no runs, no backends, only the reason. */
export function unreadableProjection(tool: OpenToolKind, label: string | undefined, state: Exclude<OpenToolState, "ready" | "degraded">, reason: string, checks: OpenToolCheck[] = []): OpenToolProjection {
  return {
    schema_version: openToolProjectionSchema,
    tool,
    label: label || openToolNames[tool],
    state,
    reason,
    observed_at: new Date().toISOString(),
    freshness: "unknown",
    checks,
    facts: [],
    operations: { recent: [], attention: [], counts: emptyOperationCounts(), coverage: coverageFor[state], reason },
    coverage: { state: coverageFor[state], reason },
  };
}

const failedOrUnknown = (operation: OpenToolOperation) => operation.state === "failed" || operation.state === "unknown";

/**
 * Newest first; attention keeps failed and unknown runs from the last 7 days. An adapter narrows attention when some
 * unknowns are only states it does not recognise, which are shown but not raised.
 */
export function summarizeOperations(operations: OpenToolOperation[], coverage: CoverageState, reason?: string, options: { attention?: (operation: OpenToolOperation) => boolean; now?: number } = {}): OpenToolProjection["operations"] {
  const now = options.now ?? Date.now();
  const raise = options.attention || failedOrUnknown;
  const sorted = [...operations].sort((a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at) || (a.ref < b.ref ? 1 : -1));
  const counts = emptyOperationCounts();
  for (const operation of sorted) counts[operation.state] += 1;
  const attention = sorted.filter((operation) => raise(operation) && now - Date.parse(operation.updated_at) <= attentionWindowMs);
  return { recent: sorted.slice(0, listLimit), attention: attention.slice(0, listLimit), counts, coverage, ...(reason ? { reason } : {}) };
}

/**
 * The tool's state from its checks. `primary` are the reads that need the credential: when none of them answers, the
 * first refusal among them decides (a revoked token is 无读取权限 even though the open health route still answers).
 * Otherwise a failed check, or an attention flag from the adapter such as a backend down, makes the tool degraded.
 */
export function stateFromChecks(checks: OpenToolCheck[], degraded: boolean, primary: string[] = checks.map((check) => check.id), optional: string[] = []): { state: OpenToolState; reason?: string } {
  const essential = checks.filter((check) => primary.includes(check.id));
  if (essential.length && essential.every((check) => check.state !== "ok")) {
    const first = essential.find((check) => check.state !== "failed") || essential[0];
    const state = first.state === "failed" ? "unavailable" : first.state as Exclude<OpenToolState, "ready" | "degraded">;
    return { state, reason: first.reason || "open_tool_unavailable" };
  }
  // An optional read the credential was simply not granted (usage without an audit scope) is not a fault.
  const problem = checks.find((check) => check.state !== "ok" && !(optional.includes(check.id) && check.state === "forbidden"));
  if (problem || degraded) return { state: "degraded", reason: problem?.reason || "open_tool_attention" };
  return { state: "ready" };
}

export function projection(input: {
  tool: OpenToolKind;
  label?: string;
  checks: OpenToolCheck[];
  /** Ids of the checks that need the credential; all checks when omitted. */
  primary?: string[];
  /** Checks whose refusal only means the credential was not granted that read. */
  optional?: string[];
  degraded?: boolean;
  degradedReason?: string;
  facts?: OpenToolProjection["facts"];
  operations: OpenToolProjection["operations"];
  backends?: OpenToolProjection["backends"];
  usage?: OpenToolProjection["usage"];
  coverage?: { state: CoverageState; reason?: string };
}): OpenToolProjection {
  const { state, reason } = stateFromChecks(input.checks, !!input.degraded, input.primary, input.optional);
  const why = state === "degraded" && input.degraded && reason === "open_tool_attention" ? input.degradedReason || reason : reason;
  return {
    schema_version: openToolProjectionSchema,
    tool: input.tool,
    label: input.label || openToolNames[input.tool],
    state,
    ...(why ? { reason: why } : {}),
    observed_at: new Date().toISOString(),
    freshness: "fresh",
    checks: input.checks,
    facts: input.facts || [],
    operations: input.operations,
    ...(input.backends ? { backends: input.backends } : {}),
    ...(input.usage ? { usage: input.usage } : {}),
    coverage: input.coverage || { state: coverageFor[state], ...(why ? { reason: why } : {}) },
  };
}
