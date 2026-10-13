import { useEffect, useRef, useState, type DragEvent } from "react";
import { Popover } from "./ui";
import {
  ArrowRight,
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
import { Button, Empty, Field, Modal, Pick } from "./ui";
import { ObjectBrowser, type BrowserItem } from "./finder";
import { DraftGuard } from "./workspace";
import { LocalFilePreview } from "./local-file-preview";
import { serviceById, type Asset, type Scenario } from "./data";
import {
  folderDescendants,
  folderMoveError,
  folderNameError,
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
    items,
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
    state.folders.find((f) => f.id === id)?.name || "全部产物";
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
  const active = [
    type !== "all" && { label: type, clear: () => setType("all") },
    filters.owner !== "all" && {
      label: serviceById(filters.owner)?.name || filters.owner,
      clear: () => setFilters({ ...filters, owner: "all" }),
    },
    filters.status !== "all" && {
      label: filters.status,
      clear: () => setFilters({ ...filters, status: "all" }),
    },
    query && { label: "搜索：" + query, clear: clearQuery },
  ].filter((v): v is { label: string; clear: () => void } => !!v);
  const clear = props.clearFilters;
  const selectedAsset = assets.find((a) => a.id === props.selected);
  const currentFolder = state.folders.find((f) => f.id === filters.folder);
  const folderPath: typeof state.folders = [];
  let cursor = currentFolder;
  while (cursor && !folderPath.some((f) => f.id === cursor!.id)) {
    folderPath.unshift(cursor);
    cursor = state.folders.find((f) => f.id === cursor!.parent);
  }
  return (
    <section className="asset-library" data-od-id="generation-asset-workspace">
      <div className="library-summary" data-od-id="asset-summary">
        <span>
          <strong>{assets.length}</strong> 项产物
        </span>
        <span>
          <strong>{new Set(assets.map((a) => a.type)).size}</strong> 种格式
        </span>
        <span>
          <strong>
            {assets.filter((a) => a.state.startsWith("待")).length}
          </strong>{" "}
          项待确认
        </span>
        <Button
          variant="primary"
          data-od-id="create-folder"
          onClick={startCreate}
          disabled={!writable}
        >
          <FolderPlus size={16} />
          新建目录
        </Button>
      </div>
      <div className="library-shell">
        <aside
          className="library-directory"
          aria-label="产物目录"
          data-od-id="asset-directory"
        >
          <div className="directory-heading">
            <strong>资源目录</strong>
            <FolderOpen size={15} />
          </div>
          <button
            className="library-shortcut"
            data-selected={filters.folder === "all"}
            data-drop={dropTarget === "root"}
            onClick={() => setFilters({ ...filters, folder: "all" })}
            {...dropProps("root")}
          >
            <Layers size={16} />
            <span>全部产物</span>
            <small>{assets.length}</small>
          </button>
          <button
            className="library-shortcut"
            data-selected={filters.folder === "favorites"}
            onClick={() => setFilters({ ...filters, folder: "favorites" })}
          >
            <Star size={16} />
            <span>已收藏</span>
            <small>
              {assets.filter((a) => state.favorites.includes(a.id)).length}
            </small>
          </button>
          <button
            className="library-shortcut"
            data-selected={filters.folder === "unfiled"}
            onClick={() => setFilters({ ...filters, folder: "unfiled" })}
          >
            <Folder size={16} />
            <span>未归类</span>
            <small>{assets.filter((a) => !state.locations[a.id]).length}</small>
          </button>
          <div className="directory-divider" />
          <div className="directory-subheading">我的目录</div>
          {folderRows(null)}
          {currentFolder && (
            <Button
              className="directory-move"
              disabled={!writable}
              onClick={() =>
                props.guard(() => {
                  setMoveSubject({ kind: "folder", id: currentFolder.id });
                  setTarget("root");
                  setFormError("");
                  setDialog("move");
                })
              }
            >
              移动此目录
              <ArrowRight size={14} />
            </Button>
          )}
          <p className="directory-hint">
            <GripVertical size={15} />
            拖动产物或目录以整理位置；也可使用“移动到”。
          </p>
          <p className="directory-scope">仅当前演示会话，不改变领域归属。</p>
        </aside>
        <div className="library-content">
          <div className="library-breadcrumb" data-od-id="asset-breadcrumb">
            <button onClick={() => setFilters({ ...filters, folder: "all" })}>
              产物库
            </button>
            {folderPath.map((f) => (
              <span key={f.id}>
                <ChevronRight size={13} />
                <button
                  onClick={() => setFilters({ ...filters, folder: f.id })}
                >
                  {f.name}
                </button>
              </span>
            ))}
            {!currentFolder && (
              <span>
                <ChevronRight size={13} />
                {
                  { all: "全部产物", favorites: "已收藏", unfiled: "未归类" }[
                    filters.folder
                  ]
                }
              </span>
            )}
          </div>
          <div className="library-filters" data-od-id="asset-filters">
            <Pick
              label="资产类型"
              value={type}
              onChange={setType}
              options={[
                { value: "all", label: "全部类型" },
                ...["图像", "视频", "音频", "文稿", "文件"].map((x) => ({
                  value: x,
                  label: x,
                })),
              ]}
            />
            <Popover.Root>
              <Popover.Trigger
                className="button"
                data-od-id="advanced-asset-filters"
              >
                <SlidersHorizontal size={15} />
                筛选
                {active.length > 0 && (
                  <span className="filter-count">{active.length}</span>
                )}
              </Popover.Trigger>
              <Popover.Portal>
                <Popover.Content
                  className="library-filter-popover"
                  sideOffset={8}
                  align="start"
                  collisionPadding={16}
                >
                  <h3>组合筛选</h3>
                  <p>所有条件同时生效，结果即时更新。</p>
                  <Field label="生成来源">
                    <Pick
                      label="生成来源"
                      value={filters.owner}
                      onChange={(owner) => setFilters({ ...filters, owner })}
                      options={[
                        { value: "all", label: "全部来源" },
                        ...Array.from(new Set(assets.map((a) => a.owner))).map(
                          (id) => ({
                            value: id,
                            label: serviceById(id)?.name || id,
                          }),
                        ),
                      ]}
                    />
                  </Field>
                  <Field label="产物状态">
                    <Pick
                      label="产物状态"
                      value={filters.status}
                      onChange={(status) => setFilters({ ...filters, status })}
                      options={[
                        { value: "all", label: "全部状态" },
                        ...Array.from(new Set(assets.map((a) => a.state))).map(
                          (s) => ({ value: s, label: s }),
                        ),
                      ]}
                    />
                  </Field>
                  <div className="filter-footer">
                    <button onClick={clear}>重置条件</button>
                    <Popover.Close className="button">完成</Popover.Close>
                  </div>
                </Popover.Content>
              </Popover.Portal>
            </Popover.Root>
            <LocalFilePreview notify={notify} />
            <span className="library-result-count" role="status">
              {items.length} 项结果
            </span>
          </div>
          {!!active.length && (
            <div className="library-active-filters">
              {active.map((chip) => (
                <button
                  key={chip.label}
                  onClick={chip.clear}
                  aria-label={"移除筛选 " + chip.label}
                >
                  {chip.label}
                  <X size={12} />
                </button>
              ))}
              <button onClick={clear}>清除全部</button>
            </div>
          )}
          {!!selectedAsset && (
            <div
              className="library-selection"
              data-od-id="asset-selection-actions"
            >
              <span>已选择 1 项</span>
              <Button
                disabled={!writable}
                onClick={() =>
                  props.guard(() => {
                    setMoveSubject({ kind: "asset", id: selectedAsset.id });
                    setTarget(state.locations[selectedAsset.id] || "root");
                    setFormError("");
                    setDialog("move");
                  })
                }
              >
                <Folder size={14} />
                移动到
              </Button>
              <Button
                onClick={() => {
                  const has = state.favorites.includes(selectedAsset.id);
                  setState({
                    ...state,
                    favorites: has
                      ? state.favorites.filter((id) => id !== selectedAsset.id)
                      : [...state.favorites, selectedAsset.id],
                  });
                  notify(has ? "已取消收藏。" : "已加入当前演示会话的收藏。");
                }}
              >
                <Star size={14} />
                {state.favorites.includes(selectedAsset.id)
                  ? "取消收藏"
                  : "收藏"}
              </Button>
              <Button
                onClick={() =>
                  props.onInfo(items.find((i) => i.id === selectedAsset.id)!)
                }
              >
                查看详情
                <ArrowRight size={14} />
              </Button>
            </div>
          )}
          <div
            onDragStart={(event) => {
              const element = (
                event.target as HTMLElement
              ).closest<HTMLElement>("[data-object-id]");
              const id = element?.dataset.objectId;
              if (writable && id && assets.some((a) => a.id === id)) {
                const subject = { kind: "asset" as const, id };
                setDragged(subject);
                event.dataTransfer.setData(dragMime, JSON.stringify(subject));
                event.dataTransfer.effectAllowed = "move";
              }
            }}
            onDragEnd={() => {
              setDragged(null);
              setDropTarget(null);
            }}
          >
            <ObjectBrowser
              items={items}
              view={props.view}
              selected={props.selected}
              onSelect={props.onSelect}
              onOpen={props.onOpen}
              onQuickLook={props.onQuickLook}
              onInfo={props.onInfo}
              label="资产浏览器"
              draggable={writable}
            />
          </div>
          {!items.length && (
            <Empty
              title="这里还没有匹配的产物"
              description={
                assets.length
                  ? "试试其他目录，或清除筛选条件。现有产物不会被删除。"
                  : "当前授权范围暂无产物，切换项目或环境后再查看。"
              }
              action={
                active.length ? (
                  <Button onClick={clear}>清除筛选</Button>
                ) : undefined
              }
            />
          )}
          <div className="library-footnote">
            固定版本 · 保留来源 · 权利由原服务管理
          </div>
        </div>
      </div>
      {undo && (
        <div className="library-undo" role="status">
          <span>{undo.text}</span>
          <Button
            disabled={!writable}
            onClick={() => {
              setState({
                ...state,
                folders: undo.folders,
                locations: undo.locations,
              });
              setUndo(null);
              notify("已撤销上一次目录移动。");
            }}
          >
            <Undo2 size={15} />
            撤销
          </Button>
          <button aria-label="关闭移动回执" onClick={() => setUndo(null)}>
            <X size={15} />
          </button>
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
                { value: "root", label: "产物库（根目录）" },
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
