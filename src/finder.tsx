import { useRef, type ReactNode } from "react";
import {
  animated,
  useSpring,
  useTransition,
  useReducedMotion,
} from "@react-spring/web";
import { ContextMenu, Dialog, DropdownMenu } from "./ui";
import {
  Activity,
  ArrowDownUp,
  ArrowUpRight,
  AudioLines,
  BookOpen,
  Box,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clapperboard,
  Cloud,
  Cpu,
  FileText,
  FolderOpen,
  HardDrive,
  Globe,
  Layers,
  Send,
  TrendingUp,
  Wrench,
  Image,
  Info,
  LayoutGrid,
  List,
  Network,
  NotebookPen,
  Search,
  Server,
  ShieldCheck,
  Sparkles,
  X,
} from "./icons";
import { ExtendFolder, ExtendThumbnail } from "./extend-finder";
import type { ItemKind, ViewMode, SortOrder } from "./finder-state";
export const finderSpring = {
  mass: 0.8,
  tension: 360,
  friction: 34,
  clamp: true,
};
export function ServiceGlyph({
  id,
  size = 20,
  large = false,
}: {
  id: string;
  size?: number;
  large?: boolean;
}) {
  const icons: Record<string, typeof Server> = {
    scaena: Clapperboard,
    eikona: Image,
    sonora: AudioLines,
    auctra: NotebookPen,
    anatomia: Activity,
    drivebridge: HardDrive,
    pinax: BookOpen,
    manju: Layers,
    capsa: Cloud,
    aigora: Network,
    credentialctl: ShieldCheck,
    templates: FileText,
    quaestor: Search,
    "digital-human": Sparkles,
    runtime: Cpu,
    firecrawl: Globe,
    gitea: Network,
    blender: Box,
    yeitra: Box,
    layerlab: Image,
    solocut: Clapperboard,
    dist: Send,
    hotlist: TrendingUp,
    "gateway-legacy": Network,
    "server-quality": Wrench,
  };
  const Icon = icons[id] || Server;
  const tone =
    id === "sonora"
      ? "tone-audio"
      : ["eikona", "layerlab"].includes(id)
        ? "tone-image"
        : ["scaena", "solocut"].includes(id)
          ? "tone-video"
          : ["auctra", "anatomia", "templates"].includes(id)
            ? "tone-document"
            : "tone-neutral";
  return (
    <span
      className={`service-glyph ${large ? "large" : ""} glyph-${id.split("-")[0]} ${tone}`}
    >
      <Icon size={Math.min(20, size)} />
    </span>
  );
}
export function FolderArtwork({ small = false }: { small?: boolean }) {
  return <ExtendFolder small={small} />;
}
export interface BrowserItem {
  id: string;
  kind: ItemKind;
  name: string;
  type: string;
  subtitle: string;
  status?: string;
  detail?: string;
  image?: string;
  service?: string;
  count?: string;
  owner?: string;
  updated?: string;
}
export function ItemArtwork({
  item,
  small = false,
}: {
  item: BrowserItem;
  small?: boolean;
}) {
  if (item.kind === "project") return <FolderArtwork small={small} />;
  if (item.kind === "service")
    return (
      <ServiceGlyph
        id={item.service || item.id}
        size={small ? 20 : 38}
        large={!small}
      />
    );
  if (item.image) return <ExtendThumbnail src={item.image} small={small} />;
  return (
    <span
      className={`file-art ${small ? "small" : ""} ${item.type === "音频" ? "audio-file tone-audio" : item.type === "文稿" ? "document-file tone-document" : "text-file"}`}
    >
      {item.type === "音频" ? (
        <AudioLines size={small ? 20 : 39} />
      ) : (
        <FileText size={small ? 20 : 39} />
      )}
      <span>
        {item.type === "音频" ? "音频" : item.type === "文稿" ? "文稿" : "文件"}
      </span>
    </span>
  );
}
function ObjectMenu({
  item,
  children,
  select,
  open,
  quick,
  info,
}: {
  item: BrowserItem;
  children: ReactNode;
  select: () => void;
  open: () => void;
  quick: () => void;
  info: () => void;
}) {
  return (
    <ContextMenu.Root onOpenChange={(v) => v && select()}>
      <ContextMenu.Trigger asChild>{children}</ContextMenu.Trigger>
      <ContextMenu.Portal>
        <ContextMenu.Content className="finder-menu">
          <ContextMenu.Label>{item.name}</ContextMenu.Label>
          <ContextMenu.Item onSelect={open}>
            <FolderOpen size={15} />
            打开<small>↵</small>
          </ContextMenu.Item>
          <ContextMenu.Item onSelect={quick}>
            <Image size={15} />
            快速查看<small>空格</small>
          </ContextMenu.Item>
          <ContextMenu.Separator />
          <ContextMenu.Item onSelect={info}>
            <Info size={15} />
            显示简介
          </ContextMenu.Item>
        </ContextMenu.Content>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  );
}
export function ObjectBrowser({
  items,
  view,
  selected,
  onSelect,
  onOpen,
  onQuickLook,
  onInfo,
  label,
  draggable = false,
}: {
  items: BrowserItem[];
  view: ViewMode;
  selected: string | null;
  onSelect: (item: BrowserItem) => void;
  onOpen: (item: BrowserItem) => void;
  onQuickLook: (item: BrowserItem, rect?: DOMRect) => void;
  onInfo: (item: BrowserItem) => void;
  label: string;
  draggable?: boolean;
}) {
  const reduced = useReducedMotion(),
    refs = useRef(new Map<string, HTMLElement>()),
    grid = useRef<HTMLDivElement>(null);
  const [motion] = useSpring(
    () => ({
      from: { opacity: 0, y: 5 },
      to: { opacity: 1, y: 0 },
      reset: true,
      config: finderSpring,
      immediate: !!reduced,
    }),
    [view, reduced],
  );
  const mode = view;
  const focusKey =
    selected && items.some((i) => i.id === selected) ? selected : items[0]?.id;
  const keyboard = (e: React.KeyboardEvent, item: BrowserItem) => {
    if (e.key === "Enter") {
      e.preventDefault();
      onOpen(item);
      return;
    }
    if (e.key === " ") {
      e.preventDefault();
      onQuickLook(item, e.currentTarget.getBoundingClientRect());
      return;
    }
    if (
      [
        "ArrowLeft",
        "ArrowRight",
        "ArrowUp",
        "ArrowDown",
        "Home",
        "End",
      ].includes(e.key)
    ) {
      e.preventDefault();
      const columns =
        view === "list"
          ? 1
          : Math.max(
              1,
              getComputedStyle(grid.current!).gridTemplateColumns.split(" ")
                .length,
            );
      const next =
        items[
          nextItemIndexLocal(
            items.findIndex((i) => i.id === item.id),
            e.key,
            items.length,
            columns,
          )
        ];
      if (next) {
        onSelect(next);
        refs.current.get(next.id)?.focus();
      }
    }
  };
  return (
    <animated.div
      className={"object-view " + mode}
      style={{
        opacity: motion.opacity,
        transform: motion.y.to((y) => `translateY(${y}px)`),
      }}
    >
      {mode === "icons" ? (
        <div
          className="finder-object-grid"
          ref={grid}
          role="listbox"
          aria-label={label}
        >
          {items.map((item) => (
            <ObjectMenu
              key={item.id}
              item={item}
              select={() => onSelect(item)}
              open={() => onOpen(item)}
              quick={() =>
                onQuickLook(
                  item,
                  refs.current.get(item.id)?.getBoundingClientRect(),
                )
              }
              info={() => onInfo(item)}
            >
              <div
                className={
                  "finder-object " + (selected === item.id ? "selected" : "")
                }
                ref={(el) => {
                  if (el) refs.current.set(item.id, el);
                  else refs.current.delete(item.id);
                }}
                data-object-id={item.id}
                data-od-id={"artifact-" + item.id.replace(/[^a-z0-9-]/gi, "-")}
                draggable={draggable}
                role="option"
                aria-selected={selected === item.id}
                aria-label={item.name}
                tabIndex={focusKey === item.id ? 0 : -1}
                onClick={() => onSelect(item)}
                onDoubleClick={() => onOpen(item)}
                onKeyDown={(e) => keyboard(e, item)}
              >
                <span className="artwork-well">
                  <ItemArtwork item={item} />
                </span>
                <span className="object-name">{item.name}</span>
                <span className="object-subtitle">
                  {item.count || item.subtitle}
                </span>
                {item.kind === "asset" && (
                  <span className="library-item-status">
                    {item.type} · {item.status}
                  </span>
                )}
              </div>
            </ObjectMenu>
          ))}
        </div>
      ) : (
        <div className="finder-list" role="listbox" aria-label={label}>
          <div className="finder-list-head" aria-hidden="true">
            <span>名称</span>
            <span>种类</span>
            <span>状态与内容</span>
          </div>
          {items.map((item) => (
            <ObjectMenu
              key={item.id}
              item={item}
              select={() => onSelect(item)}
              open={() => onOpen(item)}
              quick={() => onQuickLook(item)}
              info={() => onInfo(item)}
            >
              <div
                className={
                  "finder-list-row " + (selected === item.id ? "selected" : "")
                }
                role="option"
                aria-selected={selected === item.id}
                aria-label={item.name}
                data-object-id={item.id}
                data-od-id={
                  "artifact-row-" + item.id.replace(/[^a-z0-9-]/gi, "-")
                }
                draggable={draggable}
                tabIndex={focusKey === item.id ? 0 : -1}
                ref={(el) => {
                  if (el) refs.current.set(item.id, el);
                  else refs.current.delete(item.id);
                }}
                onClick={() => onSelect(item)}
                onDoubleClick={() => onOpen(item)}
                onKeyDown={(e) => keyboard(e, item)}
              >
                <span className="list-object-name">
                  <ItemArtwork item={item} small />
                  <span>{item.name}</span>
                </span>
                <span className="list-kind">{item.type}</span>
                <span className="list-info">
                  {item.status || item.count || item.subtitle}
                </span>
              </div>
            </ObjectMenu>
          ))}
        </div>
      )}
    </animated.div>
  );
}
import { nextItemIndex as nextItemIndexLocal } from "./finder-state";
export function ViewSwitcher({
  value,
  onChange,
}: {
  value: ViewMode;
  onChange: (view: ViewMode) => void;
}) {
  return (
    <div className="finder-view-switch" role="group" aria-label="浏览视图">
      <button
        aria-label="图标视图"
        aria-pressed={value === "icons"}
        onClick={() => onChange("icons")}
      >
        <LayoutGrid size={18} />
      </button>
      <button
        aria-label="列表视图"
        aria-pressed={value === "list"}
        onClick={() => onChange("list")}
      >
        <List size={20} />
      </button>
    </div>
  );
}
export function SortMenu({
  value,
  onChange,
  options,
}: {
  value: SortOrder;
  onChange: (v: SortOrder) => void;
  options: { value: SortOrder; label: string }[];
}) {
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger className="finder-tool" aria-label="排序">
        <ArrowDownUp size={18} />
        <ChevronDown size={10} />
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content className="finder-menu" sideOffset={7}>
          <DropdownMenu.Label>排列方式</DropdownMenu.Label>
          <DropdownMenu.RadioGroup
            value={value}
            onValueChange={(v) => onChange(v as SortOrder)}
          >
            {options.map((o) => (
              <DropdownMenu.RadioItem key={o.value} value={o.value}>
                <span className="menu-check">
                  <DropdownMenu.ItemIndicator>
                    <Check size={14} />
                  </DropdownMenu.ItemIndicator>
                </span>
                {o.label}
              </DropdownMenu.RadioItem>
            ))}
          </DropdownMenu.RadioGroup>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
export function QuickLook({
  item,
  origin,
  close,
  previous,
  next,
  open,
}: {
  item: BrowserItem | null;
  origin: { x: number; y: number } | null;
  close: () => void;
  previous: () => void;
  next: () => void;
  open: () => void;
}) {
  const reduced = useReducedMotion(),
    trigger = useRef<HTMLElement | null>(null),
    last = useRef<BrowserItem | null>(item);
  if (item) last.current = item;
  const current = last.current;
  const transitions = useTransition(item ? [true] : [], {
    keys: (v) => String(v),
    from: { opacity: 0, scale: 0.965, y: 7 },
    enter: { opacity: 1, scale: 1, y: 0 },
    leave: { opacity: 0, scale: 0.985, y: 3 },
    config: finderSpring,
    immediate: !!reduced,
  });
  if (!current) return null;
  return (
    <Dialog.Root open={!!item} onOpenChange={(v) => !v && close()}>
      {transitions((style) => (
        <Dialog.Portal forceMount>
          <animated.div
            className="quicklook-shade"
            style={{ opacity: style.opacity }}
            onClick={close}
          />
          <Dialog.Content
            forceMount
            asChild
            onOpenAutoFocus={() => {
              trigger.current = document.activeElement as HTMLElement;
            }}
            onCloseAutoFocus={(e) => {
              e.preventDefault();
              const selected = document.querySelector<HTMLElement>(
                "[role=option][aria-selected=true]",
              );
              if (
                trigger.current?.getAttribute("role") === "option" &&
                selected
              )
                selected.focus();
              else if (trigger.current?.isConnected) trigger.current.focus();
            }}
            onKeyDown={(e) => {
              if (
                e.target instanceof HTMLInputElement ||
                e.target instanceof HTMLTextAreaElement
              )
                return;
              if (e.key === " ") {
                e.preventDefault();
                close();
              }
              if (e.key === "ArrowLeft") {
                e.preventDefault();
                previous();
              }
              if (e.key === "ArrowRight") {
                e.preventDefault();
                next();
              }
            }}
          >
            <animated.section
              className="quicklook"
              style={{
                opacity: style.opacity,
                transform: style.scale.to((s) => `scale(${s})`),
                transformOrigin: origin
                  ? `${origin.x - (innerWidth - Math.min(760, innerWidth - 32)) / 2}px ${origin.y - (innerHeight - Math.min(620, innerHeight - 60)) / 2}px`
                  : "center",
              }}
            >
              <header>
                <button
                  className="icon-button"
                  aria-label="关闭快速查看"
                  onClick={close}
                >
                  <X size={18} />
                </button>
                <span>
                  <Dialog.Title>{current.name}</Dialog.Title>
                  <Dialog.Description>{current.subtitle}</Dialog.Description>
                </span>
                <div className="quicklook-navigation">
                  <button
                    className="icon-button"
                    aria-label="上一个对象"
                    onClick={previous}
                  >
                    <ChevronLeft size={18} />
                  </button>
                  <button
                    className="icon-button"
                    aria-label="下一个对象"
                    onClick={next}
                  >
                    <ChevronRight size={18} />
                  </button>
                </div>
              </header>
              <div
                className={
                  "quicklook-media " + (current.image ? "has-media" : "")
                }
              >
                {current.image ? (
                  <img src={current.image} alt={current.name + " · 参考素材"} />
                ) : (
                  <>
                    <ItemArtwork item={current} />
                    <strong>{current.name}</strong>
                    <p>
                      {current.detail || "选择打开以查看此对象的内容与关联。"}
                    </p>
                  </>
                )}
              </div>
              <footer>
                <span>
                  {current.type} ·{" "}
                  {current.status || current.count || current.subtitle}
                </span>
                <button className="button" onClick={open}>
                  打开详情
                  <ArrowUpRight size={14} />
                </button>
              </footer>
            </animated.section>
          </Dialog.Content>
        </Dialog.Portal>
      ))}
    </Dialog.Root>
  );
}
