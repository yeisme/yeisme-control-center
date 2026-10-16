export type WorkspacePage =
  | "home"
  | "projects"
  | "creation"
  | "assets"
  | "tasks"
  | "review"
  | "delivery"
  | "capabilities"
  | "usage"
  | "team";
export type ProjectTab = "overview" | "units" | "assets" | "tasks" | "review" | "delivery";
export type ContentState = "available" | "missing_bytes" | "forbidden" | "not_recorded" | "unknown";

export type TaskStatus =
  | "queued"
  | "running"
  | "succeeded"
  | "failed"
  | "unknown"
  | "waiting_review";

export type AssetKind = "image" | "audio" | "video" | "text";
export type AssetState = "candidate" | "ready" | "adopted" | "blocked";
export type ReviewState = "pending" | "approved" | "changes_requested";
export type DeliveryState = "missing" | "ready" | "included";

export interface ProductionUnit {
  id: string;
  label: string;
  type: "shot" | "scene" | "episode";
  status: "in_progress" | "blocked" | "ready";
  progress: number;
  note: string;
}

export interface WorkspaceProject {
  id: string;
  name: string;
  type: string;
  owner: string;
  updated: string;
  progress: number;
  units: ProductionUnit[];
  cover?: string;
  members: string[];
}

export interface CapabilityCard {
  id: string;
  label: string;
  description: string;
  kind: AssetKind;
  owner: string;
  accent: string;
}

export type CapabilityCategory = "model" | "mcp" | "tool" | "analysis";
export type CapabilityReadiness = "registered" | "configured" | "authorized" | "callable" | "observed" | "needs_contract";

export interface CapabilityRecord {
  id: string;
  category: CapabilityCategory;
  name: string;
  description: string;
  provider: string;
  version: string;
  modelRef?: string;
  modalities: string[];
  constraints: string[];
  metering: string;
  readiness: CapabilityReadiness;
  readinessLabel: string;
  accent: string;
  owner: string;
  successRate: number | null;
  latencyMs: number | null;
  observedAt: string | null;
  relatedProjects: string[];
  toolCount?: number;
}

export type UsageCostState = "confirmed" | "estimated" | "pending" | "unknown";

export interface UsageFact {
  id: string;
  createdAt: string;
  projectId: string;
  projectName: string;
  member: string;
  provider: string;
  model: string;
  modality: string;
  mcpServer?: string;
  tool?: string;
  traceRef: string;
  sourceRef: string;
  parentRef?: string;
  quantity: number | null;
  unit: string;
  upstreamCost: number | null;
  currency: "CNY" | "USD";
  costState: UsageCostState;
  status: "succeeded" | "failed" | "pending" | "unknown";
  durationMs: number | null;
}

export interface CreationTask {
  id: string;
  title: string;
  capability: string;
  projectId: string;
  unitId: string;
  status: TaskStatus;
  createdBy: string;
  updated: string;
  stage: string;
  source: "demo_fixture" | "live_projection";
  completeness: "complete" | "partial" | "unknown";
  resultAssetIds: string[];
  formPayload?: Record<string, string | number | boolean | string[]>;
}

export interface AssetVersion {
  id: string;
  version: string;
  label: string;
  state: AssetState;
  review: ReviewState;
  created: string;
  sourceTaskId: string;
  preview?: string;
  duration?: string;
  note: string;
  contentState?: ContentState;
  downloadable?: boolean;
  downloadReason?: string;
  downloadRef?: string;
}

export interface AssetGroup {
  id: string;
  name: string;
  kind: AssetKind;
  projectId: string;
  unitId: string;
  rights: string;
  source: string;
  versions: AssetVersion[];
}

export interface ReviewDecision {
  assetId: string;
  selectedVersionId?: string;
  state: ReviewState;
  note: string;
  reviewer?: string;
}

export interface DeliveryPackage {
  id: string;
  projectId: string;
  state: DeliveryState;
  items: { assetId: string; required: boolean; included: boolean }[];
}

export interface WorkspaceV18State {
  projects: WorkspaceProject[];
  capabilities: CapabilityCard[];
  capabilityCatalog: CapabilityRecord[];
  usage: UsageFact[];
  tasks: CreationTask[];
  assets: AssetGroup[];
  reviews: ReviewDecision[];
  delivery: DeliveryPackage;
}

export interface CreationFormDraft {
  capability: string;
  projectId: string;
  unitId: string;
  prompt: string;
  outputName: string;
  saveTarget: string;
  fields: Record<string, string | boolean>;
}
