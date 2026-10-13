import {
  Children,
  isValidElement,
  type ReactElement,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { DropdownMenu, Popover, Checkbox, Tabs } from "./index";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Check,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Columns3,
  Download,
  ListFilter,
  MoreHorizontal,
  Save,
  Search,
  X,
  CalendarDays,
} from "../../icons";
import {
  useTable,
  tableFeatures,
  rowSortingFeature,
  rowPaginationFeature,
  columnVisibilityFeature,
  createSortedRowModel,
  createPaginatedRowModel,
  sortFns,
  type ColumnDef,
} from "@tanstack/react-table";
import { Button, Empty, Field, Pick, Modal } from "./index";
import { RightWorkspace } from "../../workspace";
import { exportCSV, defaultQuery, type HistoryQuery } from "../../admin-state";

const features = tableFeatures({
  rowSortingFeature,
  rowPaginationFeature,
  columnVisibilityFeature,
  sortedRowModel: createSortedRowModel(),
  paginatedRowModel: createPaginatedRowModel(),
  sortFns,
});
export interface DataColumn<T> {
  id: string;
  label: string;
  value: (row: T) => string | number | null;
  render?: (row: T) => ReactNode;
  hidden?: boolean;
  numeric?: boolean;
  primary?: boolean;
  width?: number;
}
export function CheckBox({
  checked,
  onChange,
  label,
}: {
  checked: boolean | "indeterminate";
  onChange: (value: boolean) => void;
  label: string;
}) {
  return (
    <Checkbox.Root
      className="admin-checkbox"
      aria-label={label}
      checked={checked}
      onCheckedChange={(v) => onChange(v === true)}
    >
      <Checkbox.Indicator>
        <Check size={12} />
      </Checkbox.Indicator>
    </Checkbox.Root>
  );
}
export function AdminTabs({
  value,
  onChange,
  items,
}: {
  value: string;
  onChange: (value: string) => void;
  items: { id: string; label: string; count?: number; icon?: ReactNode }[];
}) {
  return (
    <Tabs.Root value={value} onValueChange={onChange} className="admin-tabs">
      <Tabs.List aria-label="内容视图">
        {items.map((i) => (
          <Tabs.Trigger key={i.id} value={i.id}>
            {i.icon && <span className="admin-tab-icon">{i.icon}</span>}
            {i.label}
            {i.count !== undefined && (
              <span className="admin-tab-count">{i.count}</span>
            )}
          </Tabs.Trigger>
        ))}
      </Tabs.List>
    </Tabs.Root>
  );
}
export function PageActions({ action }: { action?: ReactNode }) {
  return action ? <div className="page-actions">{action}</div> : null;
}
export function Kpis({
  items,
}: {
  items: { label: string; value: ReactNode; note: string; tone?: string }[];
}) {
  return (
    <div className="admin-kpis">
      {items.map((i) => (
        <div key={i.label}>
          <span>{i.label}</span>
          <strong className={i.tone || ""}>{i.value}</strong>
          <small>{i.note}</small>
        </div>
      ))}
    </div>
  );
}
function readView(id: string) {
  try {
    return JSON.parse(
      localStorage.getItem("yeisme-control-center.ui.table." + id) || "null",
    );
  } catch {
    return null;
  }
}
export function DataTable<T extends { id: string }>({
  id,
  label,
  rows,
  columns,
  onOpen,
  selection,
  onSelection,
  actions,
  empty = "当前范围没有记录",
  filters,
  coverage = "完整演示数据",
  viewState,
  onRestoreView,
  presentation = "page",
  toolbarActions,
  exportScope = "filtered",
}: {
  id: string;
  label: string;
  toolbarActions?: ReactNode;
  exportScope?: "filtered" | "batch";
  presentation?: "page" | "embedded";
  rows: T[];
  columns: DataColumn<T>[];
  onOpen?: (row: T) => void;
  selection?: string[];
  onSelection?: (ids: string[]) => void;
  actions?: (rows: T[]) => ReactNode;
  empty?: string;
  filters?: ReactNode;
  coverage?: string;
  viewState?: unknown;
  onRestoreView?: (state: unknown) => void;
}) {
  const [saved] = useState(() => readView(id)),
    [dense, setDense] = useState(saved?.dense || false),
    [chosen, setChosen] = useState<string[]>([]),
    [message, setMessage] = useState(""),
    [exportOpen, setExportOpen] = useState(false);
  const selected = selection ?? chosen,
    setSelected = onSelection ?? setChosen;
  const cols = useMemo<ColumnDef<typeof features, T>[]>(
    () =>
      columns.map((c) => ({
        id: c.id,
        header: c.label,
        accessorFn: c.value,
        sortFn: "alphanumeric",
        enableHiding: !c.primary,
      })),
    [columns],
  );
  const table = useTable({
    features,
    data: rows,
    columns: cols,
    autoResetPageIndex: false,
    getRowId: (r) => r.id,
    initialState: {
      pagination: { pageIndex: 0, pageSize: 25 },
      columnVisibility:
        saved?.visibility ||
        Object.fromEntries(
          columns.filter((c) => c.hidden).map((c) => [c.id, false]),
        ),
      sorting:
        saved?.sorting ||
        (columns.some((c) => c.id === "time")
          ? [{ id: "time", desc: true }]
          : []),
    },
  });
  const ids = rows.map((r) => r.id).join("|"),
    lastIds = useRef(ids);
  useEffect(() => {
    if (lastIds.current !== ids) {
      setSelected([]);
      table.setPageIndex(0);
      lastIds.current = ids;
    }
  }, [ids]);
  const current = table.getRowModel().rows,
    visible = table.getVisibleLeafColumns();
  const pageIds = current.map((r) => r.id),
    count = pageIds.filter((r) => selected.includes(r)).length;
  const pages = table.getPageCount(),
    page = table.state.pagination.pageIndex;
  const save = () => {
    try {
      localStorage.setItem(
        "yeisme-control-center.ui.table." + id,
        JSON.stringify({
          visibility: table.state.columnVisibility,
          sorting: table.state.sorting,
          dense,
          query: viewState,
        }),
      );
      setMessage("已保存此范围的个人视图。");
    } catch {
      setMessage("浏览器存储不可用，当前视图仍可继续使用。");
    }
  };
  const reset = () => {
    table.setColumnVisibility(
      Object.fromEntries(
        columns.filter((c) => c.hidden).map((c) => [c.id, false]),
      ),
    );
    table.setSorting(
      columns.some((c) => c.id === "time") ? [{ id: "time", desc: true }] : [],
    );
    table.setPageIndex(0);
    setSelected([]);
    setDense(false);
    setMessage("已恢复默认表格视图。");
  };
  const openRow = (e: React.MouseEvent | React.KeyboardEvent, row: T) => {
    if ((e.target as HTMLElement).closest("button,input,a,[role=checkbox]"))
      return;
    onOpen?.(row);
  };
  return (
    <div
      className={"admin-table-block " + (dense ? "dense " : "") + presentation}
      data-slot="card"
      data-table-id={id}
    >
      {presentation === "page" && (
        <div className="admin-table-toolbar">
          <div className="table-filters">
            {filters || (
              <span className="table-caption">
                {label}
                <b>{rows.length}</b>
              </span>
            )}
          </div>
          <div className="table-tools">
            <DropdownMenu.Root modal={false}>
              <DropdownMenu.Trigger asChild>
                <Button variant="outline" aria-label="列表选项">
                  <Columns3 size={16} />
                  <span>显示</span>
                </Button>
              </DropdownMenu.Trigger>
              <DropdownMenu.Portal>
                <DropdownMenu.Content
                  className="admin-menu"
                  align="end"
                  sideOffset={6}
                >
                  <DropdownMenu.Sub>
                    <DropdownMenu.SubTrigger className="admin-menu-item">
                      显示列 <ChevronRight size={14} />
                    </DropdownMenu.SubTrigger>
                    <DropdownMenu.Portal>
                      <DropdownMenu.SubContent
                        className="admin-menu"
                        sideOffset={0}
                      >
                        {table.getAllLeafColumns().map((c) => (
                          <DropdownMenu.CheckboxItem
                            disabled={!c.getCanHide()}
                            className="admin-menu-item"
                            key={c.id}
                            checked={c.getIsVisible()}
                            onSelect={(e) => e.preventDefault()}
                            onCheckedChange={(v) => c.toggleVisibility(!!v)}
                          >
                            <span>
                              {columns.find((x) => x.id === c.id)?.label}
                            </span>
                            {c.getIsVisible() && <Check size={14} />}
                          </DropdownMenu.CheckboxItem>
                        ))}
                      </DropdownMenu.SubContent>
                    </DropdownMenu.Portal>
                  </DropdownMenu.Sub>
                  <DropdownMenu.Sub>
                    <DropdownMenu.SubTrigger className="admin-menu-item">
                      排序 <ChevronRight size={14} />
                    </DropdownMenu.SubTrigger>
                    <DropdownMenu.Portal>
                      <DropdownMenu.SubContent
                        className="admin-menu"
                        sideOffset={0}
                      >
                        {table.getAllLeafColumns().map((c) => (
                          <DropdownMenu.Item
                            className="admin-menu-item"
                            key={c.id}
                            onSelect={() =>
                              c.toggleSorting(c.getIsSorted() === "asc")
                            }
                          >
                            {columns.find((x) => x.id === c.id)?.label}
                            {c.getIsSorted() === "asc" ? (
                              <ArrowUp size={14} />
                            ) : c.getIsSorted() === "desc" ? (
                              <ArrowDown size={14} />
                            ) : null}
                          </DropdownMenu.Item>
                        ))}
                      </DropdownMenu.SubContent>
                    </DropdownMenu.Portal>
                  </DropdownMenu.Sub>
                  <DropdownMenu.CheckboxItem
                    className="admin-menu-item"
                    checked={dense}
                    onCheckedChange={setDense}
                  >
                    紧凑行距 {dense && <Check size={14} />}
                  </DropdownMenu.CheckboxItem>
                  <DropdownMenu.Separator />
                  <DropdownMenu.Item
                    className="admin-menu-item"
                    onSelect={save}
                  >
                    保存当前视图
                  </DropdownMenu.Item>
                  <DropdownMenu.Item
                    className="admin-menu-item"
                    disabled={!readView(id)}
                    onSelect={() => {
                      const v = readView(id);
                      if (v) {
                        table.setColumnVisibility(v.visibility);
                        table.setSorting(v.sorting);
                        setDense(v.dense);
                        if (v.query && onRestoreView) onRestoreView(v.query);
                        setMessage("已恢复个人视图。");
                      }
                    }}
                  >
                    恢复已保存视图
                  </DropdownMenu.Item>
                  <DropdownMenu.Item
                    className="admin-menu-item"
                    onSelect={reset}
                  >
                    恢复默认
                  </DropdownMenu.Item>
                  <DropdownMenu.Separator />
                  <DropdownMenu.Item
                    className="admin-menu-item"
                    disabled={!rows.length}
                    onSelect={() => setExportOpen(true)}
                    aria-label={"导出" + label}
                  >
                    <Download size={15} />
                    导出记录
                  </DropdownMenu.Item>
                </DropdownMenu.Content>
              </DropdownMenu.Portal>
            </DropdownMenu.Root>
            {toolbarActions}
          </div>
        </div>
      )}
      {message && (
        <div className="table-message" role="status">
          {message}
          <button aria-label="关闭表格提示" onClick={() => setMessage("")}>
            <X size={13} />
          </button>
        </div>
      )}
      {!!selected.length && (
        <div className="admin-selection">
          <span>已选择 {selected.length} 项 · 当前页范围</span>
          {actions?.(rows.filter((r) => selected.includes(r.id)))}
          <Button variant="ghost small" onClick={() => setSelected([])}>
            取消选择
          </Button>
        </div>
      )}
      <div className="admin-table-scroll">
        <table className="admin-data-table" aria-label={label}>
          <thead>
            <tr>
              {actions && (
                <th className="selection-col">
                  <CheckBox
                    label={"选择当前页" + label}
                    checked={
                      count === pageIds.length && !!count
                        ? true
                        : count
                          ? "indeterminate"
                          : false
                    }
                    onChange={(v) => setSelected(v ? pageIds : [])}
                  />
                </th>
              )}
              {visible.map((c) => {
                const def = columns.find((x) => x.id === c.id)!;
                return (
                  <th
                    key={c.id}
                    className={
                      (def.primary ? "sticky-primary " : "") +
                      (def.numeric ? "number" : "")
                    }
                    aria-sort={
                      c.getIsSorted() === "asc"
                        ? "ascending"
                        : c.getIsSorted() === "desc"
                          ? "descending"
                          : "none"
                    }
                    style={{ minWidth: def.width }}
                  >
                    <button onClick={c.getToggleSortingHandler()}>
                      {def.label}
                      {c.getIsSorted() === "asc" ? (
                        <ArrowUp size={13} />
                      ) : c.getIsSorted() === "desc" ? (
                        <ArrowDown size={13} />
                      ) : (
                        <ArrowUpDown size={13} />
                      )}
                    </button>
                  </th>
                );
              })}
              {onOpen && (
                <th className="sticky-actions">
                  <span className="sr-only">操作</span>
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {current.map((r) => (
              <tr
                key={r.id}
                tabIndex={onOpen ? 0 : undefined}
                aria-selected={selected.includes(r.id)}
                onClick={(e) => openRow(e, r.original)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    openRow(e, r.original);
                  }
                }}
              >
                {actions && (
                  <td className="selection-col">
                    <CheckBox
                      label={"选择 " + String(columns[0].value(r.original))}
                      checked={selected.includes(r.id)}
                      onChange={(v) =>
                        setSelected(
                          v
                            ? [...selected, r.id]
                            : selected.filter((x) => x !== r.id),
                        )
                      }
                    />
                  </td>
                )}
                {visible.map((c) => {
                  const d = columns.find((x) => x.id === c.id)!;
                  return (
                    <td
                      key={c.id}
                      className={
                        (d.primary ? "sticky-primary " : "") +
                        (d.numeric ? "number" : "")
                      }
                      data-column={d.id}
                      data-label={d.label}
                    >
                      {d.render?.(r.original) ?? d.value(r.original) ?? "—"}
                    </td>
                  );
                })}
                {onOpen && (
                  <td className="sticky-actions">
                    <DropdownMenu.Root>
                      <DropdownMenu.Trigger asChild>
                        <button
                          className="icon-button"
                          aria-label={
                            "更多操作 " + columns[0].value(r.original)
                          }
                        >
                          <MoreHorizontal size={16} />
                        </button>
                      </DropdownMenu.Trigger>
                      <DropdownMenu.Portal>
                        <DropdownMenu.Content
                          className="admin-menu"
                          align="end"
                        >
                          <DropdownMenu.Item
                            className="admin-menu-item"
                            onSelect={() => onOpen(r.original)}
                          >
                            查看详情
                            <ChevronRight size={14} />
                          </DropdownMenu.Item>
                          <DropdownMenu.Item
                            className="admin-menu-item"
                            onSelect={() =>
                              navigator.clipboard
                                ?.writeText(r.id)
                                .then(() => setMessage("引用已复制。"))
                                .catch(() =>
                                  setMessage(
                                    "复制失败，可在详情中查看完整引用。",
                                  ),
                                )
                            }
                          >
                            复制完整引用
                          </DropdownMenu.Item>
                        </DropdownMenu.Content>
                      </DropdownMenu.Portal>
                    </DropdownMenu.Root>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!rows.length && <Empty title={empty} />}
      {presentation === "page" && (
        <div className="admin-pagination">
          <span>
            {exportScope === "batch" ? "本批" : "共"} <b>{rows.length}</b> 条
            <span className="pagination-coverage"> · {coverage}</span>
          </span>
          {rows.length > 25 && (
            <div>
              <Pick
                label="每页记录数"
                value={String(table.state.pagination.pageSize)}
                onChange={(v) => {
                  table.setPageSize(Number(v));
                  setSelected([]);
                }}
                options={[25, 50, 100].map((n) => ({
                  value: String(n),
                  label: `${n} 条 / 页`,
                }))}
              />
              <span>
                {rows.length ? page + 1 : 0} / {pages || 0}
              </span>
              <Button
                aria-label="第一页"
                disabled={!table.getCanPreviousPage()}
                onClick={() => {
                  table.firstPage();
                  setSelected([]);
                }}
              >
                <ChevronsLeft size={15} />
              </Button>
              <Button
                aria-label="上一页"
                disabled={!table.getCanPreviousPage()}
                onClick={() => {
                  table.previousPage();
                  setSelected([]);
                }}
              >
                <ChevronLeft size={15} />
              </Button>
              <Button
                aria-label="下一页"
                disabled={!table.getCanNextPage()}
                onClick={() => {
                  table.nextPage();
                  setSelected([]);
                }}
              >
                <ChevronRight size={15} />
              </Button>
              <Button
                aria-label="最后一页"
                disabled={!table.getCanNextPage()}
                onClick={() => {
                  table.lastPage();
                  setSelected([]);
                }}
              >
                <ChevronsRight size={15} />
              </Button>
            </div>
          )}
        </div>
      )}
      <Modal
        open={exportOpen}
        close={() => setExportOpen(false)}
        title={"导出" + label}
        description="仅导出当前范围内、符合筛选条件的可见字段。"
      >
        <dl className="admin-properties">
          <div>
            <dt>记录范围</dt>
            <dd>
              {exportScope === "batch" ? "当前已读取批次" : "全部筛选结果"} ·{" "}
              {rows.length} 条
            </dd>
          </div>
          <div>
            <dt>完整性</dt>
            <dd>{coverage}</dd>
          </div>
          <div>
            <dt>列范围</dt>
            <dd>
              {visible
                .map((c) => columns.find((x) => x.id === c.id)!.label)
                .join("、")}
            </dd>
          </div>
        </dl>
        <div className="dialog-actions">
          <Button onClick={() => setExportOpen(false)}>取消</Button>
          <Button
            variant="primary"
            onClick={() => {
              const visibleDefs = visible.map((c) =>
                columns.find((x) => x.id === c.id)!,
              );
              exportCSV(label, [
                visibleDefs.map((c) => c.label),
                ...table
                  .getPrePaginatedRowModel()
                  .rows.map((r) => visibleDefs.map((c) => c.value(r.original))),
              ]);
              setExportOpen(false);
              setMessage(`已导出 ${rows.length} 条演示记录。`);
            }}
          >
            导出 CSV
          </Button>
        </div>
      </Modal>
    </div>
  );
}
export function SearchInput({
  value,
  onChange,
  label = "搜索记录",
}: {
  value: string;
  onChange: (v: string) => void;
  label?: string;
}) {
  return (
    <label className="admin-search">
      <Search size={15} />
      <input
        aria-label={label}
        placeholder={label}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      {value && (
        <button
          type="button"
          aria-label={"清除" + label}
          onClick={() => onChange("")}
        >
          <X size={13} />
        </button>
      )}
    </label>
  );
}
export function ComboBox({
  value,
  onChange,
  options,
  label,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  label: string;
}) {
  const [open, setOpen] = useState(false),
    [search, setSearch] = useState(""),
    [active, setActive] = useState(0);
  const list = options.filter((o) =>
    o.label.toLowerCase().includes(search.toLowerCase()),
  );
  return (
    <Popover.Root
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        setSearch("");
        setActive(0);
      }}
    >
      <Popover.Trigger asChild>
        <Button
          role="combobox"
          aria-expanded={open}
          aria-label={label}
          className="combobox-trigger"
        >
          {options.find((o) => o.value === value)?.label || "请选择账号"}
          <Search size={14} />
        </Button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content className="admin-popover" align="start" sideOffset={5}>
          <input
            className="combo-search"
            role="combobox"
            aria-label={"搜索" + label}
            aria-expanded="true"
            aria-controls="account-options"
            aria-activedescendant={
              list[active] ? "account-option-" + active : undefined
            }
            placeholder="搜索现有账号…"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setActive(0);
            }}
            onKeyDown={(e) => {
              if (["ArrowDown", "ArrowUp"].includes(e.key)) {
                e.preventDefault();
                setActive((v) =>
                  Math.max(
                    0,
                    Math.min(
                      list.length - 1,
                      v + (e.key === "ArrowDown" ? 1 : -1),
                    ),
                  ),
                );
              }
              if (e.key === "Enter" && list[active]) {
                e.preventDefault();
                onChange(list[active].value);
                setOpen(false);
              }
            }}
          />
          <div role="listbox" id="account-options" aria-label={label}>
            {list.map((o, i) => (
              <button
                id={"account-option-" + i}
                type="button"
                role="option"
                aria-selected={value === o.value}
                className={
                  "admin-menu-item " + (i === active ? "keyboard-active" : "")
                }
                key={o.value}
                onClick={() => {
                  onChange(o.value);
                  setOpen(false);
                }}
              >
                {o.label}
                {o.value === value && <Check size={14} />}
              </button>
            ))}
            {!list.length && <p className="muted">没有匹配的现有账号</p>}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
export function MultiSelect({
  value,
  onChange,
  label,
  options,
}: {
  value: string;
  onChange: (v: string) => void;
  label: string;
  options: { value: string; label: string }[];
}) {
  const values = value === "all" ? [] : value.split(",");
  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <Button aria-label={label}>
          <ListFilter size={14} />
          {values.length ? `${label} · ${values.length}` : label}
        </Button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content className="admin-popover" align="start" sideOffset={5}>
          <h4>{label}</h4>
          {options.map((o) => (
            <label className="multi-option" key={o.value}>
              <CheckBox
                label={o.label}
                checked={values.includes(o.value)}
                onChange={(v) => {
                  const next = v
                    ? [...values, o.value]
                    : values.filter((x) => x !== o.value);
                  onChange(next.length ? next.join(",") : "all");
                }}
              />
              {o.label}
            </label>
          ))}
          <Button variant="ghost small" onClick={() => onChange("all")}>
            清除选择
          </Button>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
export function DateRange({
  query,
  onChange,
}: {
  query: HistoryQuery;
  onChange: (q: HistoryQuery) => void;
}) {
  const invalid =
    query.days === "custom" &&
    (!query.from || !query.to || query.from > query.to);
  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <Button aria-label="选择时间范围">
          <CalendarDays size={15} />
          {query.days === "custom"
            ? `${query.from} — ${query.to}`
            : query.days === "1"
              ? "近 24 小时"
              : `近 ${query.days} 天`}
        </Button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content className="admin-popover" align="end" sideOffset={8}>
          <h4>时间范围</h4>
          <p>Asia/Shanghai · 演示基准 10 月 3 日</p>
          <div className="date-presets">
            {["1", "7", "30"].map((d) => (
              <Button
                key={d}
                variant={query.days === d ? "active" : ""}
                onClick={() => onChange({ ...query, days: d })}
              >
                {d === "1" ? "24 小时" : `${d} 天`}
              </Button>
            ))}
          </div>
          <Field label="开始日期">
            <input
              type="date"
              value={query.from}
              aria-invalid={invalid}
              onChange={(e) =>
                onChange({ ...query, days: "custom", from: e.target.value })
              }
            />
          </Field>
          <Field
            label="结束日期"
            error={invalid ? "结束日期应不早于开始日期。" : undefined}
          >
            <input
              type="date"
              value={query.to}
              aria-invalid={invalid}
              onChange={(e) =>
                onChange({ ...query, days: "custom", to: e.target.value })
              }
            />
          </Field>
          <Popover.Close asChild>
            <Button variant="primary">完成</Button>
          </Popover.Close>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
export function FilterSummary({
  query,
  onChange,
}: {
  query: HistoryQuery;
  onChange: (q: HistoryQuery) => void;
}) {
  const active = Object.entries(query).filter(
    ([k, v]) =>
      ["owner", "state", "actor", "kind", "projectRef"].includes(k) &&
      v !== "all",
  );
  return active.length || query.search ? (
    <div className="filter-summary">
      <ListFilter size={14} />
      <span>{active.length + (query.search ? 1 : 0)} 个筛选条件</span>
      <Button
        variant="ghost small"
        onClick={() =>
          onChange({
            ...defaultQuery,
            days: query.days,
            from: query.from,
            to: query.to,
          })
        }
      >
        清除筛选
        <X size={12} />
      </Button>
    </div>
  ) : null;
}
export function AdminPanel(props: React.ComponentProps<typeof RightWorkspace>) {
  const host = document.querySelector(".content-layout");
  return host ? createPortal(<RightWorkspace {...props} />, host) : null;
}

export function AdvancedFilters({
  children,
  count = 0,
  onClear,
}: {
  children: ReactNode;
  count?: number;
  onClear?: () => void;
}) {
  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <Button variant="outline" aria-label="更多筛选">
          <ListFilter size={16} />
          筛选{count > 0 && <span className="filter-count">{count}</span>}
        </Button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          className="filter-popover"
          align="start"
          collisionPadding={12}
          sideOffset={6}
        >
          <div className="filter-popover-heading">
            <strong>筛选条件</strong>
            {onClear && (
              <Button variant="ghost small" onClick={onClear}>
                清除
              </Button>
            )}
          </div>
          <div className="filter-popover-fields">
            {Children.toArray(children).map((child, index) => {
              const label = isValidElement(child)
                ? (child as ReactElement<{ label?: string }>).props.label
                : undefined;
              return label ? (
                <Field key={label} label={label}>
                  {child}
                </Field>
              ) : (
                <div key={index}>{child}</div>
              );
            })}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
