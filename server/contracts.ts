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
export interface ServerConfig {
  auth_mode?: "personal" | "oidc";
  personal?: {
    name: string;
    username?: string;
    role?: ControlCenterRole;
    password_hash_ref: string;
    scope_ids: string[];
  };
  connections?: TaskConnection[];
  origin: string;
  port: number;
  oidc?: { issuer: string; clientId: string; clientSecretRef?: string };
  principals: PrincipalBinding[];
  owners: Partial<Record<Owner, { origin: string; audience: string }>>;
  allowInsecureLoopback?: boolean;
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
