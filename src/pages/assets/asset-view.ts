import { formatBytes, formatDurationMs } from "../../shared/read-model/format";

export type AssetViewMode = "gallery" | "list" | "compact";
export type AssetInspectorMode = "fixed" | "floating";

export function parseAssetViewMode(value: string | null | undefined): AssetViewMode {
  return value === "list" || value === "compact" ? value : "gallery";
}

export function parseAssetInspectorMode(value: string | null | undefined): AssetInspectorMode {
  return value === "floating" ? "floating" : "fixed";
}

export function assetViewLabel(value: AssetViewMode) {
  if (value === "list") return "详情列表";
  if (value === "compact") return "紧凑列表";
  return "大图网格";
}

const formatAliases: Record<string, string> = {
  "image/png": "PNG",
  "image/jpeg": "JPEG",
  "image/webp": "WEBP",
  "image/gif": "GIF",
  "image/svg+xml": "SVG",
  "audio/wav": "WAV",
  "audio/wave": "WAV",
  "audio/x-wav": "WAV",
  "audio/vnd.wave": "WAV",
  "audio/mpeg": "MP3",
  "audio/mp4": "M4A",
  "audio/x-m4a": "M4A",
  "audio/ogg": "OGG",
  "audio/flac": "FLAC",
  "audio/aac": "AAC",
  "audio/webm": "WEBM",
  "video/mp4": "MP4",
  "video/webm": "WEBM",
  "video/quicktime": "MOV",
  "text/plain": "TXT",
  "text/markdown": "MD",
  "text/csv": "CSV",
  "application/json": "JSON",
  "application/pdf": "PDF",
  "application/zip": "ZIP",
};

/** Short file-format label from a MIME type; null when the type carries no useful format. */
export function mediaFormatLabel(mime: string | null | undefined): string | null {
  const value = (mime || "").trim().toLowerCase().split(";")[0];
  if (!value) return null;
  if (formatAliases[value]) return formatAliases[value];
  const subtype = value.split("/")[1];
  if (!subtype || subtype === "octet-stream" || subtype.includes(".")) return null;
  const label = subtype.replace(/^x-/, "").replace(/\+.*$/, "").toUpperCase();
  return label.length > 8 ? null : label;
}

export interface AssetSpec {
  format: string | null;
  dimensions: string | null;
  duration: string | null;
  size: string | null;
}

export function assetSpec(result: { mime?: string | null; bytes?: number | null; width?: number; height?: number; duration_ms?: number | null }): AssetSpec {
  return {
    format: mediaFormatLabel(result.mime),
    dimensions: result.width && result.height ? `${result.width}×${result.height}` : null,
    duration: formatDurationMs(result.duration_ms ?? null),
    size: formatBytes(result.bytes),
  };
}

/** `unmapped` keeps the owner's original code for tooltips when no label is registered. */
export interface CodeLabel {
  label: string;
  unmapped: string | null;
}

const resultStateLabels: Record<string, string> = {
  candidate: "候选",
  adopted: "已采用",
  selected: "已选用",
  approved: "已通过",
  final: "定稿",
  ready: "就绪",
  available: "可用",
  generated: "已生成",
  draft: "草稿",
  pending: "处理中",
  processing: "处理中",
  rejected: "已拒绝",
  discarded: "已弃用",
  archived: "已归档",
  expired: "已过期",
  failed: "失败",
  unavailable: "不可用",
  unknown: "未确认",
};

const reviewStatusLabels: Record<string, string> = {
  pending_review: "待审阅",
  pending: "待审阅",
  in_review: "审阅中",
  approved: "已通过",
  rejected: "已退回",
  changes_requested: "需修改",
  not_required: "无需审阅",
  not_reviewed: "未审阅",
};

const exportStatusLabels: Record<string, string> = {
  not_exported: "未导出",
  pending: "待导出",
  ready: "可导出",
  prepared: "已备妥",
  exporting: "导出中",
  exported: "已导出",
  blocked: "导出受阻",
  failed: "导出失败",
};

function codeLabel(map: Record<string, string>, value: string | null | undefined): CodeLabel | null {
  const raw = (value || "").trim();
  if (!raw) return null;
  const mapped = map[raw] ?? map[raw.toLowerCase()];
  if (mapped) return { label: mapped, unmapped: null };
  return { label: raw.replace(/[_\-.]+/g, " ").replace(/\s+/g, " ").trim(), unmapped: raw };
}

export const resultStateLabel = (value: string | null | undefined) => codeLabel(resultStateLabels, value);
export const reviewStatusLabel = (value: string | null | undefined) => codeLabel(reviewStatusLabels, value);
export const exportStatusLabel = (value: string | null | undefined) => codeLabel(exportStatusLabels, value);
