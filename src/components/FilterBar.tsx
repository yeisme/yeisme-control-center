import { useEffect, useRef, useState, type ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import { liveQuery } from "../app/overlay-history";
import { Button, Checkbox, DetailSheet, Input, PopoverContent, PopoverRoot, PopoverTrigger, SearchField } from "./ui";
import { ChevronDown, SlidersHorizontal, X } from "../icons";
import { QueryInput, type QuerySupport } from "./QueryInput";

/** `count` is how many rows the option would leave, given the other filters; it renders apart from the label. */
export interface FilterFacet { key: string; label: string; options: { value: string; label: string; count?: number }[]; disabled?: boolean }
/**
 * The address after a filter change, or `null` when the patch changes nothing. A new filter starts the list over: the
 * server cursor and the page number both belong to the old one. A patch that changes nothing (a debounced search that
 * lands after the address already says the same) keeps the page the person moved to since.
 */
export function applyDirectoryFilters(current: URLSearchParams, patch: Record<string, string | null>, prefix = "") {
  if (Object.entries(patch).every(([key, value]) => (current.get(prefix + key) || "") === (value || ""))) return null;
  const next = new URLSearchParams(current);
  for (const [key, value] of Object.entries(patch)) { if (value) next.set(prefix + key, value); else next.delete(prefix + key); }
  next.delete(prefix + "cursor"); next.delete(prefix + "page"); return next;
}
export function useDirectoryFilters(prefix = "") {
  const [params, setParams] = useSearchParams();
  const set = (patch: Record<string, string | null>) => {
    if (!applyDirectoryFilters(liveQuery(params), patch, prefix)) return;
    setParams((current) => { const live = liveQuery(current); return applyDirectoryFilters(live, patch, prefix) || live; }, { replace: true });
  };
  return { get: (key: string) => params.get(prefix + key) || "", set };
}
export function matchesFacet(value: string, selected: string) { return !selected || selected.split(",").includes(value); }

export function FilterBar({ facets = [], dates = false, prefix = "", placeholder = "搜索当前列表", onChange, query, drawerTop }: { facets?: FilterFacet[]; dates?: boolean; prefix?: string; placeholder?: string; onChange?: (query: Record<string, string>) => void; query?: QuerySupport; /** What a phone shows first in the conditions drawer, such as saved views the page hides from its header there. */ drawerTop?: ReactNode }) {
  const filters = useDirectoryFilters(prefix);
  const [searchParams] = useSearchParams();
  const q = filters.get("q");
  const [text, setText] = useState(q);
  const committed = useRef(q);
  const onChangeRef = useRef(onChange); onChangeRef.current = onChange;
  useEffect(() => { committed.current = q; setText(q); }, [q]);
  // The timer checks again when it fires: the address may have caught up in the meantime (重置, a chip, a reload), and a
  // search that already holds must not drop the page the person moved to since.
  useEffect(() => { if (text === committed.current) return; const timer = setTimeout(() => { if (text.trim() !== committed.current.trim()) filters.set({ q: text.trim() }); }, 300); return () => clearTimeout(timer); }, [text]);
  const extraKeys = Object.keys(query?.chips || {});
  const signature = JSON.stringify(Object.fromEntries(["q", "from", "to", ...facets.map((f) => f.key), ...extraKeys].map((key) => [key, filters.get(key)])));
  useEffect(() => { onChangeRef.current?.(JSON.parse(signature)); }, [signature]);
  const active = ["q", "from", "to", ...facets.map((f) => f.key), ...extraKeys].filter((key) => filters.get(key));
  // `键:值` typed into the box becomes the same parameters the pickers write; the rest stays as the search.
  const commit = (value: string) => {
    if (!query) return;
    const { params, rest } = query.extract(value, searchParams);
    const remaining = rest.trim();
    committed.current = remaining;
    setText(remaining && value.endsWith(" ") ? `${remaining} ` : remaining);
    filters.set({ ...Object.fromEntries(Object.entries(params).map(([key, item]) => [key.replace(new RegExp(`^${prefix}`), ""), item])), q: remaining || null });
  };
  const removeLast = () => {
    const last = [...active].reverse().find((key) => key !== "q");
    if (last) filters.set({ [last]: null });
  };
  const conditionKeys = [...facets.map((f) => f.key), ...(dates ? ["from", "to"] : [])];
  const conditions = conditionKeys.filter((key) => filters.get(key)).length;
  const [drawer, setDrawer] = useState(false);
  return <div className="space-y-2" data-testid="filter-bar">
    <div className="flex flex-wrap items-center gap-2">
      {query
        ? <QueryInput value={text} onChange={setText} onCommit={commit} onBackspaceEmpty={removeLast} label={placeholder} placeholder={placeholder} support={query} className="min-w-40 flex-1" />
        : <SearchField value={text} onChange={setText} label={placeholder} placeholder={placeholder} className="min-w-40 flex-1" />}
      {/* Phones keep the search field and move the conditions into a drawer; the URL parameters are the same. */}
      {conditionKeys.length > 0 && <Button variant="secondary" size="sm" className="sm:hidden" icon={<SlidersHorizontal className="size-3.5" />} aria-label={conditions ? `筛选，已选 ${conditions} 项` : "筛选"} onClick={() => setDrawer(true)}>筛选{conditions > 0 && ` · ${conditions}`}</Button>}
      <div className="contents max-sm:hidden">
      {facets.map((facet) => <FacetPicker key={facet.key} facet={facet} value={filters.get(facet.key)} onChange={(v) => filters.set({ [facet.key]: v })} />)}
      {dates && <PopoverRoot><PopoverTrigger asChild><Button variant="secondary" size="sm">日期<ChevronDown className="size-3" /></Button></PopoverTrigger><PopoverContent label="日期" align="start"><div className="grid gap-3 p-2"><label className="text-xs">开始日期<Input type="date" value={filters.get("from")} onChange={(e) => filters.set({ from: e.target.value })} /></label><label className="text-xs">结束日期<Input type="date" min={filters.get("from")} value={filters.get("to")} onChange={(e) => filters.set({ to: e.target.value })} /></label></div></PopoverContent></PopoverRoot>}
      {active.length > 0 && <Button variant="ghost" size="sm" onClick={() => { committed.current = ""; setText(""); filters.set(Object.fromEntries(active.map((key) => [key, null]))); }}>重置</Button>}
      </div>
    </div>
    <DetailSheet open={drawer} onOpenChange={setDrawer} title="筛选" footer={<div className="flex items-center justify-between gap-2">
      <Button variant="ghost" disabled={!conditions} onClick={() => filters.set(Object.fromEntries(conditionKeys.map((key) => [key, null])))}>清除条件</Button>
      <Button variant="primary" onClick={() => setDrawer(false)}>完成</Button>
    </div>}>
      <div className="space-y-5">
        {drawerTop}
        {facets.map((facet) => <fieldset key={facet.key} disabled={facet.disabled} className="min-w-0">
          <legend className="mb-1.5 text-[13px] font-medium text-ink-soft">{facet.label}</legend>
          <FacetOptions facet={facet} value={filters.get(facet.key)} onChange={(v) => filters.set({ [facet.key]: v })} />
        </fieldset>)}
        {dates && <fieldset className="min-w-0">
          <legend className="mb-1.5 text-[13px] font-medium text-ink-soft">日期</legend>
          <div className="grid grid-cols-2 gap-3">
            <label className="text-xs">开始日期<Input type="date" value={filters.get("from")} onChange={(e) => filters.set({ from: e.target.value })} /></label>
            <label className="text-xs">结束日期<Input type="date" min={filters.get("from")} value={filters.get("to")} onChange={(e) => filters.set({ to: e.target.value })} /></label>
          </div>
        </fieldset>}
      </div>
    </DetailSheet>
    {active.length > 0 && <div className="flex flex-wrap gap-1.5" aria-label="已选筛选条件">{active.map((key) => {
      const facet = facets.find((f) => f.key === key); const raw = filters.get(key); const extra = query?.chips?.[key];
      const words = extra?.format ? extra.format(raw) : raw.split(",").map((v) => facet?.options.find((o) => o.value === v)?.label || v).join("、");
      return <button type="button" key={key} data-filter-chip={key} aria-label={`移除筛选：${facet?.label || extra?.label || ({ q: "搜索", from: "开始", to: "结束" } as Record<string, string>)[key]}：${words}`} className="inline-flex max-w-full items-center gap-1 rounded-control border border-line bg-panel-soft px-2 py-1 text-xs" onClick={() => filters.set({ [key]: null })}>
        <span className="truncate">{facet?.label || extra?.label || ({ q: "搜索", from: "开始", to: "结束" } as Record<string, string>)[key]}：{words}</span><X className="size-3 shrink-0" />
      </button>;
    })}</div>}
  </div>;
}
function FacetPicker({ facet, value, onChange }: { facet: FilterFacet; value: string; onChange: (v: string) => void }) {
  const selected = value ? value.split(",") : [];
  return <PopoverRoot><PopoverTrigger asChild><Button variant="secondary" size="sm" disabled={facet.disabled}>{facet.label}{selected.length > 0 && ` · ${selected.length}`}<ChevronDown className="size-3" /></Button></PopoverTrigger><PopoverContent label={facet.label} align="start" className="w-60 p-2">
    <FacetOptions facet={facet} value={value} onChange={onChange} search />
  </PopoverContent></PopoverRoot>;
}

/** The options of one facet as checkboxes; the popover always offers a search, the phone drawer only for long lists. */
function FacetOptions({ facet, value, onChange, search: searchable = false }: { facet: FilterFacet; value: string; onChange: (v: string) => void; search?: boolean }) {
  const [search, setSearch] = useState(""); const selected = value ? value.split(",") : [];
  return <>
    {(searchable || facet.options.length > 8) && <Input aria-label={`搜索${facet.label}`} placeholder={`搜索${facet.label}`} value={search} onChange={(e) => setSearch(e.target.value)} className="mb-2" />}
    <div className="max-h-64 space-y-1 overflow-y-auto">{facet.options.filter((o) => o.label.toLocaleLowerCase().includes(search.toLocaleLowerCase())).map((o) => <label key={o.value} className="flex cursor-pointer items-center gap-2 rounded-control px-2 py-1.5 text-sm hover:bg-panel-soft"><Checkbox checked={selected.includes(o.value)} label={o.label} onChange={() => onChange((selected.includes(o.value) ? selected.filter((v) => v !== o.value) : [...selected, o.value]).join(","))} /><span className="min-w-0 flex-1 truncate">{o.label}</span>{o.count !== undefined && <span className="tabular shrink-0 text-2xs text-muted" aria-label={`${o.count} 条`}>{o.count}</span>}</label>)}{facet.options.length === 0 && <p className="p-2 text-xs text-muted">当前授权范围没有候选</p>}</div>
  </>;
}
