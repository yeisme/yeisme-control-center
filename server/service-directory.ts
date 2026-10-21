import { serviceDefinitions, type ServiceDirectory, type ServiceDirectoryEntry } from "../src/service-directory";
import type { ScopeBinding, ServerConfig, Session } from "./contracts";
import type { TaskConnectionState } from "../src/task-observation";

/**
 * Aggregates per-service freshness from live connection observations.
 * A configured request-owner is only "partial": configuration is known but the
 * owner read path has not been verified in this request.
 */
function freshness(
  observations: TaskConnectionState[],
  requestConfigured: boolean,
): Pick<ServiceDirectoryEntry, "observed_at" | "coverage"> {
  const times = observations
    .map((o) => o.observed_at)
    .filter((v): v is string => !!v)
    .sort();
  const observed_at = times[times.length - 1];
  if (observations.length) {
    const states = observations.flatMap((o) => [
      o.state,
      ...Object.values(o.runtime?.channels || {}).map((channel) => channel?.state || ""),
    ]);
    const ready = states.every((s) => s === "ready");
    return {
      observed_at,
      coverage: {
        state: ready ? "complete" : states.some((state) => ["needs_contract", "owner_action_contract_missing"].includes(state)) ? "needs_contract" : states.some((state) => ["forbidden", "needs_authorization"].includes(state)) ? "forbidden" : states.some((state) => ["source_unavailable", "source_rate_limited", "source_busy"].includes(state)) ? "unavailable" : "partial",
        observed_at,
      },
    };
  }
  if (requestConfigured) return { coverage: { state: "partial", observed_at } };
  return { coverage: { state: "not_recorded", observed_at } };
}

export function serviceDirectory(config: ServerConfig, scope: ScopeBinding, session: Session, observations: TaskConnectionState[] = []): ServiceDirectory {
  return {
    schema_version: "yeisme.service_directory.v1",
    services: serviceDefinitions.map((definition): ServiceDirectoryEntry => {
      const connections = session.personal
        ? (config.connections || []).filter(c => c.owner === definition.id && scope.connection_ids?.includes(c.id))
          .map(c => ({
            id: c.id,
            instance_id: c.instance_id,
            label: c.label,
            environment: c.environment,
            project: c.project,
            enabled: c.enabled,
            configuration: c.enabled ? "configured" as const : "disabled" as const,
            content_requested: c.allow_content === true,
            cancellation_requested: c.allow_cancel === true,
            runtime: c.enabled ? observations.find(v => v.id === c.id)?.runtime : undefined,
          }))
        : [];
      const requestOwner = definition.id === "aigora" || definition.id === "scaena" || definition.id === "eikona" || definition.id === "sonora"
        ? definition.id : undefined;
      const collectionConfigured = definition.id === "auctra" && !!config.collection?.auctra && config.collection.auctra.enabled !== false && !!scope.collection?.auctra
        && ((!!session.accessToken && session.accessAudience.includes(config.collection.auctra.audience)) || !!config.collection.auctra.credential_ref);
      // Request-owner reads need either an OIDC session delegation or a
      // configured service credential; personal sessions are no longer excluded.
      const ownerTarget = requestOwner !== undefined ? config.owners[requestOwner as "aigora"] : undefined;
      const requestConfigured = requestOwner !== undefined && !!ownerTarget && !!scope.owners[requestOwner as "aigora"]
        && ((!!session.accessToken && session.accessAudience.includes(ownerTarget.audience)) || !!ownerTarget.credential_ref);
      const configuration = connections.some(c => c.enabled) || requestConfigured || collectionConfigured
          ? "configured"
          : definition.integration === "not_integrated" ? "needs_contract" : "not_configured";
      return {
        ...definition,
        connections,
        configuration,
        observation: "not_checked",
        ...freshness(
          connections.filter(c => c.enabled).map(c => ({
            id: c.id,
            owner: definition.id,
            instance_id: c.instance_id,
            label: c.label,
            environment: c.environment,
            project: c.project,
            state: c.runtime?.state || "not_checked",
            observed_at: c.runtime?.checked_at,
            runtime: c.runtime,
          })) as TaskConnectionState[],
          requestConfigured || collectionConfigured,
        ),
      };
    }),
  };
}
