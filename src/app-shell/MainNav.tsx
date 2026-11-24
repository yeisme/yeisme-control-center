import { useState, useSyncExternalStore, type ReactNode } from "react";
import { Activity, Clapperboard, FolderKanban, LayoutDashboard, LayoutGrid, Monitor, Moon, MoreHorizontal, Plug, Settings, Sun } from "../icons";
import { entryOf, entryPages, navEntries, phoneEntries, type NavEntry, type NavEntryId, type WorkspacePage } from "./navigation";
import { useTasks } from "../app/tasks-context";
import { useNotifications } from "../app/notifications-context";
import { linkActions, useCopy } from "../app/item-actions";
import { useKeymap } from "../app/keymap";
import { useSlidingIndicator } from "../app/use-sliding-indicator";
import { ActionsContextMenu, DetailSheet, Kbd, cx } from "../components/ui";
import type { ThemePreference } from "./theme";
import { badgeText, entryBadgeCount } from "../shared/nav-badges";
import { chordTokens, keyCommands } from "../shared/keymap";
import { modKeyLabel } from "../shared/platform";

const entryIcons: Record<NavEntryId, typeof LayoutDashboard> = {
  today: Sun,
  projects: FolderKanban,
  create: Clapperboard,
  works: LayoutGrid,
  activity: Activity,
  connect: Plug,
  settings: Settings,
};

const wideQuery = "(min-width: 1024px)";
const subscribeWide = (change: () => void) => {
  const query = window.matchMedia?.(wideQuery);
  query?.addEventListener?.("change", change);
  return () => query?.removeEventListener?.("change", change);
};
/** Whether the rail is the side capsule (true) or the phone capsule, where some entries move into 「更多」. */
function useWideRail() {
  return useSyncExternalStore(subscribeWide, () => window.matchMedia?.(wideQuery).matches ?? true, () => true);
}

const entryPath = (entry: NavEntry) => entry.home === "home" ? "/" : `/${entry.home}`;

/** Unread reminders and results waiting to be picked: the two counts a person acts on, shown where they live. */
export function usePageBadges() {
  const tasks = useTasks();
  const reminders = useNotifications();
  const review = tasks.rows.filter((task) => task.state === "waiting_review").length;
  return (page: WorkspacePage) => page === "reminders" ? reminders.unread : page === "review" ? review : 0;
}

export const themeOptions: { id: ThemePreference; label: string; icon: ReactNode }[] = [
  { id: "light", label: "浅色", icon: <Sun /> },
  { id: "dark", label: "深色", icon: <Moon /> },
  { id: "system", label: "跟随系统", icon: <Monitor /> },
];

/** The go-to keys of the page an entry opens, as this account has them. */
function useGoKeys() {
  const keymap = useKeymap();
  const modifier = modKeyLabel();
  return (target: string) => {
    const command = keyCommands.find((candidate) => candidate.group === "跳转" && candidate.target === target);
    const chord = command ? keymap[command.id]?.[0] : undefined;
    return chord ? chordTokens(chord, modifier) : [];
  };
}

/**
 * The seven entries, rendered once. From 1024px a capsule runs down the left edge (the workspace keeps its 88px column,
 * so nothing beside it moves): making things at the top, wiring and preferences pinned to the bottom. Below that a
 * capsule floats over the bottom edge with four entries and 「更多」, which lists the rest. A pill slides to the current
 * entry; on wide screens pointing at an entry, or reaching it with the keyboard, shows what is inside and its go-to keys.
 */
