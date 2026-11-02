import type { ControlCenterRole } from "../src/service-directory";
import type { OpenToolKind } from "../src/shared/open-tools";
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
  /**
   * Shared projects only: every bound tool project, several per owner allowed. `owners` keeps one entry per owner for
   * delegated reads (actor and audience); results and tasks are filtered by these pairs.
   */
  projects?: { owner: string; project_ref: string; connection_ids: string[] }[];
  /** Open tools (DriveBridge, MCP Gateway) this scope may see; each is read with the server's own credential. */
  open_tools?: OpenToolKind[];
}
export interface PrincipalBinding {
  issuer: string;
  subject: string;
  name: string;
  role?: ControlCenterRole;
  scopes: ScopeBinding[];
}
/**
 * When a credential stops working, as recorded by whoever issued it: owners do not report expiry over their APIs,
 * so `personal-config` writes these next to the `credential_ref` they describe. RFC 3339 with seconds and a zone. The
 * configuration itself never reaches a client; personal administrators receive the resulting `expires_at` in the
 * credential rows of the service directory.
 */
export interface CredentialLifecycle {
  credential_expires_at?: string;
  credential_issued_at?: string;
}
export interface TaskConnection extends CredentialLifecycle {
  id: string;
  owner: "eikona" | "sonora" | "scaena" | "anatomia";
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
/** A read-only link to an open tool that is not a task owner; see `src/shared/open-tools.ts`. */
export interface OpenToolConnection extends CredentialLifecycle {
  /** Base address of the tool; the server appends its own fixed GET routes. */
  endpoint: string;
  /** A user-level 0600 file holding a read-only bearer credential issued by the tool. */
  credential_ref: string;
  allow_private_http?: boolean;
  enabled?: boolean;
  label?: string;
}
export type ProviderOwner = "eikona" | "scaena" | "sonora";
export type ProviderModality = "image" | "video" | "audio";
export interface ProviderConnection extends CredentialLifecycle {
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
      } & CredentialLifecycle
    >
  >;
  collection?: Partial<Record<"auctra", {
    origin: string;
    audience: string;
    /** 0600 file holding an Auctra `service-collector` key; Auctra lets that purpose call `collection.*` only. */
    credential_ref?: string;
    /** 0600 file holding a `service-consumer` key for `creative.flow.read`, which Auctra refuses to collector keys. */
    flow_credential_ref?: string;
    flow_credential_expires_at?: string;
    flow_credential_issued_at?: string;
    /** The origin may be plain http on a private IPv4 address (set by `personal-config auctra --private-http`). */
    allow_private_http?: boolean;
    enabled?: boolean;
  } & CredentialLifecycle>>;
  clients?: Partial<Record<"muweave", {
    origin: string;
    enabled?: boolean;
  }>>;
  providers?: Partial<Record<ProviderOwner, ProviderConnection>>;
  open_tools?: Partial<Record<OpenToolKind, OpenToolConnection>>;
  /** Server-side observation, so failures and credential problems become reminders with no browser open. */
  observation?: ObservationConfig;
  allowInsecureLoopback?: boolean;
}
export interface ObservationConfig {
  enabled: boolean;
  /** Minutes between cycles; at least 5, default 10. */
  interval_minutes?: number;
  /** Open tools are read every Nth cycle (DriveBridge writes an audit row per authenticated call); default 3. */
  open_tools_every?: number;
  /** Reminder recipients as `issuer|subject`; default every enabled admin bound to the scope. */
  recipients?: string[];
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
