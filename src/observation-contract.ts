import type { CoverageState } from "./request-visibility";

export type ObservationFreshness = "fresh" | "stale" | "unknown";
export type PromptCaptureState =
  | "not_recorded"
  | "queued"
  | "capturing"
  | "captured"
  | "redacted"
  | "blocked"
  | "failed"
  | "expired";

export interface PromptCaptureObservation {
  state: PromptCaptureState;
  source: "request" | "task" | "provider_run" | "owner";
  capture_ref?: string;
  request_ref?: string;
  task_ref?: string;
  trace_ref?: string;
  version?: string;
  digest?: string;
  length?: number;
  locale?: string;
  summary?: string;
  readable: boolean;
  observed_at: string;
  reason?: string;
}

export type ProcessCheckpointKind =
  | "request_received"
  | "prompt_capture"
  | "prompt_validate"
  | "prompt_normalize"
  | "submit"
  | "provider_running"
  | "artifact_collect"
  | "artifact_ready"
  | "review"
  | "reconcile"
  | "failed"
  | "unknown";

export interface ProcessProgress {
  kind: "indeterminate" | "count" | "percent";
  completed: number | null;
  total: number | null;
  percent: number | null;
}

export interface ProcessCheckpoint {
  id: string;
  sequence?: number;
  occurred_at: string;
  kind: ProcessCheckpointKind;
  stage: string;
  state: string;
  duration_ms?: number | null;
  summary?: string;
  reason_code?: string;
  attempt_ref?: string;
  progress?: ProcessProgress;
  evidence_refs?: string[];
  prompt_capture?: PromptCaptureObservation;
}

export interface ProcessObservation {
  schema_version: "yeisme.process_observation.v1";
  state: "active" | "complete" | "partial" | "blocked" | "unknown";
  freshness: ObservationFreshness;
  coverage: CoverageState;
  observed_at: string;
  request_ref?: string;
  task_ref?: string;
  trace_ref?: string;
  prompt_capture?: PromptCaptureObservation;
  checkpoints: ProcessCheckpoint[];
  next_cursor?: string;
  resume_cursor?: string;
  gap: boolean;
}

const promptStates = new Set<PromptCaptureState>([
  "not_recorded", "queued", "capturing", "captured", "redacted", "blocked", "failed", "expired",
]);
const promptSources = new Set<PromptCaptureObservation["source"]>([
  "request", "task", "provider_run", "owner",
]);
const checkpointKinds = new Set<ProcessCheckpointKind>([
  "request_received", "prompt_capture", "prompt_validate", "prompt_normalize",
  "submit", "provider_running", "artifact_collect", "artifact_ready", "review",
  "reconcile", "failed", "unknown",
]);

const text = (value: unknown, max: number) => typeof value === "string" ? value.slice(0, max) : undefined;
const time = (value: unknown) => typeof value === "string" && Number.isFinite(Date.parse(value)) ? value : "";
const finite = (value: unknown) => typeof value === "number" && Number.isFinite(value) ? value : null;

export function normalizePromptObservation(value: unknown): PromptCaptureObservation | undefined {
  if (!value || typeof value !== "object") return undefined;
  const raw = value as Record<string, unknown>;
  const state = promptStates.has(raw.state as PromptCaptureState) ? raw.state as PromptCaptureState : "not_recorded";
  const source = promptSources.has(raw.source as PromptCaptureObservation["source"]) ? raw.source as PromptCaptureObservation["source"] : "owner";
  const observedAt = time(raw.observed_at) || new Date().toISOString();
  return {
    state,
    source,
    ...(text(raw.capture_ref, 512) ? { capture_ref: text(raw.capture_ref, 512) } : {}),
    ...(text(raw.request_ref, 512) ? { request_ref: text(raw.request_ref, 512) } : {}),
    ...(text(raw.task_ref, 512) ? { task_ref: text(raw.task_ref, 512) } : {}),
    ...(text(raw.trace_ref, 512) ? { trace_ref: text(raw.trace_ref, 512) } : {}),
    ...(text(raw.version, 160) ? { version: text(raw.version, 160) } : {}),
    ...(text(raw.digest, 128) ? { digest: text(raw.digest, 128) } : {}),
    ...(finite(raw.length) !== null ? { length: Math.max(0, Math.min(1_000_000, finite(raw.length)!)) } : {}),
    ...(text(raw.locale, 40) ? { locale: text(raw.locale, 40) } : {}),
    ...(text(raw.summary, 240) ? { summary: text(raw.summary, 240) } : {}),
    readable: raw.readable === true,
    observed_at: observedAt,
    ...(text(raw.reason, 300) ? { reason: text(raw.reason, 300) } : {}),
  };
}

