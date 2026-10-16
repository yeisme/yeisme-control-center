import type { ReactNode } from "react";
import { animated, useReducedMotion, useSpring } from "@react-spring/web";
import {
  ChartNoAxesCombined,
  FolderKanban,
  ListTodo,
  Images,
  ServerCog,
  UsersRound,
  Settings2,
  Wallet,
  ShieldCheck,
  ClipboardCheck,
  Sparkles,
  PanelLeftOpen,
  Menu,
  X,
  ChevronRight,
  Search,
  Info,
  FileText,
  Workflow,
} from "./icons";
import { NavigationSidebar } from "./navigation-sidebar";
import { AdminTabs } from "./admin-ui";
import { Button, DropdownMenu } from "./ui";
export const navigation = [
  { id: "overview", label: "总览", group: "创作空间", icon: ChartNoAxesCombined },
  { id: "projects", label: "项目", group: "创作空间", icon: FolderKanban },
  { id: "requests", label: "正在请求", group: "生产协作", icon: ListTodo },
  { id: "history", label: "历史任务", group: "生产协作", icon: FileText },
  { id: "assets", label: "资产", group: "创作空间", icon: Images },
  { id: "services", label: "服务", group: "资源运营", icon: ServerCog },
  { id: "capabilities", label: "模型与工具", group: "资源运营", icon: ServerCog },
  { id: "creation", label: "AI 创作", group: "创作空间", icon: Sparkles },
  { id: "provider_usage", label: "用量与费用", group: "总览", icon: Wallet },
  { id: "members", label: "团队", group: "团队与设置", icon: UsersRound },
  { id: "settings", label: "设置", group: "团队与设置", icon: Settings2 },
  { id: "usage", label: "统计与成本", group: "资源运营", icon: Wallet },
  { id: "audit", label: "诊断与审计", group: "团队与设置", icon: ShieldCheck },
  { id: "approvals", label: "待处理", group: "生产协作", icon: ClipboardCheck },
];
export function navigationRoot(page: string, demo = false) {
  return (
    (
      (demo
        ? { tasks: "requests", usage: "overview", provider_usage: "overview", capabilities: "overview", creation: "overview", audit: "settings", approvals: "requests" }
        : { tasks: "requests", usage: "overview", capabilities: "capabilities", creation: "creation", audit: "settings", approvals: "requests" }) as Record<
        string,
        string
      >
    )[page] || page
  );
}
export const requestDetailTabs = [
  { id: "概况", label: "概况", icon: <Info size={14} /> },
  { id: "内容", label: "内容", icon: <FileText size={14} /> },
  { id: "执行", label: "执行", icon: <Workflow size={14} /> },
];
const sidebarSpring = {
  mass: 0.8,
  tension: 360,
  friction: 34,
  clamp: true,
};
/** Shared presentation; each mode owns its session, scope and actions. */
export function AppShell({
  page,
  collapsed,
  mobile,
  onCollapse,
  onMobile,
  onNavigate,
  scope,
  actions,
  children,
  footer,
  onSearch,
  identity = "demo",
  demo = false,
}: {
  page: string;
  collapsed: boolean;
  mobile: boolean;
  onCollapse: () => void;
  onMobile: (value: boolean) => void;
  onNavigate: (page: string) => void;
  scope: ReactNode;
  actions: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  onSearch?: () => void;
  identity?: string;
  demo?: boolean;
}) {
  const current = navigation.find((n) => n.id === page) || navigation[0];
  const root = navigation.find((n) => n.id === navigationRoot(page, demo))!;
  const visibleNavigation = demo
    ? navigation
    : navigation.filter((item) => item.id !== "usage");
  const reducedMotion = useReducedMotion();
  const sidebarMotion = useSpring({
    width: collapsed ? 64 : 232,
    config: sidebarSpring,
    immediate: !!reducedMotion,
  });
  return (
    <div
      className={`app-shell v18-app ${collapsed ? "collapsed v18-collapsed " : ""}${mobile ? "mobile-nav-open" : ""}`}
    >
      <animated.aside
        className="sidebar v18-sidebar"
        data-slot="sidebar"
        style={{ width: sidebarMotion.width }}
      >
        <a
          className="brand v18-brand"
          href="#/overview"
          onClick={(e) => {
            e.preventDefault();
            onNavigate("overview");
          }}
        >
          <span className="brand-monogram v18-brand-mark" aria-hidden="true">
            Y
          </span>
          <span>
            <strong>Yeisme</strong>
            <small>控制中心</small>
          </span>
        </a>
        <button
          className="mobile-close icon-button"
          aria-label="关闭导航"
          onClick={() => onMobile(false)}
        >
          <X size={18} />
        </button>
        <div className="v18-workspace-switcher" aria-label="Rain Studio 团队工作空间">
          <span className="v18-workspace-avatar">R</span>
          <span>
            <strong>Rain Studio</strong>
            <small>团队工作空间</small>
          </span>
          <ChevronRight size={15} />
        </div>
        <div className="v18-scope-slot">{scope}</div>
        <NavigationSidebar
          items={[...visibleNavigation.slice(0, 9), ...visibleNavigation.filter((item) => item.id === "members")]}
          page={navigationRoot(page, demo)}
          onNavigate={onNavigate}
          identity={identity}
        />
        <div className="sidebar-bottom v18-sidebar-bottom">
          <button
            className={`nav-item v18-nav-item ${root.id === "settings" ? "active" : ""}`}
            aria-label="设置"
            aria-current={root.id === "settings" ? "page" : undefined}
            onClick={() => onNavigate("settings")}
          >
            <Settings2 size={18} />
            <span>设置</span>
          </button>
          {footer}
        </div>
      </animated.aside>
      {mobile && (
        <button
          className="nav-backdrop"
          aria-label="收起导航"
          onClick={() => onMobile(false)}
        />
      )}
      <div className="workspace v18-main">
        <header className="admincn-header v18-topbar">
          <div className="header-left v18-topbar-left">
            <button
              className="icon-button v18-icon-button desktop-menu"
              aria-label={collapsed ? "展开导航" : "收起导航"}
              onClick={onCollapse}
            >
              <PanelLeftOpen size={20} />
            </button>
            <button
              className="icon-button v18-icon-button mobile-menu"
              aria-label="打开导航"
              onClick={() => onMobile(true)}
            >
              <Menu size={20} />
            </button>
            <span className="header-divider" />
            <nav className="breadcrumb v18-breadcrumb" aria-label="当前位置">
              {root.id !== page && (
                <>
                  <button onClick={() => onNavigate(root.id)}>
                    {root.label}
                  </button>
                  <ChevronRight size={14} />
                </>
              )}
              <span aria-current="page">{current.label}</span>
            </nav>
            {demo && (
              <span className="header-demo" aria-label="设计演示">
                演示
              </span>
            )}
          </div>
          <div className="header-actions v18-topbar-actions">
            <button
                className="header-search v18-search"
                aria-label="搜索控制中心"
                title="搜索 · ⌘ K"
                onClick={() => onSearch?.()}
              >
                <Search size={18} />
                <span>搜索项目、资产、模型或任务</span>
                <kbd>⌘ K</kbd>
              </button>
            {actions}
          </div>
        </header>
        {children}
      </div>
    </div>
  );
}
export function SectionNavigation({
  page,
  onNavigate,
}: {
  page: string;
  onNavigate: (page: string) => void;
}) {
  const items = ["overview", "usage"].includes(page)
    ? [
        { id: "overview", label: "运行摘要" },
        { id: "usage", label: "统计与成本" },
      ]
    : ["settings", "audit"].includes(page)
      ? [
          { id: "settings", label: "偏好设置" },
          { id: "audit", label: "诊断与审计" },
        ]
      : [];
  return items.length ? (
    <AdminTabs value={page} onChange={onNavigate} items={items} />
  ) : null;
}

