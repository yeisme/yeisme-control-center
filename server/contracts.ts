import type { ControlCenterRole } from "../src/service-directory";
import type {
  Owner,
  Coverage,
  RequestProjection,
  RequestSummary,
} from "../src/request-visibility";
export interface ScopeBinding {
  id: string;
  tenant: string;
  team: string;
  project: string;
  label: string;
  connection_ids?: string[];
  owners: Partial<
    Record<
      Owner,
      { tenant: string; project: string; actor: string; audience: string }
    >
  >;
  collection?: Partial<Record<"auctra", { tenant: string; project: string; actor: string; audience: string }>>;
}
export interface PrincipalBinding {
  issuer: string;
  subject: string;
  name: string;
  role?: ControlCenterRole;
  scopes: ScopeBinding[];
}
export interface TaskConnection {
  id: string;
  owner: "eikona" | "sonora" | "scaena";
  instance_id: string;
  label: string;
  environment: string;
  endpoint: string;
  credential_ref: string;
  project: string;
  enabled: boolean;
  allow_private_http?: boolean;
  allow_cancel?: boolean;
  allow_content?: boolean;
  media_origins?: string[];
  studio_origin?: string;
}
export type ProviderOwner = "eikona" | "scaena" | "sonora";
export type ProviderModality = "image" | "video" | "audio";
export interface ProviderConnection {
  owner: ProviderOwner;
  endpoint: string;
  /** A user-level 0600 file reference. The file content never leaves the server. */
  credential_ref?: string;
  /** Environment variable name used for ephemeral/local runtime injection. */
  credential_env?: string;
  project?: string;
  enabled: boolean;
  model_refs?: string[];
  action_manifest?: {
    submit: string;
    status?: string;
    reconcile?: string;
    estimate?: string;
  };
}
export interface ServerConfig {
  auth_mode?: "personal" | "oidc";
  personal?: {
    name: string;
    username?: string;
    role?: ControlCenterRole;
    password_hash_ref: string;
    scope_ids: string[];
    users?: PersonalUser[];
  };
  /** Optional SQLite persistence location; defaults beside the config file. */
  database?: { path?: string };
  /** User-level config file path; populated by the server loader, never sent to clients. */
  config_file?: string;
  connections?: TaskConnection[];
  origin: string;
  /** Listen address. Defaults to loopback; 0.0.0.0 is an explicit opt-in for controlled testing. */
  bind?: string;
  port: number;
  oidc?: { issuer: string; clientId: string; clientSecretRef?: string };
  principals: PrincipalBinding[];
  owners: Partial<
    Record<
      Owner,
      {
        origin: string;
        audience: string;
        /** Optional 0600 service credential for personal (non-OIDC) sessions. */
        credential_ref?: string;
      }
    >
  >;
  collection?: Partial<Record<"auctra", {
    origin: string;
    audience: string;
    credential_ref?: string;
    enabled?: boolean;
  }>>;
  clients?: Partial<Record<"muweave", {
    origin: string;
    enabled?: boolean;
  }>>;
  providers?: Partial<Record<ProviderOwner, ProviderConnection>>;
  allowInsecureLoopback?: boolean;
}
export interface PersonalUser {
  username: string;
  name: string;
  role: ControlCenterRole;
  key_hash_ref: string;
  scope_ids: string[];
  enabled?: boolean;
  created_at?: string;
}
export interface Session {
  id: string;
  issuer: string;
  subject: string;
  name: string;
  accessToken: string;
  accessAudience: string[];
  expires: number;
  csrf: string;
  personal?: boolean;
  last_seen?: number;
  credential_version?: string;
  /** Monotonic per-session epoch; bumped when permission bindings change. */
  epoch: number;
}
export interface OwnerPage {
  rows: RequestProjection[];
  coverage: Coverage;
  next_cursor?: string;
}
export interface RequestPage {
  rows: RequestProjection[];
  coverage: Coverage[];
  next_cursor?: string;
}
export interface OrganizationProjection {
  state: string;
  tenant: string;
  members: {
    id: string;
    name: string;
    type: string;
    owner: Owner;
    role: string;
    team: string;
    binding: string;
  }[];
}
export type { Owner, Coverage, RequestProjection, RequestSummary };
