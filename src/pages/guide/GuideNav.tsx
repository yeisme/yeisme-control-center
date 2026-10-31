import { useEffect, useState, type MouseEvent, type ReactNode } from "react";
import { ArrowLeft, ArrowRight, ListTree } from "../../icons";
// Direct import: the public guide must not load the menu and dialog components behind the ui barrel.
import { cx } from "../../components/ui/cx";
import { guideChapters, type GuideLocation, type GuideOutlineItem } from "./guide-location";

/** How the page that renders the guide addresses and opens a location: the hash route when signed in, the query string on the public page. */
export interface GuideNavigator {
  hrefFor: (location: GuideLocation) => string;
  go: (location: GuideLocation, options?: { replace?: boolean }) => void;
}

/** A real link: a plain click moves within the guide, a modified click (new tab, new window) is left to the browser. */
export function GuideLink({ to, nav, replace, className, current, children, label }: { to: GuideLocation; nav: GuideNavigator; replace?: boolean; className?: string; current?: "page" | "location"; children: ReactNode; label?: string }) {
  const follow = (event: MouseEvent<HTMLAnchorElement>) => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    nav.go(to, { replace });
  };
  return <a href={nav.hrefFor(to)} onClick={follow} className={className} aria-current={current} aria-label={label}>{children}</a>;
}

/** The guide's top bar: one link per chapter, the current one marked. It sticks under the page's own top bar. */
export function GuideChapterNav({ location, nav }: { location: GuideLocation; nav: GuideNavigator }) {
  return <nav aria-label="指南章节" className="guide-chapters">
    <ul>{guideChapters.map((chapter) => <li key={chapter.id}>
      <GuideLink to={{ ...location, chapter: chapter.id, page: null, section: null }} nav={nav} current={chapter.id === location.chapter ? "page" : undefined}>{chapter.label}</GuideLink>
    </li>)}</ul>
  </nav>;
}

const flatten = (items: GuideOutlineItem[]): GuideOutlineItem[] => items.flatMap((item) => [item, ...(item.children ? flatten(item.children) : [])]);

/**
 * The section being read: the last heading that has passed under the sticky bars. Read on scroll, never written to
 * the address, so scrolling leaves Back alone.
 */
function useActiveSection(ids: string[]) {
  const [active, setActive] = useState<string | null>(null);
  const key = ids.join("|");
  useEffect(() => {
    if (!ids.length) return;
    let frame = 0;
    const measure = () => {
      frame = 0;
      // Below the chapter bar by more than a heading's scroll margin, so a section opened from the outline is the current one.
      const line = (document.querySelector(".guide-chapters")?.getBoundingClientRect().bottom ?? 0) + 56;
      let current: string | null = null;
      for (const id of ids) {
        const top = document.getElementById(id)?.getBoundingClientRect().top;
        if (top !== undefined && top <= line) current = id;
      }
      // At the very bottom the last section may never reach the line; it is still the one being read.
      if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 2) current = ids.filter((id) => document.getElementById(id)).at(-1) ?? current;
      setActive(current ?? ids[0]);
    };
    const schedule = () => { if (!frame) frame = window.requestAnimationFrame(measure); };
    measure();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    return () => { window.removeEventListener("scroll", schedule); window.removeEventListener("resize", schedule); if (frame) window.cancelAnimationFrame(frame); };
  }, [key]);
  return active;
}

/**
 * 本页大纲: the sections of the open chapter. A rail beside the text when the column is wide enough, otherwise a list
 * that folds under one button. One list serves both, so nothing is rendered twice.
 */
export function GuideOutline({ items, location, nav }: { items: GuideOutlineItem[]; location: GuideLocation; nav: GuideNavigator }) {
  const ids = flatten(items).map((item) => item.id);
  const active = useActiveSection(ids);
  const [open, setOpen] = useState(false);
  useEffect(() => { setOpen(false); }, [location.chapter, location.page]);
  if (items.length < 2) return null;
  const entry = (item: GuideOutlineItem): ReactNode => <li key={item.id}>
    <GuideLink to={{ ...location, section: item.id }} nav={nav} replace current={active === item.id ? "location" : undefined}>{item.label}</GuideLink>
    {item.children && <ol>{item.children.map(entry)}</ol>}
  </li>;
  return <nav aria-label="本页大纲" className="guide-outline" data-open={open || undefined}>
    <button type="button" className="guide-outline-toggle" aria-expanded={open} aria-controls="guide-outline-list" onClick={() => setOpen((value) => !value)}>
      <ListTree className="size-4" />本页大纲<span className="text-muted">· {items.length} 节</span>
    </button>
    <p className="guide-outline-title" aria-hidden="true">本页大纲</p>
    <ol id="guide-outline-list" className="guide-outline-list" onClick={(event) => { if ((event.target as HTMLElement).closest("a")) setOpen(false); }}>{items.map(entry)}</ol>
  </nav>;
}

/** Previous and next chapter, so the guide also reads front to back. */
export function GuideChapterPager({ location, nav }: { location: GuideLocation; nav: GuideNavigator }) {
  const index = guideChapters.findIndex((chapter) => chapter.id === location.chapter);
  const previous = guideChapters[index - 1];
  const next = guideChapters[index + 1];
  const to = (chapter: GuideLocation["chapter"]) => ({ ...location, chapter, page: null, section: null });
  return <nav aria-label="章节翻页" className="guide-pager">
    {previous ? <GuideLink to={to(previous.id)} nav={nav} className="guide-pager-link"><span className="guide-pager-dir"><ArrowLeft className="size-3.5" />上一章</span><span className="guide-pager-title">{previous.label}</span></GuideLink> : <span />}
    {next && <GuideLink to={to(next.id)} nav={nav} className={cx("guide-pager-link", "is-next")}><span className="guide-pager-dir">下一章<ArrowRight className="size-3.5" /></span><span className="guide-pager-title">{next.label}</span><span className="guide-pager-summary">{next.summary}</span></GuideLink>}
  </nav>;
}