export function OrganizationNavigation({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const primary = [
    { id: "members", label: "成员" },
    { id: "teams", label: "团队" },
    { id: "invitations", label: "邀请" },
  ];
  const advanced = [
    { value: "tenants", label: "租户目录" },
    { value: "accounts", label: "服务账号" },
    { value: "access", label: "访问授权" },
    { value: "quotas", label: "配额用量" },
  ];
  const isAdvanced = advanced.some((item) => item.value === value);
  return (
    <div className="page-tabs-row">
      {isAdvanced ? (
        <div className="section-return">
          <Button variant="ghost" onClick={() => onChange("members")}>
            返回成员
          </Button>
          <span>组织设置</span>
        </div>
      ) : (
        <AdminTabs value={value} onChange={onChange} items={primary} />
      )}
      <DropdownMenu.Root>
        <DropdownMenu.Trigger asChild>
          <Button variant="ghost" aria-label="组织设置">
            <Settings2 size={16} />
            <span>
              {advanced.find((item) => item.value === value)?.label ||
                "组织设置"}
            </span>
          </Button>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content className="admin-menu" align="end">
            {advanced.map((item) => (
              <DropdownMenu.Item
                className="admin-menu-item"
                key={item.value}
                onSelect={() => onChange(item.value)}
              >
                {item.label}
              </DropdownMenu.Item>
            ))}
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
    </div>
  );
}
