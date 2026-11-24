import { useEffect, useState, type ReactNode } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Bell, Database, KeyRound, Keyboard, LayoutList, Palette, RotateCcw, UserRound, UsersRound } from "../../icons";
import { useTheme, type ThemePreference } from "../../app-shell/theme";
import { useDevicePreferences } from "../../app/device-preferences";
import { useAccountPreferences, useAssetsPreferences, useListPreferences } from "../../app/preferences";
import { useWorkspace } from "../../app/workspace";
import { clearRecentItems } from "../../app/recent";
import { clearMediaSessionCaches } from "../../app/media-cache";
import { Button, PageToolbar, Panel, Select, ToggleGroup, cx, useToast } from "../../components/ui";
import { DesktopSwitch } from "../reminders/DeliveryLine";
import { KeymapEditor } from "./KeymapEditor";
import { pageSizes, type PageSize } from "../../shared/pager";
import { inspectorSurfaces, type InspectorMode, type ListDensity, type MotionPreference, type AssetsView } from "../../shared/preferences";
import { scrollBehavior } from "../../shared/motion/reduced";
import { assetViewLabel } from "../assets/asset-view";

const sections = [
  { id: "appearance", label: "外观", icon: Palette },
  { id: "lists", label: "列表与详情", icon: LayoutList },
  { id: "notifications", label: "通知", icon: Bell },
  { id: "keys", label: "快捷键", icon: Keyboard },
  { id: "account", label: "账号", icon: UserRound },
  { id: "data", label: "本机数据", icon: Database },
] as const;
type SectionId = (typeof sections)[number]["id"];

/** One setting: what it is and what it changes on the left, the control on the right (below it on a phone). */
function SettingRow({ label, hint, children, id }: { label: string; hint?: ReactNode; children: ReactNode; id?: string }) {
  return <div className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between" data-setting={id}>
    <div className="min-w-0 sm:max-w-[52%]">
      <p className="text-body-sm font-medium text-ink">{label}</p>
      {hint && <p className="mt-0.5 text-2xs text-muted text-pretty">{hint}</p>}
    </div>
    <div className="min-w-0 sm:shrink-0">{children}</div>
  </div>;
}

function Section({ id, title, children, description }: { id: SectionId; title: string; description?: string; children: ReactNode }) {
  return <section id={`settings-${id}`} aria-labelledby={`settings-${id}-title`} className="scroll-mt-24" data-settings-section={id}>
    <Panel title={<span id={`settings-${id}-title`}>{title}</span>} bodyClassName="p-0">
      {description && <p className="border-b border-line px-5 py-3 text-2xs text-muted">{description}</p>}
      <div className="divide-y divide-line">{children}</div>
    </Panel>
  </section>;
}

/**
 * Settings that take effect at once, with no save button. Theme and motion follow this device; lists, panels, shortcuts
 * and saved views follow the signed-in account on this browser.
 */