export function MainNav({ page, onNavigate }: { page: WorkspacePage; onNavigate: (page: WorkspacePage) => void }) {
  const current = entryOf(page).id;
  const badgeOf = usePageBadges();
  const copy = useCopy();
  const goKeys = useGoKeys();
  const wide = useWideRail();
  const [more, setMore] = useState(false);
  const inMore = (id: NavEntryId) => !phoneEntries.includes(id);
  const moreActive = !wide && inMore(current);
  const moreEntries = navEntries.filter((entry) => inMore(entry.id));
  const moreCount = moreEntries.reduce((sum, entry) => sum + entryBadgeCount(entry.id, badgeOf), 0);
  const { ref, ready, indicator } = useSlidingIndicator<HTMLUListElement>("[data-nav-active]", `${current}:${wide}`, "rounded-full bg-rail-active shadow-[0_1px_2px_rgb(0_0_0/8%)] lg:rounded-[18px]");
  const entryButton = "relative flex h-[calc(var(--tabbar-height)-8px)] flex-1 flex-col items-center justify-center gap-0.5 rounded-full text-[11px] font-medium outline-offset-2 transition-colors duration-150";
  return <>
    <div aria-hidden="true" className="hidden w-[var(--rail-width)] shrink-0 lg:block" />
    <nav
      aria-label="主导航"
      data-tabbar
      className={cx(
        "fixed inset-x-3 bottom-[calc(10px+env(safe-area-inset-bottom))] z-nav flex h-[var(--tabbar-height)] items-center rounded-full border border-line/70 bg-rail/90 px-1 shadow-float backdrop-blur-xl",
        "lg:inset-x-auto lg:bottom-3 lg:left-3 lg:top-3 lg:h-auto lg:w-16 lg:flex-col lg:rounded-[28px] lg:px-1.5 lg:py-3",
      )}
    >
      <button type="button" onClick={() => onNavigate("home")} aria-label="Yeisme Studio：今天" className="mb-3 hidden size-11 shrink-0 place-items-center rounded-[14px] bg-lime text-[19px] font-bold text-lime-ink shadow-[0_10px_26px_-12px_var(--lime)] transition-transform duration-150 hover:-translate-y-px lg:grid">Y</button>
      <ul ref={ref} data-indicator-ready={ready ? "" : undefined} className="relative grid flex-1 grid-cols-5 lg:flex lg:w-full lg:flex-col lg:gap-1">
        {indicator}
        {navEntries.map((entry, index) => {
          const Icon = entryIcons[entry.id];
          const active = entry.id === current;
          const count = entryBadgeCount(entry.id, badgeOf);
          const keys = goKeys(entryPath(entry));
          const pages = entryPages(entry.id).map((item) => item.short).join(" · ");
          // The first entry of the second group starts the bottom block of the side capsule.
          const opensSetup = entry.group === "setup" && navEntries[index - 1]?.group !== "setup";
          return <ActionsContextMenu key={entry.id} actions={linkActions(entryPath(entry), copy)}><li data-nav-group={entry.group} className={cx("group/entry relative flex", inMore(entry.id) && "hidden lg:flex", opensSetup && "lg:mt-auto lg:border-t lg:border-line/70 lg:pt-2")}>
            <button
              type="button"
              data-nav-entry={entry.id}
              data-nav-active={active && (wide || !inMore(entry.id)) ? "" : undefined}
              aria-current={active ? "true" : undefined}
              onClick={() => onNavigate(entry.home)}
              className={cx(
                entryButton,
                "lg:h-14 lg:rounded-[18px] [@media(min-width:1024px)_and_(max-height:719px)]:h-11",
                active ? "text-rail-active-ink" : "text-rail-muted hover:text-rail-ink",
                active && !ready && "bg-rail-active",
              )}
            >
              <span className="relative grid h-6 w-10 place-items-center">
                <Icon className="size-[19px]" strokeWidth={active ? 2.1 : 1.8} />
                {count > 0 && <span aria-hidden="true" data-nav-badge={count} className="absolute -top-1 left-[calc(50%+4px)] min-w-4 rounded-full bg-accent px-1 text-center text-[10px] font-semibold leading-4 text-accent-ink tabular ring-2 ring-rail">{badgeText(count)}</span>}
              </span>
              <span className="[@media(min-width:1024px)_and_(max-height:719px)]:sr-only">{entry.label}</span>
              {/* Named by what it shows, then the count: 「动态，3 项待处理」. */}
              {count > 0 && <span className="sr-only">，{badgeText(count)} 项待处理</span>}
            </button>
            <span aria-hidden="true" data-nav-card={entry.id} className="pointer-events-none absolute left-[calc(100%+14px)] top-1/2 hidden w-56 -translate-y-1/2 translate-x-[-3px] rounded-[14px] border border-line bg-panel px-3 py-2.5 opacity-0 shadow-float transition-[opacity,transform] duration-150 group-hover/entry:translate-x-0 group-hover/entry:opacity-100 group-has-[:focus-visible]/entry:translate-x-0 group-has-[:focus-visible]/entry:opacity-100 lg:block">
              <span className="flex items-center justify-between gap-2 text-body-sm font-semibold text-ink">
                {entry.label}
                {keys.length > 0 && <span className="flex shrink-0 gap-0.5">{keys.map((key, index) => <Kbd key={`${key}-${index}`}>{key}</Kbd>)}</span>}
              </span>
              <span className="mt-0.5 block text-2xs text-muted">{pages}</span>
              {count > 0 && <span className="mt-1 block text-2xs font-medium text-warning">{badgeText(count)} 项待处理</span>}
            </span>
          </li></ActionsContextMenu>;
        })}
        <li className="flex lg:hidden">
          <button
            type="button"
            data-nav-more
            data-nav-active={moreActive ? "" : undefined}
            aria-current={moreActive ? "true" : undefined}
            aria-haspopup="dialog"
            onClick={() => setMore(true)}
            className={cx(entryButton, moreActive ? "text-rail-active-ink" : "text-rail-muted hover:text-rail-ink", moreActive && !ready && "bg-rail-active")}
          >
            <span className="relative grid h-6 w-10 place-items-center">
              <MoreHorizontal className="size-[19px]" strokeWidth={moreActive ? 2.1 : 1.8} />
              {moreCount > 0 && <span aria-hidden="true" className="absolute -top-1 left-[calc(50%+4px)] min-w-4 rounded-full bg-accent px-1 text-center text-[10px] font-semibold leading-4 text-accent-ink tabular ring-2 ring-rail">{badgeText(moreCount)}</span>}
            </span>
            <span>更多</span>
          </button>
        </li>
      </ul>
    </nav>
    {more && <DetailSheet open={more} onOpenChange={setMore} title="更多" returnFocus="[data-nav-more]">
      <ul data-nav-more-list className="grid gap-2">
        {moreEntries.map((entry) => {
          const Icon = entryIcons[entry.id];
          const active = entry.id === current;
          return <li key={entry.id}>
            <button
              type="button"
              data-nav-more-entry={entry.id}
              aria-current={active ? "true" : undefined}
              onClick={() => { setMore(false); onNavigate(entry.home); }}
              className={cx("flex min-h-14 w-full items-center gap-3 rounded-[14px] border px-3 py-2.5 text-left transition-colors duration-150", active ? "border-accent/50 bg-panel-sunken" : "border-line hover:bg-panel-sunken")}
            >
              <span className="grid size-9 shrink-0 place-items-center rounded-[10px] bg-panel-sunken text-ink"><Icon className="size-[18px]" /></span>
              <span className="min-w-0 flex-1">
                <span className="block text-body-sm font-semibold text-ink">{entry.label}</span>
                <span className="block truncate text-2xs text-muted">{entryPages(entry.id).map((item) => item.short).join(" · ")}</span>
              </span>
            </button>
          </li>;
        })}
      </ul>
    </DetailSheet>}
  </>;
}
