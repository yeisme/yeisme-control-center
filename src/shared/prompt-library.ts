export const promptOwners = ["eikona", "sonora", "scaena"] as const;
export type PromptOwner = typeof promptOwners[number];
export const promptKinds = ["image", "video", "speech", "music", "sfx"] as const;
export type PromptKind = typeof promptKinds[number];
export const promptKindLabels: Record<PromptKind, string> = { image: "图片", video: "视频", speech: "语音", music: "音乐", sfx: "音效" };
export interface PromptSummary {
  id: string; owner: PromptOwner; project: string; title: string; kind: PromptKind;
  source: "manual" | "history"; source_ref?: string; task_ref?: string; model?: string; version: number;
  digest: string; tags: string[]; archived: boolean; readable: boolean;
  created_at: string; updated_at: string; visibility?: "project" | "private";
}
export interface PromptContent { summary: PromptSummary; text: string; state: "complete"; truncated: false }
export interface PromptWrite {
  id?: string; title: string; kind: PromptKind; text?: string; tags: string[];
  archived: boolean; expected_version: number; source_ref?: string;
}
export interface PromptSource {
  owner: PromptOwner; state: "ready" | "forbidden" | "needs_contract" | "unavailable";
  project?: string; can_write?: boolean; total?: number; next_cursor?: string; index_more?: boolean; history_state?: "complete" | "incomplete" | "unknown" | "needs_contract"; reason?: string;
}
export interface PromptPage { rows: PromptSummary[]; sources: PromptSource[]; epoch?: number }
export interface PromptQuery { model?: string; from?: string; to?: string; collection?: string; owner?: string; q?: string; kind?: string; source?: string; tag?: string; archived?: string; cursor?: string; limit?: number }
