import { useState, type FormEvent } from "react";
import { useSearchParams } from "react-router-dom";
import { Bookmark, BookmarkPlus, MoreHorizontal, Trash2 } from "../icons";
import { Button, Input, MenuContent, MenuItem, MenuRoot, MenuTrigger, PopoverContent, PopoverRoot, PopoverTrigger, cx, useToast } from "./ui";
import { useSavedViews } from "../app/preferences";
import { activeView, applyView, canonicalViewQuery, presetTaskViews, removeView, saveView } from "../shared/saved-views";

/**
 * Ready-made and saved task views as one row of chips. A view is only address parameters, so opening one is the same
 * as opening a link, and the open task or page never becomes part of it.
 */
export function SavedViews({ className }: { className?: string }) {
  const [params, setParams] = useSearchParams();
  const [views, setViews] = useSavedViews();
  const notify = useToast();
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState("");
  const current = canonicalViewQuery(params);
  const active = activeView([...presetTaskViews, ...views], params);
  const open = (query: string) => setParams(applyView(params, query), { replace: true });
  const save = (event: FormEvent) => {
    event.preventDefault();
    const result = saveView(views, name, current, new Date().toISOString(), `view-${Date.now().toString(36)}`);
    if (!result.ok) {
      notify(result.reason === "full" ? "最多保存 20 个视图，先删掉一个再存" : result.reason === "empty_query" ? "先选几个筛选条件，再存成视图" : "给视图起个名字", "warning");
      return;
    }
    setViews(() => result.views);
    setNaming(false);
    setName("");
    notify(`已保存视图「${result.view.name}」`, "success");
  };
  const chip = "inline-flex h-7 shrink-0 items-center gap-1.5 rounded-full border px-3 text-xs transition-colors duration-150";
  return <div role="group" aria-label="任务视图" data-saved-views className={cx("flex min-w-0 items-center gap-1.5 overflow-x-auto [scrollbar-width:none]", className)}>
    {presetTaskViews.map((view) => <button key={view.id} type="button" title={view.hint} aria-pressed={active?.id === view.id} onClick={() => open(active?.id === view.id ? "" : view.query)} className={cx(chip, active?.id === view.id ? "border-primary bg-primary-soft text-ink" : "border-line text-ink-soft hover:border-line-strong hover:text-ink")}>{view.name}</button>)}
    {views.length > 0 && <span aria-hidden="true" className="mx-1 h-4 w-px shrink-0 bg-line" />}
    {views.map((view) => <span key={view.id} className={cx(chip, "pr-1", active?.id === view.id ? "border-primary bg-primary-soft text-ink" : "border-line text-ink-soft")} data-saved-view={view.name}>
      <button type="button" aria-pressed={active?.id === view.id} onClick={() => open(active?.id === view.id ? "" : view.query)} className="inline-flex items-center gap-1 hover:text-ink"><Bookmark aria-hidden="true" className="size-3" />{view.name}</button>
      <MenuRoot>
        <MenuTrigger asChild><button type="button" aria-label={`视图「${view.name}」的操作`} className="grid size-5 place-items-center rounded-full text-muted hover:bg-panel-sunken hover:text-ink"><MoreHorizontal className="size-3.5" /></button></MenuTrigger>
        <MenuContent align="start">
          <MenuItem icon={<Trash2 />} tone="danger" onSelect={() => setViews((list) => removeView(list, view.id))}>删除视图</MenuItem>
        </MenuContent>
      </MenuRoot>
    </span>)}
    <PopoverRoot open={naming} onOpenChange={setNaming}>
      <PopoverTrigger asChild>
        <Button size="sm" variant="ghost" className="shrink-0" icon={<BookmarkPlus className="size-3.5" />} disabled={!current} disabledReason="先选几个筛选条件，再存成视图">存为视图</Button>
      </PopoverTrigger>
      <PopoverContent label="保存当前视图" align="end" className="w-72 p-3">
        <form onSubmit={save} className="space-y-2.5">
          <label className="block text-xs text-muted">视图名称<Input autoFocus value={name} maxLength={40} onChange={(event) => setName(event.target.value)} placeholder="例如：失败的图" className="mt-1" /></label>
          <p className="text-2xs text-muted">只保存筛选、搜索和排序；最多 20 个。</p>
          <div className="flex justify-end gap-2"><Button size="sm" variant="ghost" onClick={() => setNaming(false)}>取消</Button><Button size="sm" variant="primary" type="submit">保存</Button></div>
        </form>
      </PopoverContent>
    </PopoverRoot>
  </div>;
}
