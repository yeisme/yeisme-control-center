/**
 * yeisme.agent_monitor.v1 — a redacted join between a gateway call and a domain task.
 * A link exists only when `origin_refs.gateway_call_ref` equals the gateway `call_ref`.
 * Time proximity is not a join. Free-text actors never become `agent`.
 */
export const agentMonitorSchema = "yeisme.agent_monitor.v1" as const;

const refPattern = /^[A-Za-z0-9_.:-]{1,128}$/;

export interface AgentOriginRefs {
  gateway_call_ref?: string;
  mcp_session_ref?: string;
  run_identity_purpose?: string;
}

export interface AgentCallLink {
  call_ref: string;
  task_ref: string;
  owner: string;
  actor_type: "human" | "agent" | "service" | "unknown";
}

export function safeOriginRef(value: unknown): string | undefined {
  return typeof value === "string" && refPattern.test(value) ? value : undefined;
}

/** Exact call_ref match only. Tasks without a verified origin ref are omitted. */
export function linkCallsToTasks(
  calls: { call_ref: string }[],
  tasks: { task_ref: string; owner: string; actor_type?: "human" | "agent" | "service" | "unknown"; origin_refs?: AgentOriginRefs }[],
): AgentCallLink[] {
  const byCall = new Map(calls.filter((call) => safeOriginRef(call.call_ref)).map((call) => [call.call_ref, call]));
  const links: AgentCallLink[] = [];
  for (const task of tasks) {
    const callRef = safeOriginRef(task.origin_refs?.gateway_call_ref);
    if (!callRef || !byCall.has(callRef)) continue;
    links.push({
      call_ref: callRef,
      task_ref: task.task_ref,
      owner: task.owner,
      actor_type: task.actor_type || "unknown",
    });
  }
  return links;
}
