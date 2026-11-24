export const referenceBindingOwners = ["eikona", "scaena"] as const;
export type ReferenceBindingOwner = (typeof referenceBindingOwners)[number];
export const referenceBindingKinds = ["image", "video"] as const;
export type ReferenceBindingKind = (typeof referenceBindingKinds)[number];

export type ReferenceBindingAvailability = "ready" | "needs_contract" | "forbidden" | "unavailable" | "expired";

export interface ReferenceBindingSummary {
  owner: ReferenceBindingOwner;
  binding_ref: string;
  revision: string;
  digest: string;
  project_ref: string;
  kind: ReferenceBindingKind;
  label: string;
  rights_state: string;
  availability: ReferenceBindingAvailability;
  reason?: string;
}

export interface ReferenceBindingSource {
  owner: ReferenceBindingOwner;
  project_ref: string | null;
  state: ReferenceBindingAvailability;
  reason?: string;
}

export interface ReferenceBindingPage {
  schema_version: "yeisme.reference_binding.page.v1";
  rows: ReferenceBindingSummary[];
  next_cursor: string | null;
  coverage: "complete" | "partial" | "unknown";
  availability: ReferenceBindingAvailability;
  sources: ReferenceBindingSource[];
  epoch?: number;
}

export interface ReferenceBindingAccessRequest {
  purpose: "thumbnail" | "preview";
  expected_revision: string;
  expected_digest: string;
}

export interface ReferenceBindingGrant {
  schema_version: "yeisme.reference_binding.access.v1";
  handle: string;
  mime: string;
  expires_at: string;
  epoch?: number;
}
