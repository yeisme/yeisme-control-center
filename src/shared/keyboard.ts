/** Keyboard conventions shared by the lists, the shell shortcuts and the shortcut reference. */

export interface Box { left: number; top: number; width: number; height: number }
export type ListLayout = "list" | "grid";

/**
 * Index focus moves to from `current` for one key, or null when the key does not move it.
 * Lists step by one; grids step along the row with ←/→ and to the closest column of the next row with ↑/↓.
 */
export function moveIndex(boxes: Box[], current: number, key: string, layout: ListLayout): number | null {
  const last = boxes.length - 1;
  if (current < 0 || current > last) return null;
  if (key === "Home") return current === 0 ? null : 0;
  if (key === "End") return current === last ? null : last;
  const forward = layout === "list" ? "ArrowDown" : "ArrowRight";
  const backward = layout === "list" ? "ArrowUp" : "ArrowLeft";
  if (key === forward) return current < last ? current + 1 : null;
  if (key === backward) return current > 0 ? current - 1 : null;
  if (layout === "list" || (key !== "ArrowDown" && key !== "ArrowUp")) return null;
  const from = boxes[current];
  const middle = from.top + from.height / 2;
  const down = key === "ArrowDown";
  const candidates = boxes.map((box, index) => ({ box, index })).filter(({ box }) => down ? box.top >= middle : box.top + box.height <= middle);
  if (!candidates.length) return null;
  const rowTop = down ? Math.min(...candidates.map(({ box }) => box.top)) : Math.max(...candidates.map(({ box }) => box.top));
  const centre = (box: Box) => box.left + box.width / 2;
  return candidates
    .filter(({ box }) => Math.abs(box.top - rowTop) < from.height / 2)
    .reduce((best, item) => Math.abs(centre(item.box) - centre(from)) < Math.abs(centre(best.box) - centre(from)) ? item : best).index;
}

const textEntry = [
  "input:not([type='checkbox']):not([type='radio']):not([type='button']):not([type='submit']):not([type='reset']):not([type='range'])",
  "textarea",
  "select",
  "[contenteditable]:not([contenteditable='false'])",
  "[role='textbox']",
  "[role='combobox']",
].join(", ");

/** True when a key press belongs to text entry rather than to page shortcuts. */
export function isTypingTarget(target: EventTarget | null): boolean {
  const element = target as Element | null;
  return typeof element?.closest === "function" && element.closest(textEntry) !== null;
}

export type ShellShortcut = "search" | "page-search" | "shortcuts";

/** Which shell shortcut a key press triggers. Page shortcuts never fire while typing or while a dialog owns the keyboard. */
export function shellShortcut(event: { key: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean; defaultPrevented: boolean; target: EventTarget | null }, dialogOpen: boolean): ShellShortcut | null {
  if ((event.metaKey || event.ctrlKey) && !event.altKey && event.key.toLowerCase() === "k") return "search";
  if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey || dialogOpen || isTypingTarget(event.target)) return null;
  if (event.key === "/") return "page-search";
  if (event.key === "?") return "shortcuts";
  return null;
}

/** Modifier shown for Ctrl/⌘ shortcuts on this platform. */
export const modifierLabel = (userAgent: string) => /Mac|iPhone|iPad/.test(userAgent) ? "⌘" : "Ctrl";

export interface ShortcutEntry { keys: string[]; action: string }
export interface ShortcutGroup { title: string; entries: ShortcutEntry[] }

/** The shortcut reference. Every entry here is handled by the shell, the lists, the viewer or the audio player. */
export function shortcutGroups(modifier: string): ShortcutGroup[] {
  return [
    { title: "全局", entries: [
      { keys: [modifier, "K"], action: "搜索任务、模型与工具，跳转页面或执行操作" },
      { keys: ["/"], action: "聚焦当前页的搜索框" },
      { keys: ["?"], action: "打开这张快捷键表" },
      { keys: ["Esc"], action: "关闭最上层的面板或弹窗" },
    ] },
    { title: "列表", entries: [
      { keys: ["↑", "↓"], action: "在任务、资源、请求和提醒之间移动" },
      { keys: ["←", "→"], action: "在资源大图网格里横向移动" },
      { keys: ["Home", "End"], action: "跳到第一项或最后一项" },
      { keys: ["Enter"], action: "打开详情；关闭后焦点回到原来那一行" },
      { keys: ["Shift", "F10"], action: "打开当前行的右键菜单（菜单键也可以）；Esc 关闭后焦点回到这一行" },
      { keys: ["↓"], action: "在页面搜索框里按下，进入列表第一项" },
    ] },
    { title: "查看器", entries: [
      { keys: ["←", "→"], action: "上一项、下一项" },
      { keys: ["Home", "End"], action: "第一项、最后一项" },
      { keys: ["+", "-", "0"], action: "放大、缩小、适应窗口" },
      { keys: ["Space"], action: "播放或暂停视频" },
      { keys: ["Esc"], action: "并排对比时先结束对比，再按一次关闭查看器" },
    ] },
    { title: "播放器", entries: [
      { keys: ["⏮", "⏭"], action: "键盘或耳机上的媒体键：播放队列的上一条、下一条" },
    ] },
  ];
}
