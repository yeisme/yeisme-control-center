import type { Asset } from "./data";

export interface AssetFolder {
  id: string;
  name: string;
  parent: string | null;
}
export interface AssetLibraryState {
  folders: AssetFolder[];
  locations: Record<string, string>;
  notes: Record<string, string>;
  favorites: string[];
}
export interface AssetFilters {
  folder: string;
  owner: string;
  status: string;
  producer: string;
  content: string;
  review: string;
  project: string;
  version: string;
  from: string;
  to: string;
}
export const emptyAssetFilters: AssetFilters = {
  folder: "all",
  owner: "all",
  status: "all",
  producer: "all",
  content: "all",
  review: "all",
  project: "all",
  version: "all",
  from: "",
  to: "",
};
export const initialAssetLibrary = (): AssetLibraryState => ({
  folders: [
    { id: "visual", name: "视觉与参考", parent: null },
    { id: "sound", name: "声音与音乐", parent: null },
    { id: "writing", name: "文稿与内容", parent: null },
  ],
  locations: {
    "asset-image": "visual",
    "asset-denied": "visual",
    "asset-audio": "sound",
    "asset-missing": "writing",
  },
  notes: {},
  favorites: [],
});
export function folderDescendants(
  folders: AssetFolder[],
  id: string,
): Set<string> {
  const result = new Set([id]);
  const queue = [id];
  for (let i = 0; i < queue.length; i++) {
    for (const folder of folders)
      if (folder.parent === queue[i] && !result.has(folder.id)) {
        result.add(folder.id);
        queue.push(folder.id);
      }
  }
  return result;
}
export function folderNameError(
  name: string,
  folders: AssetFolder[],
  parent: string | null,
): string {
  const clean = name.trim();
  if (!clean) return "请输入目录名称。";
  if (clean.length > 40) return "目录名称最多 40 个字符。";
  if (/[\\/]/.test(clean) || [".", ".."].includes(clean))
    return "名称不能包含斜杠，也不能使用 . 或 ..。";
  if (
    folders.some(
      (f) =>
        f.parent === parent &&
        f.name.toLocaleLowerCase() === clean.toLocaleLowerCase(),
    )
  )
    return "此位置已有同名目录，请换一个名称。";
  return "";
}
export function folderMoveError(
  folders: AssetFolder[],
  id: string,
  target: string | null,
): string {
  const folder = folders.find((f) => f.id === id);
  if (!folder || (target && !folders.some((f) => f.id === target)))
    return "目录已不存在，请重新选择。";
  if (target && folderDescendants(folders, id).has(target))
    return "不能将目录移入自身或子目录。";
  if (folder.parent === target) return "目录已在此位置。";
  return folderNameError(
    folder.name,
    folders.filter((f) => f.id !== id),
    target,
  );
}
export function filterLibraryAssets(
  assets: Asset[],
  state: AssetLibraryState,
  filters: AssetFilters,
  type: string,
  query: string,
): Asset[] {
  const nested = folderDescendants(state.folders, filters.folder);
  const term = query.trim().toLocaleLowerCase();
  return assets.filter(
    (asset) =>
      (type === "all" || asset.type === type) &&
      (filters.owner === "all" || asset.owner === filters.owner) &&
      (filters.status === "all" || asset.state === filters.status) &&
      (filters.producer === "all" || asset.producer === filters.producer) &&
      (filters.content === "all" || asset.content === filters.content) &&
      (filters.review === "all" || asset.review === filters.review) &&
      (filters.project === "all" || asset.project === filters.project) &&
      (filters.version === "all" || asset.version === filters.version) &&
      (!filters.from || asset.date >= filters.from) &&
      (!filters.to || asset.date <= filters.to) &&
      (filters.folder === "all" ||
        (filters.folder === "favorites"
          ? state.favorites.includes(asset.id)
          : filters.folder === "unfiled"
            ? !state.locations[asset.id]
            : nested.has(state.locations[asset.id]))) &&
      `${asset.name} ${asset.id} ${asset.owner} ${asset.producer} ${asset.uploader} ${asset.source} ${state.notes[asset.id] || ""}`
        .toLocaleLowerCase()
        .includes(term),
  );
}
