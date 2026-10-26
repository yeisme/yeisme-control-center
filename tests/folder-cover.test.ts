import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { FolderArt } from "../src/components/FolderArt";
import { coverSheets, FOLDER_TONES, folderMeta, folderTone } from "../src/pages/assets/folder-cover";
import type { ProjectItem } from "../src/shared/collaboration";

const item = (id: string) => ({ id, name: id, mime: "image/png" }) as ProjectItem;

describe("project folder covers", () => {
  it("keeps one categorical tone per folder name", () => {
    expect(folderTone("角色定稿")).toBe(folderTone("角色定稿"));
    for (const name of ["角色定稿", "场景氛围", "分镜草图", "待筛选", ""]) {
      expect(folderTone(name)).toBeGreaterThanOrEqual(1);
      expect(folderTone(name)).toBeLessThanOrEqual(FOLDER_TONES);
    }
  });

  it("never states an exact count when coverage is partial or the source page continues", () => {
    expect(folderMeta({ total: 4, coverage: "complete" }, 0)).toBe("4 项成果");
    expect(folderMeta({ total: 4, coverage: "partial" }, 0)).toBe("已读到 4 项");
    expect(folderMeta({ total: 4, coverage: "complete", next_source_cursor: "more" }, 0)).toBe("已读到 4 项");
    expect(folderMeta({ total: 0, coverage: "complete" }, 0)).toBe("空文件夹");
    expect(folderMeta({ total: 0, coverage: "unknown" }, 0)).toBe("暂未读到成果");
    expect(folderMeta({ total: 0, coverage: "complete" }, 2)).toBe("2 个子文件夹");
    expect(folderMeta({ total: 3, coverage: "complete" }, 1)).toBe("3 项成果 · 1 个子文件夹");
    expect(folderMeta(null, 0)).toBe("文件夹");
  });

  it("peeks at results first and fills with subfolders up to three sheets", () => {
    expect(coverSheets([item("a"), item("b"), item("c"), item("d")], 2).map((s) => s.kind)).toEqual(["media", "media", "media"]);
    expect(coverSheets([item("a")], 5).map((s) => s.kind)).toEqual(["media", "folder", "folder"]);
    expect(coverSheets([], 1).map((s) => s.kind)).toEqual(["folder"]);
    expect(coverSheets([], 0)).toEqual([]);
  });

  it("adds no text to the folder button's accessible name", () => {
    const html = renderToStaticMarkup(createElement(FolderArt, { tone: 2, sheets: [{ key: "a", kind: "media", content: createElement("img", { alt: "", src: "x.png" }) }, { key: "f", kind: "folder" }] }));
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain('data-sheets="2"');
    expect(html.replace(/<[^>]+>/g, "")).toBe("");
  });
});
