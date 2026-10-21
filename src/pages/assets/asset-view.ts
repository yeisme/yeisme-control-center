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
