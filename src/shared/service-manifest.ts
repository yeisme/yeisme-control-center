/** Shared, redacted service registration contract. A manifest describes a service; it never contains a route, credential, command or provider payload. */
export const serviceManifestSchemaVersion = "yeisme.service_manifest.v1" as const;

export const serviceManifestKinds = ["service", "local_tool", "workspace", "design"] as const;
export type ServiceManifestKind = (typeof serviceManifestKinds)[number];
export const serviceManifestIntegrations = ["task_observation", "request_projection", "collection_projection", "operation_projection", "not_integrated"] as const;
export type ServiceManifestIntegration = (typeof serviceManifestIntegrations)[number];
export const serviceContractParts = ["manifest", "capability_snapshot", "project_binding", "launch_context"] as const;
export type ServiceContractPart = (typeof serviceContractParts)[number];
export type ServiceContractPartState = "ready" | "needs_contract";
export type ServiceManifestState = "ready" | "needs_contract";

const idPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,120}$/;
const pathPattern = /^[A-Za-z0-9][A-Za-z0-9._-]*(?:\/[A-Za-z0-9][A-Za-z0-9._-]*)*$/;
const text = (value: unknown, max: number) => typeof value === "string" && value.trim() && value.length <= max ? value.trim() : null;

export interface ServiceManifest {
  schema_version: typeof serviceManifestSchemaVersion;
  service_id: string;
  name: string;
  kind: ServiceManifestKind;
  owner_path: string;
  purpose: string;
  integration: ServiceManifestIntegration;
  contract: Record<ServiceContractPart, ServiceContractPartState>;
  state: ServiceManifestState;
  blocker?: "service_contract_missing";
}

export interface ServiceManifestInput {
  service_id: string;
  name: string;
  kind: ServiceManifestKind;
  owner_path: string;
  purpose: string;
  integration: ServiceManifestIntegration;
  contract?: Partial<Record<ServiceContractPart, ServiceContractPartState>>;
}

/** Build a manifest from read-only directory metadata; unknown contract parts fail closed. */
export function createServiceManifest(input: ServiceManifestInput): ServiceManifest {
  const contract = serviceContractParts.reduce((result, part) => {
    result[part] = input.contract?.[part] === "ready" ? "ready" : "needs_contract";
    return result;
  }, {} as Record<ServiceContractPart, ServiceContractPartState>);
  contract.manifest = "ready";
  const state: ServiceManifestState = Object.values(contract).every((value) => value === "ready") ? "ready" : "needs_contract";
  return {
    schema_version: serviceManifestSchemaVersion,
    service_id: input.service_id,
    name: input.name,
    kind: input.kind,
    owner_path: input.owner_path,
    purpose: input.purpose,
    integration: input.integration,
    contract,
    state,
    ...(state === "needs_contract" ? { blocker: "service_contract_missing" as const } : {}),
  };
}

/** Normalize untrusted catalog/directory input without carrying arbitrary paths, URLs, secrets or payloads. */
export function normalizeServiceManifest(raw: unknown): ServiceManifest {
  const value = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
  const service_id = text(value.service_id ?? value.id, 121);
  const name = text(value.name ?? value.label, 160);
  const owner_path = text(value.owner_path, 160);
  const purpose = text(value.purpose, 600);
  const kind = serviceManifestKinds.includes(value.kind as ServiceManifestKind) ? value.kind as ServiceManifestKind : null;
  const integration = serviceManifestIntegrations.includes(value.integration as ServiceManifestIntegration) ? value.integration as ServiceManifestIntegration : null;
  if (!service_id || !idPattern.test(service_id) || !name || !owner_path || !pathPattern.test(owner_path) || !purpose || !kind || !integration) {
    return {
      schema_version: serviceManifestSchemaVersion,
      service_id: service_id && idPattern.test(service_id) ? service_id : "unknown",
      name: name || "Unknown service",
      kind: kind || "service",
      owner_path: owner_path && pathPattern.test(owner_path) ? owner_path : "unknown",
      purpose: purpose || "Service contract not published",
      integration: integration || "not_integrated",
      contract: { manifest: "needs_contract", capability_snapshot: "needs_contract", project_binding: "needs_contract", launch_context: "needs_contract" },
      state: "needs_contract",
      blocker: "service_contract_missing",
    };
  }
  return createServiceManifest({ service_id, name, kind, owner_path, purpose, integration, contract: value.contract as ServiceManifestInput["contract"] });
}

export function serviceManifestReady(manifest: ServiceManifest): boolean {
  return manifest.state === "ready" && Object.values(manifest.contract).every((value) => value === "ready");
}