function normalizeProgress(value: unknown): ProcessProgress | undefined {
  if (!value || typeof value !== "object") return undefined;
  const raw = value as Record<string, unknown>;
  const kind = raw.kind === "count" || raw.kind === "percent" ? raw.kind : "indeterminate";
  const percent = finite(raw.percent);
  return {
    kind,
    completed: finite(raw.completed),
    total: finite(raw.total),
    percent: percent !== null && percent >= 0 && percent <= 100 ? percent : null,
  };
}

export function normalizeCheckpoint(value: unknown, index = 0): ProcessCheckpoint | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const id = text(raw.id, 180);
  if (!id) return null;
  const kind = checkpointKinds.has(raw.kind as ProcessCheckpointKind) ? raw.kind as ProcessCheckpointKind : "unknown";
  const sequence = finite(raw.sequence);
  const evidence = Array.isArray(raw.evidence_refs) ? raw.evidence_refs.flatMap((item) => {
    const ref = text(item, 512); return ref ? [ref] : [];
  }).slice(0, 20) : [];
  return {
    id,
    ...(sequence !== null ? { sequence: Math.max(0, Math.floor(sequence)) } : { sequence: index }),
    occurred_at: time(raw.occurred_at) || new Date().toISOString(),
    kind,
    stage: text(raw.stage, 100) || "unknown",
    state: text(raw.state, 100) || "unknown",
    ...(finite(raw.duration_ms) !== null ? { duration_ms: Math.max(0, finite(raw.duration_ms)!) } : {}),
    ...(text(raw.summary, 240) ? { summary: text(raw.summary, 240) } : {}),
    ...(text(raw.reason_code, 160) ? { reason_code: text(raw.reason_code, 160) } : {}),
    ...(text(raw.attempt_ref, 512) ? { attempt_ref: text(raw.attempt_ref, 512) } : {}),
    ...(normalizeProgress(raw.progress) ? { progress: normalizeProgress(raw.progress) } : {}),
    ...(evidence.length ? { evidence_refs: evidence } : {}),
    ...(normalizePromptObservation(raw.prompt_capture) ? { prompt_capture: normalizePromptObservation(raw.prompt_capture) } : {}),
  };
}

export function normalizeProcessObservation(value: unknown): ProcessObservation | undefined {
  if (!value || typeof value !== "object") return undefined;
  const raw = value as Record<string, unknown>;
  const rawCheckpoints = Array.isArray(raw.checkpoints) ? raw.checkpoints : [];
  const checkpoints = rawCheckpoints.slice(0, 200).flatMap((item, index) => {
    const checkpoint = normalizeCheckpoint(item, index); return checkpoint ? [checkpoint] : [];
  });
  const state = raw.state === "active" || raw.state === "complete" || raw.state === "partial" || raw.state === "blocked" ? raw.state : "unknown";
  const freshness = raw.freshness === "fresh" || raw.freshness === "stale" ? raw.freshness : "unknown";
  const coverage = raw.coverage === "complete" || raw.coverage === "partial" || raw.coverage === "pending" || raw.coverage === "not_recorded" || raw.coverage === "forbidden" || raw.coverage === "unavailable" || raw.coverage === "needs_contract" ? raw.coverage : "unknown";
  return {
    schema_version: "yeisme.process_observation.v1",
    state,
    freshness,
    coverage,
    observed_at: time(raw.observed_at) || new Date().toISOString(),
    ...(text(raw.request_ref, 512) ? { request_ref: text(raw.request_ref, 512) } : {}),
    ...(text(raw.task_ref, 512) ? { task_ref: text(raw.task_ref, 512) } : {}),
    ...(text(raw.trace_ref, 512) ? { trace_ref: text(raw.trace_ref, 512) } : {}),
    ...(normalizePromptObservation(raw.prompt_capture) ? { prompt_capture: normalizePromptObservation(raw.prompt_capture) } : {}),
    checkpoints,
    ...(text(raw.next_cursor, 2048) ? { next_cursor: text(raw.next_cursor, 2048) } : {}),
    ...(text(raw.resume_cursor, 2048) ? { resume_cursor: text(raw.resume_cursor, 2048) } : {}),
    gap: raw.gap === true,
  };
}
