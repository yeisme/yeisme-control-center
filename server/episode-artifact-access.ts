import type { ScopeBinding } from "./contracts";

/** Internal adapter contract only; this is not an owner/provider wire format. */
export type EpisodeMediaPurpose = "preview" | "download" | "thumbnail";

export interface EpisodeArtifactTarget {
  connection: string;
  episode_ref: string;
  artifact_ref: string;
  expected_revision: string;
  digest: string;
}

export interface EpisodeArtifactGrant {
  /** Stable identity of the original authorization; revalidation must not renew it. */
  grantId: string;
  scopeId: string;
  target: EpisodeArtifactTarget;
  purpose: EpisodeMediaPurpose;
  revoked: boolean;
  credentialRevoked: boolean;
  /** Adapter-validated URL, kept only in bridge memory. Never a browser URL. */
  validatedURL: URL;
  expires: number;
  mime: string;
  size: number;
  name: string;
}

export interface EpisodeArtifactAccessPort {
  /** Explicitly configured owner origin, not derived from artifact metadata. */
  readonly trustedOrigin: string;
  /**
   * Resolve only verified connection/episode/artifact mappings within scope.
   * Check current credentials, content permission and revocation on EVERY call.
   * Return null for an unknown mapping (never synthesize an artifact or task).
   * On reads return the original live grant, not a refreshed grant/expiry/URL.
   * Implementations must enforce their owner URL/SSRF policy before returning.
   */
  authorize(
    scope: ScopeBinding,
    target: EpisodeArtifactTarget,
    purpose: EpisodeMediaPurpose,
  ): Promise<EpisodeArtifactGrant | null>;
}
