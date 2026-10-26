import type { ReactNode } from "react";

export interface FolderSheet { key: string; kind: "media" | "folder"; content?: ReactNode }

export interface FolderArtProps {
  /** Categorical tone 1–5, see `folderTone`. */
  tone?: number;
  /** Peek sheets drawn inside the folder, back to front; at most three are shown. */
  sheets?: readonly FolderSheet[];
  /** Decorative pill on the front panel. Repeat anything important in visible text. */
  badge?: string;
  /** Lifts the front panel without hover, e.g. while a drag is over a drop target. */
  open?: boolean;
  className?: string;
}

/**
 * Folder cover illustration: back plate, up to three peeking sheets and a
 * frosted front panel. Decorative only; the host renders the name and counts.
 */
export function FolderArt({ tone = 1, sheets = [], badge, open, className }: FolderArtProps) {
  const shown = sheets.slice(0, 3);
  return (
    <span className={className ? `folder-art ${className}` : "folder-art"} data-tone={tone} data-sheets={shown.length} data-open={open ? "" : undefined} aria-hidden="true">
      <svg className="folder-art-back" viewBox="0 0 100 80" preserveAspectRatio="none" focusable="false">
        <path d="M0 7Q0 2 5 2H35C39 2 40 10 45 10H94Q100 10 100 16V74Q100 80 94 80H6Q0 80 0 74Z" />
      </svg>
      {shown.map((sheet) => <span key={sheet.key} className="folder-art-sheet" data-kind={sheet.kind}>{sheet.content}</span>)}
      <span className="folder-art-front" data-badge={badge || undefined} />
    </span>
  );
}
