import type { DirectoryPage, ProjectItem } from "../../shared/collaboration";

/** Folder identity colours are categorical: the same name keeps the same tone. */
export const FOLDER_TONES = 5;

export function folderTone(name: string): number {
  let hash = 0;
  for (const char of name) hash = (hash * 31 + char.codePointAt(0)!) >>> 0;
  return (hash % FOLDER_TONES) + 1;
}

/**
 * Count line under a folder tile.
 * A finished local page may state "N 项成果". A truncated page, a page that still
 * has a source cursor, or any coverage other than complete only says how many rows
 * were returned.
 */
export function folderMeta(
  page: Pick<DirectoryPage<unknown>, "total" | "coverage"> & { next_source_cursor?: string | null } | null | undefined,
  subfolders: number,
): string {
  const parts: string[] = [];
  const exact = page?.coverage === "complete" && !page.next_source_cursor;
  if (page && page.total > 0) parts.push(exact ? `${page.total} 项成果` : `已读到 ${page.total} 项`);
  else if (page && !subfolders) parts.push(exact ? "空文件夹" : "暂未读到成果");
  if (subfolders) parts.push(`${subfolders} 个子文件夹`);
  return parts.join(" · ") || "文件夹";
}

export type CoverSheet = { kind: "media"; item: ProjectItem } | { kind: "folder"; index: number };

/** Up to three peek sheets: result thumbnails first, then subfolder silhouettes. */
export function coverSheets(rows: readonly ProjectItem[], subfolders: number): CoverSheet[] {
  const sheets: CoverSheet[] = rows.slice(0, 3).map((item) => ({ kind: "media", item }));
  for (let index = 0; sheets.length < 3 && index < subfolders; index++) sheets.push({ kind: "folder", index });
  return sheets;
}
