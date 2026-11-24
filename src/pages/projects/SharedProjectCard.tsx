import type { ReactNode } from "react";
import { api } from "../../shared/api/control-center-client";
import { useScopedRead } from "../../app/workspace";
import { Pill, cx, ownerLabel } from "../../components/ui";
import { Plus } from "../../icons";
import { projectRoleLabels, type SharedProject } from "../../shared/collaboration";
import { FolderArt } from "../../components/FolderArt";
import { folderTone } from "../assets/folder-cover";
import { ItemThumbnail } from "../assets/ProjectFiles";
import { formatRelative } from "../../shared/read-model/format";

/** How many results a project card's cover shows. */
export const coverLimit = 4;

/** The cover's tile layout for a number of results: one fills it, two split it, three lead with a tall tile. */
export function coverLayout(count: number): string[] {
  if (count <= 1) return ["col-span-2 row-span-2"];
  if (count === 2) return ["row-span-2", "row-span-2"];
  if (count === 3) return ["row-span-2", "", ""];
  return ["", "", "", ""];
}

/**
 * The newest results the control center already stored for a project. It never reads the tools, so a list of projects
 * costs no owner reads beyond the thumbnails that scroll into view.
 */
function ProjectCover({ project }: { project: SharedProject }) {
  const items = useScopedRead((_s, signal) => api.projectItems(project.id, { limit: coverLimit, local: "1" }, signal), { key: `${project.id}|cover|${project.updated_at}` });
  const rows = (items.data?.rows || []).slice(0, coverLimit);
  const layout = coverLayout(rows.length);
  return <div aria-hidden="true" className="relative aspect-[16/9] overflow-hidden border-b border-line/70 bg-panel-sunken" data-project-cover={rows.length}>
    {rows.length
      ? <div className="grid size-full grid-cols-2 grid-rows-2 gap-px bg-line/60">{rows.map((item, index) => <span key={item.id} className={cx("min-h-0 overflow-hidden bg-panel-sunken", layout[index])}><ItemThumbnail project={project.id} item={item} /></span>)}</div>
      : <div className="grid size-full place-items-center"><FolderArt tone={folderTone(project.name)} className="w-20 opacity-90" /></div>}
  </div>;
}

/** A shared project in the list: its cover, name, tools and who runs it. The whole card opens the project. */
export function SharedProjectCard({ project, onOpen, menu, extra }: { project: SharedProject; onOpen: () => void; menu: ReactNode; extra?: ReactNode }) {
  const owners = [...new Set(project.bindings.map((binding) => binding.owner))];
  return <div data-shared-project={project.id} className="group relative flex h-full min-w-0 flex-col overflow-hidden rounded-card border border-line/80 bg-panel shadow-panel transition-[border-color,box-shadow,transform] duration-200 hover:border-line-strong hover:shadow-raised motion-safe:hover:-translate-y-0.5">
    <ProjectCover project={project} />
    <div className="flex min-w-0 flex-1 flex-col gap-2 p-4">
      <div className="flex min-w-0 items-start gap-2">
        <button className="min-w-0 flex-1 text-left after:absolute after:inset-0 after:rounded-card after:content-['']" onClick={onOpen}>
          <span className="block truncate text-body font-semibold text-ink">{project.name}</span>
        </button>
        <div className="relative z-[1] -mr-1 -mt-1 shrink-0">{menu}</div>
      </div>
      <span className="flex flex-wrap gap-1">{owners.map((owner) => <Pill key={owner} size="sm">{ownerLabel(owner)}</Pill>)}{!owners.length && <span className="text-2xs text-muted">还没有关联工具</span>}</span>
      <span className="mt-auto block truncate text-2xs text-muted">{projectRoleLabels[project.role]} · {project.grants.length} 个授权 · {formatRelative(project.updated_at)}更新{project.hidden ? " · 已隐藏" : ""}</span>
      {extra && <div className="relative z-[1]">{extra}</div>}
    </div>
  </div>;
}

/** The list's last tile: starting a project sits where the next one will appear. */
export function NewProjectTile({ onClick }: { onClick: () => void }) {
  return <button type="button" data-new-project-tile onClick={onClick} className="flex h-full min-h-48 w-full flex-col items-center justify-center gap-2 rounded-card border border-dashed border-line-strong/70 bg-transparent p-6 text-center text-ink-soft transition-colors hover:border-accent hover:bg-panel/60 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus">
    <span className="grid size-10 place-items-center rounded-full bg-panel-sunken"><Plus className="size-5" /></span>
    <span className="text-body-sm font-medium">新建项目</span>
    <span className="text-2xs text-muted">起名、关联工具、分配成员</span>
  </button>;
}
