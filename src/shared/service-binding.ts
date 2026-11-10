/** Exact service/project binding. A binding is an authorization fact, not a URL, credential or command. */
export const serviceProjectBindingSchemaVersion = "yeisme.service_project_binding.v1" as const;
export type ServiceBindingState = "ready" | "needs_contract" | "forbidden" | "unavailable" | "stale";

const refPattern = /^[A-Za-z0-9][A-Za-z0-9._:@-]{0,200}$/;
const secretKey = /(?:token|secret|password|credential|api[_-]?key|authorization|cookie|command|tool|payload|url|path)/i;

export interface ServiceProjectBinding {
  schema_version: typeof serviceProjectBindingSchemaVersion;
  service_id: string;
  scope_id: string;
  epoch: number;
  project_ref: string;
  binding_ref: string;
  state: ServiceBindingState;
  observed_at: string | null;
  digest: string | null;
  blocker?: "project_binding_missing" | "project_binding_mismatch" | "project_binding_invalid";
}

export interface ExactProjectBindingInput {
  service_id: string;
  scope_id: string;
  epoch: number;
  project_ref: string;
  binding_ref?: string;
  state?: ServiceBindingState;
  observed_at?: string | null;
  digest?: string | null;
}

function validRef(value: unknown): value is string {
  return typeof value === "string" && refPattern.test(value) && !value.includes("..");
}

function safeDigest(value: unknown): string | null {
  return typeof value === "string" && /^sha256:[0-9a-f]{64}$/.test(value) ? value : null;
}

/** Create one exact binding; callers cannot pass an endpoint, credential, tool or provider request. */
export function createExactProjectBinding(input: ExactProjectBindingInput): ServiceProjectBinding {
  const valid = validRef(input.service_id) && validRef(input.scope_id) && validRef(input.project_ref) && Number.isInteger(input.epoch) && input.epoch >= 0;
  const declaredState: ServiceBindingState = input.state && ["ready", "needs_contract", "forbidden", "unavailable", "stale"].includes(input.state) ? input.state : "needs_contract";
  let state: ServiceBindingState = declaredState;
  if (!valid) state = "needs_contract";
  const binding_ref = validRef(input.binding_ref) ? input.binding_ref : `${input.service_id}:${input.project_ref}`;
  const service_id = validRef(input.service_id) ? input.service_id : "unknown";
  const scope_id = validRef(input.scope_id) ? input.scope_id : "unknown";
  const project_ref = validRef(input.project_ref) ? input.project_ref : "unknown";
  const epoch = Number.isInteger(input.epoch) && input.epoch >= 0 ? input.epoch : 0;
  const observed_at = typeof input.observed_at === "string" && [...input.observed_at].every((character) => character >= " " && character !== "\\u007f") ? input.observed_at : null;
  let blocker: ServiceProjectBinding["blocker"];
  if (!valid) blocker = "project_binding_invalid";
  else if (state === "needs_contract") blocker = "project_binding_missing";
  return {
    schema_version: serviceProjectBindingSchemaVersion,
    service_id,
    scope_id,
    epoch,
    project_ref,
    binding_ref,
    state,
    observed_at,
    digest: safeDigest(input.digest),
    ...(blocker ? { blocker } : {}),
  };
}

/** Resolve only the exact requested project from a bounded binding list. Never chooses a default or first match. */
export function resolveExactProjectBinding(
  bindings: readonly ServiceProjectBinding[] | undefined,
  request: { service_id: string; scope_id: string; epoch: number; project_ref: string },
): ServiceProjectBinding {
  if (!validRef(request.service_id) || !validRef(request.scope_id) || !validRef(request.project_ref) || !Number.isInteger(request.epoch)) {
    return createExactProjectBinding({ ...request, state: "needs_contract" });
  }
  const matches = (bindings || []).filter((binding) => binding.service_id === request.service_id && binding.scope_id === request.scope_id && binding.project_ref === request.project_ref);
  if (matches.length !== 1) return createExactProjectBinding({ ...request, state: "needs_contract" });
  const match = matches[0];
  if (match.epoch !== request.epoch) return { ...match, state: "needs_contract", blocker: "project_binding_mismatch" };
  return match;
}

export function normalizeProjectBinding(raw: unknown): ServiceProjectBinding {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return createExactProjectBinding({ service_id: "unknown", scope_id: "unknown", epoch: 0, project_ref: "unknown" });
  const value = raw as Record<string, unknown>;
  // Deliberately drop all unrecognized fields: in particular URLs, paths, credentials, raw tools and payloads.
  const safeInput: ExactProjectBindingInput = {
    service_id: String(value.service_id ?? "unknown"),
    scope_id: String(value.scope_id ?? "unknown"),
    epoch: typeof value.epoch === "number" ? value.epoch : 0,
    project_ref: String(value.project_ref ?? "unknown"),
    binding_ref: typeof value.binding_ref === "string" ? value.binding_ref : undefined,
    state: ["ready", "needs_contract", "forbidden", "unavailable", "stale"].includes(value.state as string) ? value.state as ServiceBindingState : "needs_contract",
    observed_at: typeof value.observed_at === "string" ? value.observed_at : null,
    digest: typeof value.digest === "string" ? value.digest : null,
  };
  const binding = createExactProjectBinding(safeInput);
  if (Object.keys(value).some((key) => secretKey.test(key))) return { ...binding, state: "needs_contract", blocker: "project_binding_invalid" };
  return binding;
}

export function isExactProjectBinding(binding: ServiceProjectBinding, expected: { service_id: string; scope_id: string; epoch: number; project_ref: string }): boolean {
  return binding.state === "ready" && binding.service_id === expected.service_id && binding.scope_id === expected.scope_id && binding.epoch === expected.epoch && binding.project_ref === expected.project_ref;
}
