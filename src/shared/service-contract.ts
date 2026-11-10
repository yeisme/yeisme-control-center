import { normalizeCapabilitySnapshot, type ServiceCapabilitySnapshot } from "./service-capability";
import { normalizeProjectBinding, type ServiceProjectBinding } from "./service-binding";
import { normalizeServiceLaunchContext, type ServiceLaunchContext } from "./service-launch-context";
import { normalizeServiceManifest, type ServiceManifest } from "./service-manifest";

export interface NormalizedServiceContract {
  manifest: ServiceManifest;
  capability_snapshot: ServiceCapabilitySnapshot;
  project_binding: ServiceProjectBinding;
  launch_context: ServiceLaunchContext;
  state: "ready" | "needs_contract";
}

/** Normalize the four-part catalog entry without exposing arbitrary owner input. */
export function normalizeServiceContract(raw: unknown): NormalizedServiceContract {
  const value = raw && typeof raw === "object" && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
  const manifest = normalizeServiceManifest(value.manifest);
  const capability_snapshot = normalizeCapabilitySnapshot(value.capability_snapshot);
  const project_binding = normalizeProjectBinding(value.project_binding);
  const launch_context = normalizeServiceLaunchContext(value.launch_context);
  const state = manifest.state === "ready" && capability_snapshot.state === "ready" && project_binding.state === "ready" && launch_context.service_id !== "unknown" ? "ready" : "needs_contract";
  return { manifest, capability_snapshot, project_binding, launch_context, state };
}

export function serviceContractState(contract: Pick<NormalizedServiceContract, "manifest" | "capability_snapshot" | "project_binding" | "launch_context">): "ready" | "needs_contract" {
  return contract.manifest.state === "ready" && contract.capability_snapshot.state === "ready" && contract.project_binding.state === "ready" && contract.launch_context.service_id !== "unknown" ? "ready" : "needs_contract";
}
