import { useEffect, useRef, useState, type DragEvent } from "react";
import { Popover } from "./ui";
import {
  ArrowRight,
  AudioLines,
  Image,
  Video,
  ChevronDown,
  ChevronRight,
  Folder,
  FolderOpen,
  FolderPlus,
  GripVertical,
  Layers,
  SlidersHorizontal,
  Star,
  Undo2,
  X,
} from "./icons";
import { Button, Empty, Field, Modal, Pick, SearchBox } from "./ui";
import type { BrowserItem } from "./finder";
import { ExtendThumbnail } from "./extend-finder";
import { DraftGuard } from "./workspace";
import { LocalFilePreview } from "./local-file-preview";
import { assetContentLabels as contentLabels, projectName, serviceById, type Asset, type Scenario } from "./data";
import {
  folderDescendants,
  folderMoveError,
  folderNameError,
  filterLibraryAssets,
  type AssetFilters,
  type AssetLibraryState,
} from "./asset-library-state";
import type { ViewMode } from "./finder-state";

export type LibraryNotice = {
  id: string;
  title: string;
  text: string;
  asset?: string;
  tone: "success" | "info" | "warning";
};
interface Props {
  assets: Asset[];
  items: BrowserItem[];
  state: AssetLibraryState;
  setState: (state: AssetLibraryState) => void;
  filters: AssetFilters;
  setFilters: (filters: AssetFilters) => void;
  type: string;
  setType: (type: string) => void;
  query: string;
  setQuery: (query: string) => void;
  clearQuery: () => void;
  view: ViewMode;
  selected: string | null;
  writable: boolean;
  scenario: Scenario;
  onSelect: (item: BrowserItem) => void;
  onOpen: (item: BrowserItem) => void;
  onQuickLook: (item: BrowserItem, rect?: DOMRect) => void;
  onInfo: (item: BrowserItem) => void;
  onDirty: (dirty: boolean, discard?: () => void) => void;
  notify: (text: string) => void;
  guard: (action: () => void) => void;
  clearFilters: () => void;
}
const dragMime = "application/x-yeisme-library";
export function AssetLibrary(props: Props) {
  const {
    assets,
    state,
    setState,
    filters,
    setFilters,
    type,
    setType,
    query,
    clearQuery,
    writable,
    scenario,
    notify,
  } = props;
  const [expanded, setExpanded] = useState<string[]>(
    state.folders.map((f) => f.id),
  );
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [dragged, setDragged] = useState<{
    kind: "asset" | "folder";
    id: string;
  } | null>(null);
  const [dialog, setDialog] = useState<"create" | "move" | null>(null);
  const [name, setName] = useState("");
  const [target, setTarget] = useState("root");
  const [nameError, setNameError] = useState("");
  const [formError, setFormError] = useState("");
  const [guardOpen, setGuardOpen] = useState(false);
  const [moveSubject, setMoveSubject] = useState<{
    kind: "asset" | "folder";
    id: string;
  } | null>(null);
  const [undo, setUndo] = useState<{
    locations: AssetLibraryState["locations"];
    folders: AssetLibraryState["folders"];
    text: string;
  } | null>(null);
  const notifyDirty = useRef(props.onDirty);
  notifyDirty.current = props.onDirty;
  const dirty = dialog === "create" && !!name.trim();
  useEffect(() => {
    notifyDirty.current(dirty, () => {
      setDialog(null);
      setName("");
    });
    return () => notifyDirty.current(false);
  }, [dirty]);
  const close = () => {
    if (dirty) setGuardOpen(true);
    else setDialog(null);
  };
  const startCreate = () =>
    props.guard(() => {
      setName("");
      setNameError("");
      setFormError("");
      setTarget(
        state.folders.some((f) => f.id === filters.folder)
          ? filters.folder
          : "root",
      );
      setDialog("create");
    });
  const nameFor = (id: string | null) =>
    state.folders.find((f) => f.id === id)?.name || "全部资产";
  const move = (
    subject: { kind: "asset" | "folder"; id: string },
    destination: string,
  ): boolean => {
    if (!writable) {
      setFormError("当前身份或服务状态不允许整理目录。");
      notify("当前身份或服务状态不允许整理目录。");
      return false;
    }
    const parent = destination === "root" ? null : destination;
    let error = "";
    if (subject.kind === "folder")
      error = folderMoveError(state.folders, subject.id, parent);
    else if (!assets.some((a) => a.id === subject.id))
      error = "产物不在当前授权范围。";
    else if (parent && !state.folders.some((f) => f.id === parent))
      error = "目标目录已不存在。";
    else if ((state.locations[subject.id] || null) === parent)
      error = "产物已在此目录。";
    if (!error && scenario === "save_error")
      error = "目录保存失败，原位置未改变。请保留选择后重试。";
    if (!error && scenario === "conflict")
      error = "目录版本冲突，原位置未改变。请重新读取后再整理。";
    if (error) {
      setFormError(error);
      notify(error);
      return false;
    }
    setUndo({
      locations: state.locations,
      folders: state.folders,
      text: "已移动到「" + nameFor(parent) + "」",
    });
    if (subject.kind === "folder") {
      setState({
        ...state,
        folders: state.folders.map((f) =>
          f.id === subject.id ? { ...f, parent } : f,
        ),
      });
    } else {
      const locations = { ...state.locations };
      if (parent) locations[subject.id] = parent;
      else delete locations[subject.id];
      setState({ ...state, locations });
    }
    if (parent) setExpanded((v) => [...v, parent]);
    setFormError("");
    notify("演示目录已更新，固定版本和 owner 归属保持不变。");
    return true;
  };
  const drop = (event: DragEvent, id: string) => {
    event.preventDefault();
    event.stopPropagation();
    setDropTarget(null);
    try {
      const subject = JSON.parse(event.dataTransfer.getData(dragMime));
      if (dragged && subject.kind === dragged.kind && subject.id === dragged.id)
        props.guard(() => {
          move(dragged, id);
        });
    } catch {
      notify("请拖动当前工作台中的产物或目录。");
    }
    setDragged(null);
  };
  const dropProps = (id: string) => ({
    onDragOver: (event: DragEvent) => {
      if (writable && dragged) {
        event.preventDefault();
        event.stopPropagation();
        event.dataTransfer.dropEffect = "move";
        setDropTarget(id);
      }
    },
    onDragLeave: (event: DragEvent) => {
      if (!event.currentTarget.contains(event.relatedTarget as Node))
        setDropTarget(null);
    },
    onDrop: (event: DragEvent) => drop(event, id),
  });
  const folderRows = (parent: string | null, depth = 0): React.ReactNode =>
    state.folders
      .filter((f) => f.parent === parent)
      .map((folder) => {
        const children = state.folders.some((f) => f.parent === folder.id);
        const nested = folderDescendants(state.folders, folder.id);
        return (
          <div key={folder.id} className="library-folder-group">
            <div
              className="library-folder-row"
              data-selected={filters.folder === folder.id}
              data-drop={dropTarget === folder.id}
              data-od-id={"folder-" + folder.id}
              style={{ paddingLeft: 8 + depth * 16 }}
              draggable={writable}
              onDragStart={(e) => {
                const subject = { kind: "folder" as const, id: folder.id };
                setDragged(subject);
                e.dataTransfer.setData(dragMime, JSON.stringify(subject));
                e.dataTransfer.effectAllowed = "move";
              }}
              onDragEnd={() => {
                setDragged(null);
                setDropTarget(null);
              }}
              {...dropProps(folder.id)}
            >
              {children ? (
                <button
                  className="folder-expander"
                  aria-label={
                    (expanded.includes(folder.id) ? "折叠" : "展开") +
                    folder.name
                  }
                  aria-expanded={expanded.includes(folder.id)}
                  onClick={() =>
                    setExpanded((v) =>
                      v.includes(folder.id)
                        ? v.filter((id) => id !== folder.id)
                        : [...v, folder.id],
                    )
                  }
                >
                  {expanded.includes(folder.id) ? (
                    <ChevronDown size={14} />
                  ) : (
                    <ChevronRight size={14} />
                  )}
                </button>
              ) : (
                <span className="folder-spacer" />
              )}
              <button
                className="folder-label"
                aria-pressed={filters.folder === folder.id}
                onClick={() => setFilters({ ...filters, folder: folder.id })}
              >
                <Folder size={16} />
                <span>{folder.name}</span>
                <small>
                  {
                    assets.filter((a) => nested.has(state.locations[a.id]))
                      .length
                  }
                </small>
              </button>
            </div>
            {expanded.includes(folder.id) && folderRows(folder.id, depth + 1)}
          </div>
        );
      });
  const [directoryOpen, setDirectoryOpen] = useState(false);
  const [tableView, setTableView] = useState<"list" | "grid">("list");
  const [sortOrder, setSortOrder] = useState("date-desc");
  const [page, setPage] = useState(1);
  const [columns, setColumns] = useState({
    producer: true,
    project: true,
    service: true,
    review: true,
    date: true,
  });
  const filteredAssets = filterLibraryAssets(assets, state, filters, type, query);
  const sortedAssets = [...filteredAssets].sort((a, b) => {
    const value = sortOrder.startsWith("name")
      ? a.name.localeCompare(b.name, "zh-CN")
      : a.date.localeCompare(b.date);
    return sortOrder.endsWith("desc") ? -value : value;
  });
  const pageSize = 20;
  const pageCount = Math.max(1, Math.ceil(sortedAssets.length / pageSize));
  const visibleAssets = sortedAssets.slice((page - 1) * pageSize, page * pageSize);
  useEffect(() => {
    setPage(1);
  }, [
    type,
    query,
    filters.folder,
    filters.owner,
    filters.status,
    filters.producer,
    filters.content,
    filters.review,
    filters.project,
    filters.version,
    filters.from,
    filters.to,
  ]);
  useEffect(() => {
    if (page > pageCount) setPage(pageCount);
  }, [page, pageCount]);
  const itemFor = (asset: Asset): BrowserItem => ({
    id: asset.id,
    kind: "asset",
    name: asset.name,
    type: asset.type,
    subtitle: asset.producer + " · " + asset.version,
    status: contentLabels[asset.content],
    image: asset.image ? "./media/" + asset.image : undefined,
    detail: contentLabels[asset.content] + " · " + asset.review,
    owner: asset.owner,
  });
  const active = [
    filters.folder !== "all" && {
      label:
        filters.folder === "favorites"
          ? "已收藏"
          : filters.folder === "unfiled"
            ? "未归类"
            : nameFor(filters.folder),
      clear: () => setFilters({ ...filters, folder: "all" }),
    },
    type !== "all" && { label: type, clear: () => setType("all") },
    filters.producer !== "all" && {
      label: "生产者：" + filters.producer,
      clear: () => setFilters({ ...filters, producer: "all" }),
    },
    filters.owner !== "all" && {
      label: "服务：" + (serviceById(filters.owner)?.name || filters.owner),
      clear: () => setFilters({ ...filters, owner: "all" }),
    },
    filters.content !== "all" && {
      label: "内容：" + contentLabels[filters.content as Asset["content"]],
      clear: () => setFilters({ ...filters, content: "all" }),
    },
    filters.review !== "all" && {
      label: "审阅：" + filters.review,
      clear: () => setFilters({ ...filters, review: "all" }),
    },
    filters.project !== "all" && {
      label: "项目：" + projectName(filters.project),
      clear: () => setFilters({ ...filters, project: "all" }),
    },
    filters.status !== "all" && {
      label: "状态：" + filters.status,
      clear: () => setFilters({ ...filters, status: "all" }),
    },
    filters.version !== "all" && { label: "版本：" + filters.version, clear: () => setFilters({ ...filters, version: "all" }) },
    filters.from && { label: "开始：" + filters.from, clear: () => setFilters({ ...filters, from: "" }) },
    filters.to && { label: "结束：" + filters.to, clear: () => setFilters({ ...filters, to: "" }) },
    query && { label: "搜索：" + query, clear: clearQuery },
  ].filter((v): v is { label: string; clear: () => void } => !!v);
  const clear = props.clearFilters;
  const selectedAsset = assets.find((a) => a.id === props.selected);
  const currentFolder = state.folders.find((f) => f.id === filters.folder);
  return (
    <section className="asset-library" data-od-id="generation-asset-workspace">
      <header className="asset-page-heading">
        <div>
          <span className="asset-page-eyebrow">当前授权范围</span>
          <h2>资产与生产归因</h2>
          <p>生产者、上传者与当前负责人分别保留。</p>
        </div>
        <div className="asset-page-actions">
          <LocalFilePreview notify={notify} />
          <Button data-od-id="asset-directory-toggle" onClick={() => setDirectoryOpen((value) => !value)}>
            <FolderOpen size={15} />
            {directoryOpen ? "收起目录整理" : "目录整理"}
          </Button>
        </div>
      </header>

      {directoryOpen && (
        <aside className="library-directory library-directory-drawer" aria-label="目录整理" data-od-id="asset-directory">
          <div className="directory-heading">
            <strong>目录整理</strong>
            <Button disabled={!writable} onClick={startCreate}><FolderPlus size={15} />新建目录</Button>
          </div>
          <button className="library-shortcut" data-selected={filters.folder === "all"} data-drop={dropTarget === "root"} onClick={() => setFilters({ ...filters, folder: "all" })} {...dropProps("root")}>
            <Layers size={16} /><span>全部资产</span><small>{assets.length}</small>
          </button>
          <button className="library-shortcut" data-selected={filters.folder === "favorites"} onClick={() => setFilters({ ...filters, folder: "favorites" })}>
            <Star size={16} /><span>已收藏</span><small>{assets.filter((a) => state.favorites.includes(a.id)).length}</small>
          </button>
          <button className="library-shortcut" data-selected={filters.folder === "unfiled"} onClick={() => setFilters({ ...filters, folder: "unfiled" })}>
            <Folder size={16} /><span>未归类</span><small>{assets.filter((a) => !state.locations[a.id]).length}</small>
          </button>
          <div className="directory-divider" />
          <div className="directory-subheading">我的目录</div>
          {folderRows(null)}
          {currentFolder && (
            <Button className="directory-move" disabled={!writable} onClick={() => props.guard(() => {
              setMoveSubject({ kind: "folder", id: currentFolder.id });
              setTarget("root");
              setFormError("");
              setDialog("move");
            })}>
              移动此目录 <ArrowRight size={14} />
            </Button>
          )}
          <p className="directory-hint"><GripVertical size={15} />拖动资产或目录以整理位置；也可使用“移动到”。</p>
          <p className="directory-scope">目录整理只改变当前演示会话的位置。</p>
        </aside>
      )}

      <div className="asset-v17-surface">
        <div className="asset-view-controls" data-od-id="asset-view-controls">
          <div className="asset-view-toggle" role="group" aria-label="资产显示方式">
            <button type="button" className={tableView === "list" ? "active" : ""} aria-label="列表视图" aria-pressed={tableView === "list"} onClick={() => setTableView("list")}>列表</button>
            <button type="button" className={tableView === "grid" ? "active" : ""} aria-label="图标视图" aria-pressed={tableView === "grid"} onClick={() => setTableView("grid")}>网格</button>
          </div>
          <Pick label="资产排序" value={sortOrder} onChange={setSortOrder} options={[
            { value: "date-desc", label: "日期：最新在前" },
            { value: "date-asc", label: "日期：最早在前" },
            { value: "name-asc", label: "名称：升序" },
            { value: "name-desc", label: "名称：降序" },
          ]} />
          <Popover.Root>
            <Popover.Trigger className="button" data-od-id="asset-columns" aria-label="显示列">显示列</Popover.Trigger>
            <Popover.Portal>
              <Popover.Content className="library-filter-popover asset-columns-popover" sideOffset={8} align="end" collisionPadding={16}>
                <h3>显示列</h3>
                <p>名称、固定版本与内容状态始终显示。</p>
                {([
                  ["producer", "生产者"],
                  ["project", "项目"],
                  ["service", "服务"],
                  ["review", "审阅"],
                  ["date", "日期"],
                ] as const).map(([key, label]) => (
                  <label className="asset-column-option" key={key}>
                    <input type="checkbox" checked={columns[key]} data-column={key} onChange={(event) => setColumns({ ...columns, [key]: event.target.checked })} />
                    {label}
                  </label>
                ))}
              </Popover.Content>
            </Popover.Portal>
          </Popover.Root>
          <span className="library-result-count" role="status">{sortedAssets.length} 条 · 每页 {pageSize} 条</span>
        </div>

        <div className="library-filters asset-v17-filters" data-od-id="asset-filters">
          <SearchBox label="搜索资产" placeholder="搜索资产或来源" value={query} onChange={props.setQuery} />
          <Pick label="生产用户" value={filters.producer} onChange={(producer) => setFilters({ ...filters, producer })} options={[
            { value: "all", label: "全部生产者" },
            ...Array.from(new Set(assets.map((a) => a.producer))).map((producer) => ({ value: producer, label: producer })),
          ]} />
          <Pick label="媒体类型" value={type} onChange={setType} options={[
            { value: "all", label: "全部媒体" },
            ...["图像", "视频", "音频", "文稿", "文件"].map((value) => ({ value, label: value })),
          ]} />
          <Pick label="内容可用性" value={filters.content} onChange={(content) => setFilters({ ...filters, content })} options={[
            { value: "all", label: "全部内容状态" },
            ...Object.entries(contentLabels).map(([value, label]) => ({ value, label })),
          ]} />
          <Popover.Root>
            <Popover.Trigger className="button" data-od-id="advanced-asset-filters"><SlidersHorizontal size={15} />高级筛选{active.length > 0 && <span className="filter-count">{active.length}</span>}</Popover.Trigger>
            <Popover.Portal>
              <Popover.Content className="library-filter-popover asset-advanced-popover" sideOffset={8} align="start" collisionPadding={16}>
                <h3>高级筛选</h3><p>所有条件同时生效，结果即时更新。</p>
                <Field label="服务">
                  <Pick label="服务" value={filters.owner} onChange={(owner) => setFilters({ ...filters, owner })} options={[
                    { value: "all", label: "全部服务" },
                    ...Array.from(new Set(assets.map((a) => a.owner))).map((id) => ({ value: id, label: serviceById(id)?.name || id })),
                  ]} />
                </Field>
                <Field label="项目">
                  <Pick label="项目" value={filters.project} onChange={(project) => setFilters({ ...filters, project })} options={[
                    { value: "all", label: "全部项目" },
                    ...Array.from(new Set(assets.map((a) => a.project))).map((id) => ({ value: id, label: projectName(id) })),
                  ]} />
                </Field>
                <Field label="审阅状态">
                  <Pick label="审阅状态" value={filters.review} onChange={(review) => setFilters({ ...filters, review })} options={[
                    { value: "all", label: "全部审阅状态" },
                    ...Array.from(new Set(assets.map((a) => a.review))).map((value) => ({ value, label: value })),
                  ]} />
                </Field>
                <Field label="固定版本"><Pick label="固定版本" value={filters.version} onChange={(version) => setFilters({ ...filters, version })} options={[{value:"all",label:"全部版本"}, ...Array.from(new Set(assets.map(a => a.version))).sort().map(value => ({value,label:value}))]} /></Field>
                <Field label="开始日期"><input type="date" value={filters.from} onChange={e => setFilters({...filters, from:e.target.value})} /></Field>
                <Field label="结束日期"><input type="date" value={filters.to} onChange={e => setFilters({...filters, to:e.target.value})} /></Field>
                {filters.from && filters.to && filters.from > filters.to && <p role="alert">结束日期不能早于开始日期。</p>}
                <div className="filter-footer"><button onClick={clear}>清空筛选</button><Popover.Close className="button">完成</Popover.Close></div>
              </Popover.Content>
            </Popover.Portal>
          </Popover.Root>
        </div>

        {!!active.length && (
          <div className="library-active-filters filter-chips" data-od-id="asset-filter-chips">
            {active.map((chip) => (
              <button key={chip.label} onClick={chip.clear} aria-label={"移除筛选 " + chip.label}>{chip.label}<X size={12} /></button>
            ))}
            <button onClick={clear}>清除全部</button>
          </div>
        )}

        {directoryOpen && !!selectedAsset && (
          <div className="library-selection" data-od-id="asset-selection-actions">
            <span>已选择 1 项</span>
            <Button disabled={!writable} onClick={() => props.guard(() => {
              setMoveSubject({ kind: "asset", id: selectedAsset.id });
              setTarget(state.locations[selectedAsset.id] || "root");
              setFormError("");
              setDialog("move");
            })}><Folder size={14} />移动到</Button>
            <Button onClick={() => {
              const has = state.favorites.includes(selectedAsset.id);
              setState({ ...state, favorites: has ? state.favorites.filter((id) => id !== selectedAsset.id) : [...state.favorites, selectedAsset.id] });
              notify(has ? "已取消收藏。" : "已加入当前演示会话的收藏。");
            }}><Star size={14} />{state.favorites.includes(selectedAsset.id) ? "取消收藏" : "收藏"}</Button>
          </div>
        )}

        {tableView === "list" ? (
          <div className="asset-data-table-wrap">
            <table className="asset-data-table" data-od-id="asset-data-table">
              <caption className="sr-only">获授权资产列表</caption>
              <thead><tr>
                <th>资产名称</th><th>版本</th>
                {columns.producer && <th className="col-producer">生产者</th>}
                {columns.project && <th className="col-project">项目</th>}
                {columns.service && <th className="col-service">服务</th>}
                <th>内容状态</th>
                {columns.review && <th className="col-review">审阅</th>}
                {columns.date && <th className="col-date">日期</th>}
                <th><span className="sr-only">详情</span></th>
              </tr></thead>
              <tbody>
                {visibleAssets.map((asset) => (
                  <tr key={asset.id} data-asset-id={asset.id} data-object-id={asset.id} data-selected={props.selected === asset.id} draggable={writable && directoryOpen}
                    onDragStart={(e) => { const subject = {kind: "asset" as const, id:asset.id}; setDragged(subject); e.dataTransfer.setData(dragMime, JSON.stringify(subject)); e.dataTransfer.effectAllowed = "move"; }}
                    onDragEnd={() => {setDragged(null); setDropTarget(null);}}
                    onClick={() => directoryOpen ? props.onSelect(itemFor(asset)) : props.onInfo(itemFor(asset))}>
                    <td><div className="asset-name-cell">
                      {asset.image && asset.content === "available" ? <ExtendThumbnail src={"./media/" + asset.image} small /> : <span className={"asset-type-icon " + asset.content}>{asset.type === "音频" ? <AudioLines size={18} /> : asset.type === "视频" ? <Video size={18} /> : <Image size={18} />}</span>}
                      <div><button className="asset-name-button" onClick={e => {e.stopPropagation(); props.onInfo(itemFor(asset));}}>{asset.name}</button><small>{asset.type}</small></div>
                    </div></td>
                    <td><span className="version-tag">{asset.version}</span></td>
                    {columns.producer && <td className="col-producer">{asset.producer}</td>}
                    {columns.project && <td className="col-project">{projectName(asset.project)}</td>}
                    {columns.service && <td className="col-service">{serviceById(asset.owner)?.name || asset.owner}</td>}
                    <td><span className={"asset-content-badge " + asset.content}>{contentLabels[asset.content]}</span></td>
                    {columns.review && <td className="col-review">{asset.review}</td>}
                    {columns.date && <td className="col-date">{asset.date}</td>}
                    <td><button type="button" className="asset-row-detail" aria-label={"查看资产 " + asset.name} onClick={e => {e.stopPropagation(); props.onInfo(itemFor(asset));}}><ChevronRight size={15} /></button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="asset-v17-grid">
            {visibleAssets.map((asset) => (
              <article key={asset.id} className="asset-v17-card" data-asset-id={asset.id} draggable={writable && directoryOpen}
                    onDragStart={(e) => { const subject = {kind: "asset" as const, id:asset.id}; setDragged(subject); e.dataTransfer.setData(dragMime, JSON.stringify(subject)); e.dataTransfer.effectAllowed = "move"; }}
                    onDragEnd={() => {setDragged(null); setDropTarget(null);}}
                    onClick={() => directoryOpen ? props.onSelect(itemFor(asset)) : props.onInfo(itemFor(asset))}>
                {asset.image && asset.content === "available" ? <ExtendThumbnail src={"./media/" + asset.image} /> : <div className="asset-v17-placeholder"><strong>{asset.type === "音频" ? <AudioLines /> : asset.type === "视频" ? <Video /> : <Image />}</strong><span>{contentLabels[asset.content]}</span></div>}
                <div className="asset-v17-card-copy"><small>{serviceById(asset.owner)?.name || asset.owner} · {asset.version}</small><h2><button onClick={e => {e.stopPropagation(); props.onInfo(itemFor(asset));}}>{asset.name}</button></h2><p>生产者：{asset.producer}</p><p>{contentLabels[asset.content]} · {asset.review}</p></div>
              </article>
            ))}
          </div>
        )}

        {!visibleAssets.length && (
          <Empty title="当前授权和筛选条件下没有资源" description={assets.length ? "没有符合当前条件的资产；没有产物的请求仍可在请求页查询。" : "当前授权范围暂无资产，切换项目或环境后再查看。"} action={active.length ? <Button onClick={clear}>清空筛选</Button> : undefined} />
        )}

        <div className="asset-pagination" aria-label="资产分页">
          <span>{sortedAssets.length ? (page - 1) * pageSize + 1 + "–" + Math.min(page * pageSize, sortedAssets.length) + " / " + sortedAssets.length : "0 条"}</span>
          <div><button type="button" disabled={page <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))}>上一页</button><span>第 {page} / {pageCount} 页</span><button type="button" disabled={page >= pageCount} onClick={() => setPage((value) => Math.min(pageCount, value + 1))}>下一页</button></div>
        </div>
        <div className="library-footnote">固定版本 · 保留来源 · 生产归因、内容权限与审阅状态分别记录</div>
      </div>

      {undo && (
        <div className="library-undo" role="status">
          <span>{undo.text}</span>
          <Button disabled={!writable} onClick={() => {
            setState({ ...state, folders: undo.folders, locations: undo.locations });
            setUndo(null);
            notify("已撤销上一次目录移动。");
          }}><Undo2 size={15} />撤销</Button>
          <button aria-label="关闭移动回执" onClick={() => setUndo(null)}><X size={15} /></button>
        </div>
      )}
      <Modal
        open={!!dialog}
        close={close}
        title={dialog === "create" ? "新建产物目录" : "移动到目录"}
        description={
          dialog === "create"
            ? "为生成产物建立清晰的组织方式，原始引用保持不变。"
            : "仅调整当前演示会话的目录位置，不复制文件或改变 owner。"
        }
      >
        <form
          className="library-form"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            if (!writable) {
              setFormError("当前身份或服务状态不允许此操作。");
              return;
            }
            if (dialog === "move") {
              if (moveSubject && move(moveSubject, target)) setDialog(null);
              return;
            }
            const error = folderNameError(
              name,
              state.folders,
              target === "root" ? null : target,
            );
            setNameError(error);
            if (error) {
              document.getElementById("library-folder-name")?.focus();
              return;
            }
            if (scenario === "save_error" || scenario === "conflict") {
              setFormError(
                scenario === "conflict"
                  ? "目录版本已变化，草稿已保留。请关闭后重新读取当前目录。"
                  : "保存失败，草稿已保留，请稍后重试。",
              );
              return;
            }
            const id = "folder-" + (state.folders.length + 1);
            setUndo(null);
            setState({
              ...state,
              folders: [
                ...state.folders,
                {
                  id,
                  name: name.trim(),
                  parent: target === "root" ? null : target,
                },
              ],
            });
            if (target !== "root") setExpanded((v) => [...v, target]);
            setName("");
            setDialog(null);
            notify("已创建目录「" + name.trim() + "」，可将产物拖入归类。");
          }}
        >
          {dialog === "create" && (
            <Field
              label="目录名称"
              required
              error={nameError}
              hint="最多 40 个字符，同一级目录内不可重名。"
            >
              <input
                id="library-folder-name"
                data-od-id="folder-name-input"
                autoFocus
                value={name}
                placeholder="例如：第一集 · 视觉候选"
                onChange={(e) => {
                  setName(e.target.value);
                  setNameError("");
                  setFormError("");
                }}
                onBlur={() =>
                  setNameError(
                    folderNameError(
                      name,
                      state.folders,
                      target === "root" ? null : target,
                    ),
                  )
                }
              />
            </Field>
          )}
          {dialog === "move" && (
            <div className="move-subject">
              <FolderOpen size={20} />
              <span>
                {moveSubject?.kind === "folder"
                  ? nameFor(moveSubject.id)
                  : assets.find((a) => a.id === moveSubject?.id)?.name}
              </span>
            </div>
          )}
          <Field label={dialog === "create" ? "上级目录" : "目标目录"}>
            <Pick
              label={dialog === "create" ? "上级目录" : "目标目录"}
              value={target}
              onChange={(value) => {
                setTarget(value);
                setNameError("");
                setFormError("");
              }}
              options={[
                { value: "root", label: "资产（根目录）" },
                ...state.folders
                  .filter(
                    (f) =>
                      !(
                        dialog === "move" &&
                        moveSubject?.kind === "folder" &&
                        folderDescendants(state.folders, moveSubject.id).has(
                          f.id,
                        )
                      ),
                  )
                  .map((f) => ({
                    value: f.id,
                    label: f.parent
                      ? nameFor(f.parent) + " / " + f.name
                      : f.name,
                  })),
              ]}
            />
          </Field>
          {formError && (
            <p className="library-form-error" role="alert">
              {formError}
            </p>
          )}
          <div className="library-form-note">
            设计演示 · 刷新后重置，不写入真实文件系统。
          </div>
          <div className="library-form-actions">
            <Button onClick={close}>取消</Button>
            <Button
              variant="primary"
              type="submit"
              disabled={!writable}
              data-od-id="confirm-library-form"
            >
              {dialog === "create" ? "创建目录" : "确认移动"}
            </Button>
          </div>
        </form>
      </Modal>
      <DraftGuard
        open={guardOpen}
        cancel={() => setGuardOpen(false)}
        discard={() => {
          setGuardOpen(false);
          setName("");
          setDialog(null);
        }}
      />
    </section>
  );
}
