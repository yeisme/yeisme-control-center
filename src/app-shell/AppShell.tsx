import { useEffect, useRef, type ReactNode } from "react";
import { Bell, ChevronDown, LayoutDashboard, FolderKanban, Images, ListTodo, ClipboardCheck, Cpu, Wallet, UsersRound, Sparkles, Menu, Moon, PanelLeftClose, PanelLeftOpen, Sun, Search, X } from "../icons";
import type { WorkspacePage } from "../shared/types";
import type { WorkspaceSession } from "../shared/api/control-center-client";
import { workspaceRouteManifest } from "./navigation";

const icons = { home: LayoutDashboard, projects: FolderKanban, creation: Sparkles, assets: Images, tasks: ListTodo, review: ClipboardCheck, capabilities: Cpu, usage: Wallet };

export type ShellSearchResult = {
  id: string;
  label: string;
  meta: string;
  page: WorkspacePage;
};

export function AppShell({ children, session, liveMode, page, collapsed, mobileNav, dark, search, searchResults, scopeId, pendingReviews, onSearch, onSearchSelect, onScopeChange, onNavigate, onToggleCollapsed, onToggleMobile, onToggleDark, onNotice }: {
  children: ReactNode;
  session: WorkspaceSession;
  liveMode: boolean;
  page: WorkspacePage;
  collapsed: boolean;
  mobileNav: boolean;
  dark: boolean;
  search: string;
  searchResults: ShellSearchResult[];
  scopeId: string;
  pendingReviews: number;
  onSearch: (value: string) => void;
  onSearchSelect: (result: ShellSearchResult) => void;
  onScopeChange: (value: string) => void;
  onNavigate: (page: WorkspacePage) => void;
  onToggleCollapsed: () => void;
  onToggleMobile: (value: boolean) => void;
  onToggleDark: () => void;
  onNotice: (message: string) => void;
}) {
  const searchRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        searchRef.current?.focus();
      }
      if (event.key === "Escape") {
        if (mobileNav) onToggleMobile(false);
        if (document.activeElement === searchRef.current) {
          onSearch("");
          searchRef.current?.blur();
        }
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [mobileNav, onSearch, onToggleMobile]);
  const navItems = workspaceRouteManifest.filter((item) => item.id !== "team").map((item) => ({ ...item, icon: icons[item.id as keyof typeof icons] || ListTodo }));
  return <div className={`v18-app ${collapsed ? "v18-collapsed" : ""}`}>
    <aside className={`v18-sidebar ${mobileNav ? "v18-mobile-open" : ""}`}>
      <div className="v18-brand"><span className="v18-brand-mark" aria-hidden="true"><span>Y</span><Sparkles size={11} /></span><span><strong>Yeisme</strong><small>Control Center</small></span></div>
      <label className="v18-workspace-switcher" aria-label="切换工作区"><span className="v18-workspace-avatar">{(session.scopes.find((scope) => scope.id === scopeId)?.label || "当前").slice(0, 1)}</span><span><strong>{session.scopes.find((scope) => scope.id === scopeId)?.label || "当前工作区"}</strong><small>{liveMode ? "真实只读范围" : "工作空间"}</small></span><ChevronDown size={15} /><select value={scopeId} onChange={(event) => onScopeChange(event.target.value)} aria-label="工作区范围">{session.scopes.map((scope) => <option value={scope.id} key={scope.id}>{scope.label}</option>)}</select></label>
      <nav aria-label="Workspace 导航">{([...new Set(navItems.map((item) => item.group))] as string[]).map((group) => <div className="v18-nav-group" key={group}><p className="v18-nav-label">{group}</p>{navItems.filter((item) => item.group === group).map((item) => { const Icon = item.icon; return <button key={item.id} data-nav={item.id} className={`v18-nav-item ${page === item.id ? "active" : ""}`} onClick={() => onNavigate(item.id)}><Icon size={18} /><span>{item.label}</span>{item.id === "review" && pendingReviews > 0 && <b>{pendingReviews}</b>}</button>; })}</div>)}</nav>
      <div className="v18-sidebar-bottom"><p className="v18-nav-label">团队</p><button data-nav="team" className={`v18-nav-item ${page === "team" ? "active" : ""}`} onClick={() => onNavigate("team")}><UsersRound size={18} /><span>团队与设置</span></button><button className="v18-nav-item" onClick={onToggleDark}><span className="v18-theme-icon">{dark ? <Sun size={17} /> : <Moon size={17} />}</span><span>{dark ? "浅色主题" : "深色主题"}</span></button></div>
    </aside>
    {mobileNav && <button className="v18-nav-scrim" aria-label="关闭导航" onClick={() => onToggleMobile(false)} />}
    <main className="v18-main"><header className="v18-topbar"><div className="v18-topbar-left"><button className="v18-icon-button v18-mobile-only" aria-label="打开导航" onClick={() => onToggleMobile(true)}><Menu size={19} /></button><button className="v18-icon-button v18-desktop-only" aria-label={collapsed ? "展开侧栏" : "收起侧栏"} onClick={onToggleCollapsed}>{collapsed ? <PanelLeftOpen size={19} /> : <PanelLeftClose size={19} />}</button><div className="v18-breadcrumb"><span>{session.scopes.find((scope) => scope.id === scopeId)?.label || "当前工作区"}</span><span>/</span><strong>{navItems.find((item) => item.id === page)?.label || "团队与设置"}</strong></div><span className="v18-demo-badge"><span />真实只读</span></div><div className="v18-topbar-actions"><div className={`v18-search-wrap ${search ? "has-value" : ""}`}><label className="v18-search"><Search size={15} aria-hidden="true" /><input ref={searchRef} aria-label="搜索项目、资产、模型或任务" placeholder="搜索项目、资产、模型或任务" value={search} onChange={(event) => onSearch(event.target.value)} /><kbd>⌘ K</kbd>{search && <button type="button" className="v18-search-clear" aria-label="清除搜索" onClick={() => onSearch("")}><X size={13} /></button>}</label>{search && <div className="v18-search-results" role="listbox">{searchResults.length ? searchResults.map((result) => <button key={`${result.page}:${result.id}`} role="option" onClick={() => onSearchSelect(result)}><span><strong>{result.label}</strong><small>{result.meta}</small></span><ChevronDown size={14} /></button>) : <div className="v18-search-empty"><Search size={15} />没有匹配结果</div>}</div>}</div><button className="v18-icon-button" aria-label="通知" onClick={() => onNotice("通知读取合同尚未接入")} title="通知读取合同尚未接入"><Bell size={18} /></button><button className="v18-avatar-button" aria-label="当前用户" onClick={() => onNotice(`${session.name} · 当前为真实只读身份`)} title="查看当前身份">{session.name.slice(0, 1)}</button></div></header><div className="v18-content">{children}</div></main>
  </div>;
}