export default function SettingsPage() {
  const [params, setParams] = useSearchParams();
  const requested = sections.find((section) => section.id === params.get("section"))?.id;
  const [current, setCurrent] = useState<SectionId>(requested || "appearance");
  useEffect(() => {
    if (!requested) return;
    setCurrent(requested);
    document.getElementById(`settings-${requested}`)?.scrollIntoView({ block: "start", behavior: scrollBehavior() });
  }, [requested]);
  const go = (id: SectionId) => setParams((existing) => { const next = new URLSearchParams(existing); next.set("section", id); return next; }, { replace: true });
  return <div className="page-enter space-y-5" data-page="settings">
    <h1 className="sr-only">设置</h1>
    <PageToolbar lead="按你的习惯来。" summary="改了马上生效，不用保存。主题和动效跟着这台设备；列表、面板和快捷键跟着你的账号。" />
    <div className="grid gap-6 lg:grid-cols-[200px_minmax(0,1fr)]">
      <nav aria-label="设置分区" className="min-w-0 self-start lg:sticky lg:top-24">
        <ul className="flex gap-1 overflow-x-auto lg:flex-col">
          {sections.map((section) => {
            const Icon = section.icon;
            return <li key={section.id} className="shrink-0">
              <a
                href={`#/settings?section=${section.id}`}
                aria-current={current === section.id ? "true" : undefined}
                onClick={(event) => { event.preventDefault(); go(section.id); }}
                className={cx("flex h-9 items-center gap-2 rounded-control px-3 text-[13px] font-medium transition-[background-color,color] duration-150", current === section.id ? "bg-panel text-ink shadow-[0_1px_2px_rgb(0_0_0/8%)]" : "text-muted hover:bg-panel-soft hover:text-ink")}
              ><Icon className="size-4" aria-hidden="true" />{section.label}</a>
            </li>;
          })}
        </ul>
      </nav>
      <div className="min-w-0 space-y-5">
        <AppearanceSection />
        <ListsSection />
        <Section id="notifications" title="通知" description="提醒中心的未读数和铃铛总在；这里只管系统通知。">
          <div className="px-5 py-4 text-body-sm"><DesktopSwitch /></div>
        </Section>
        <Section id="keys" title="快捷键" description="改了马上生效，跟着你的账号。按 ? 随时看全部快捷键。">
          <div className="px-5 py-4"><KeymapEditor /></div>
        </Section>
        <AccountSection />
        <DataSection />
      </div>
    </div>
  </div>;
}

function AppearanceSection() {
  const { preference, setPreference } = useTheme();
  const { motion, setMotion } = useDevicePreferences();
  const { density, setDensity } = useListPreferences();
  return <Section id="appearance" title="外观">
    <SettingRow id="theme" label="主题" hint="跟随系统时，系统切换深浅色，这里也跟着切换。">
      <ToggleGroup<ThemePreference> label="主题" value={preference} onChange={setPreference} options={[{ id: "light", label: "浅色" }, { id: "dark", label: "深色" }, { id: "system", label: "跟随系统" }]} />
    </SettingRow>
    <SettingRow id="motion" label="动效" hint="减少：面板和弹窗只淡入淡出，不再移动或缩放。完整：这台设备上不管系统设置，都播放完整动效。">
      <ToggleGroup<MotionPreference> label="动效" value={motion} onChange={setMotion} options={[{ id: "system", label: "跟随系统" }, { id: "reduced", label: "减少" }, { id: "full", label: "完整" }]} />
    </SettingRow>
    <SettingRow id="density" label="列表密度" hint="每一行的高度；所有列表一起变。">
      <ToggleGroup<ListDensity> label="列表密度" value={density} onChange={setDensity} options={[{ id: "compact", label: "紧凑" }, { id: "comfortable", label: "标准" }, { id: "spacious", label: "宽松" }]} />
    </SettingRow>
  </Section>;
}

