import { serviceDefinitions, type ServiceDirectory, type ServiceDirectoryEntry } from "../src/service-directory";
import type { ScopeBinding, ServerConfig, Session } from "./contracts";
import type { TaskConnectionState } from "../src/task-observation";

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
      const requestConfigured = !session.personal && requestOwner !== undefined
        && !!config.owners[requestOwner] && !!scope.owners[requestOwner];
      return {
        ...definition,
        connections,
        configuration: connections.some(c => c.enabled) || requestConfigured
          ? "configured"
          : definition.integration === "not_integrated" ? "needs_contract" : "not_configured",
        observation: "not_checked",
      };
    }),
  };
}