function ListsSection() {
  const { pageSize, setPageSize } = useListPreferences();
  const assets = useAssetsPreferences();
  const { prefs, update } = useAccountPreferences();
  const modes = inspectorSurfaces.map((surface) => prefs.inspector.modes[surface]);
  const mode: InspectorMode | "mixed" = modes.every((value) => value === modes[0]) ? modes[0]! : "mixed";
  const setMode = (next: InspectorMode | "mixed") => {
    if (next === "mixed") return;
    update((current) => ({ ...current, inspector: { ...current.inspector, modes: Object.fromEntries(inspectorSurfaces.map((surface) => [surface, next])) as typeof current.inspector.modes } }));
  };
  return <Section id="lists" title="列表与详情">
    <SettingRow id="page-size" label="每页条数" hint="任务、请求、提醒和其他表格每页显示多少条。作品的大图网格在作品页单独设。">
      <Select aria-label="每页条数" value={String(pageSize)} onChange={(event) => setPageSize(Number(event.target.value) as PageSize)}>
        {pageSizes.map((size) => <option key={size} value={size}>{size} 条</option>)}
      </Select>
    </SettingRow>
    <SettingRow id="assets-view" label="作品默认视图" hint="打开作品页时先看到的样子。">
      <ToggleGroup<AssetsView> label="作品默认视图" value={assets.view} onChange={(view) => assets.set({ view })} options={(["gallery", "list", "compact"] as const).map((id) => ({ id, label: assetViewLabel(id) }))} />
    </SettingRow>
    <SettingRow id="inspector-mode" label="详情面板" hint={mode === "mixed" ? "各页现在不一样；选一个就统一成它。" : "固定：停在页面右侧，页面让出位置。悬浮：浮在页面上，不挤内容。"}>
      <ToggleGroup<InspectorMode | "mixed"> label="详情面板" value={mode} onChange={setMode} options={[{ id: "fixed", label: "固定在右侧" }, { id: "floating", label: "悬浮" }]} />
    </SettingRow>
    <SettingRow id="inspector-width" label="详情面板宽度" hint={prefs.inspector.width ? `现在是 ${prefs.inspector.width}px，拖动面板左边缘可以再调。` : "默认宽度随窗口变化；拖动面板左边缘可以调宽或调窄。"}>
      <Button size="sm" variant="ghost" icon={<RotateCcw className="size-3.5" />} disabled={!prefs.inspector.width} disabledReason="已经是默认宽度" onClick={() => update((current) => ({ ...current, inspector: { ...current.inspector, width: null } }))}>恢复默认宽度</Button>
    </SettingRow>
  </Section>;
}

function AccountSection() {
  const { session, isAdmin } = useWorkspace();
  const navigate = useNavigate();
  if (!session) return null;
  const ownKey = session.username && (session.own_key ?? "available") === "available";
  return <Section id="account" title="账号">
    <SettingRow id="who" label={session.name} hint={`${session.username ? `@${session.username}` : "组织身份"} · ${isAdmin ? "管理员" : "只读成员"}`}>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="ghost" icon={<UserRound className="size-3.5" />} onClick={() => navigate("/team")}>我的账号</Button>
        {ownKey && <Button size="sm" variant="ghost" icon={<KeyRound className="size-3.5" />} onClick={() => navigate("/team?rotate=1")}>重置我的访问 Key</Button>}
        <Button size="sm" variant="ghost" icon={<UsersRound className="size-3.5" />} onClick={() => navigate(isAdmin ? "/admin?tab=accounts" : "/admin")}>成员与管理</Button>
      </div>
    </SettingRow>
  </Section>;
}

function DataSection() {
  const notify = useToast();
  const { reset } = useAccountPreferences();
  const device = useDevicePreferences();
  const { setPreference } = useTheme();
  const [confirming, setConfirming] = useState(false);
  return <Section id="data" title="本机数据" description="只影响这个浏览器，不会改服务端的任何东西。">
    <SettingRow id="recent" label="最近打开" hint="⌘K 和首页里「最近打开」的记录。">
      <Button size="sm" variant="ghost" onClick={() => { clearRecentItems(); notify("已清除最近打开", "success"); }}>清除</Button>
    </SettingRow>
    <SettingRow id="media-cache" label="已缓存的预览" hint="这次登录里看过的缩略图和预览。清除后再看会重新申请。">
      <Button size="sm" variant="ghost" onClick={() => { clearMediaSessionCaches(); notify("已清除缓存的预览", "success"); }}>清除</Button>
    </SettingRow>
    <SettingRow id="reset" label="恢复所有设置" hint="主题、动效、列表、面板、快捷键和保存的视图都回到默认。">
      {confirming
        ? <span className="flex gap-2"><Button size="sm" variant="ghost" onClick={() => setConfirming(false)}>取消</Button><Button size="sm" variant="danger" onClick={() => { reset(); device.reset(); setPreference("system"); setConfirming(false); notify("所有设置已恢复默认", "success"); }}>确认恢复</Button></span>
        : <Button size="sm" variant="ghost" icon={<RotateCcw className="size-3.5" />} onClick={() => setConfirming(true)}>恢复默认…</Button>}
    </SettingRow>
  </Section>;
}
