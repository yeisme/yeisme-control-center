/**
 * Every keyboard shortcut in one table. The shell runs the ones marked `dispatch`; lists, the viewer and the audio player
 * handle the rest themselves, and the table only names them. The shortcut reference and the settings page are drawn from
 * it, and the ones marked `rebindable` can be changed per account.
 *
 * A binding is a chord: `Mod+K` (Ctrl, or ⌘ on Apple), `/`, `Shift+F10`, or a two-key sequence such as `G T` (press G,
 * then T). A command may have more than one binding (`ArrowUp`, `ArrowDown`).
 */
export type KeyGroup = "全局" | "跳转" | "列表" | "详情" | "查看器" | "播放器";
export const keyGroups: readonly KeyGroup[] = ["全局", "跳转", "列表", "详情", "查看器", "播放器"];

export interface KeyCommand {
  id: string;
  /** What it does, in the reference and on the settings page. */
  label: string;
  group: KeyGroup;
  /** Default bindings. */
  keys: string[];
  rebindable: boolean;
  /** The shell runs it. Without this the entry documents keys that a list, the viewer or the player handles. */
  dispatch?: boolean;
  /** Runs even while typing in a field or with a dialog open (only search does). */
  anywhere?: boolean;
  /** A panel answers these keys itself while nothing is open above it, so no shortcut of the shell may take them. */
  held?: boolean;
  /** Where a go-to command leads. */
  target?: string;
}

/** The key that starts every go-to sequence. */
export const leaderKey = "G";

const go = (id: string, key: string, label: string, target: string): KeyCommand => ({ id: `go-${id}`, label: `跳到「${label}」`, group: "跳转", keys: [`${leaderKey} ${key}`], rebindable: true, dispatch: true, target });

export const keyCommands: readonly KeyCommand[] = [
  { id: "search", label: "搜索任务、作品、剧集和页面，或者执行操作", group: "全局", keys: ["Mod+K"], rebindable: true, dispatch: true, anywhere: true },
  { id: "page-search", label: "聚焦当前页的搜索框", group: "全局", keys: ["/"], rebindable: true, dispatch: true },
  { id: "shortcuts", label: "打开这张快捷键表", group: "全局", keys: ["?"], rebindable: true, dispatch: true },
  { id: "close", label: "关闭最上层的面板或弹窗", group: "全局", keys: ["Escape"], rebindable: false },
  go("home", "H", "今天", "/"),
  go("create", "C", "剧集制作", "/drama"),
  go("projects", "P", "项目", "/projects"),
  go("works", "W", "作品", "/assets"),
  go("activity", "A", "动态", "/activity"),
  go("connect", "N", "连接", "/services"),
  go("tasks", "T", "运行", "/tasks"),
  go("reminders", "R", "提醒", "/reminders"),
  go("requests", "Q", "请求", "/requests"),
  go("me", "M", "我的账号", "/team"),
  go("settings", "S", "设置", "/settings"),
  { id: "list-next", label: "从页面上任何地方移到下一行", group: "列表", keys: ["J"], rebindable: true, dispatch: true },
  { id: "list-prev", label: "从页面上任何地方移到上一行", group: "列表", keys: ["K"], rebindable: true, dispatch: true },
  { id: "list-move", label: "在任务、资源、请求和提醒之间移动", group: "列表", keys: ["ArrowUp", "ArrowDown"], rebindable: false },
  { id: "grid-move", label: "在资源大图网格里横向移动", group: "列表", keys: ["ArrowLeft", "ArrowRight"], rebindable: false },
  { id: "list-ends", label: "跳到第一项或最后一项", group: "列表", keys: ["Home", "End"], rebindable: false },
  { id: "list-open", label: "打开详情；关闭后焦点回到原来那一行", group: "列表", keys: ["Enter"], rebindable: false },
  { id: "row-menu", label: "打开当前行的右键菜单（菜单键也可以）；Esc 关闭后焦点回到这一行", group: "列表", keys: ["Shift+F10"], rebindable: false },
  { id: "search-into-list", label: "在页面搜索框里按下，进入列表第一项", group: "列表", keys: ["ArrowDown"], rebindable: false },
  { id: "inspector-step", label: "右侧详情：列表里的上一项、下一项", group: "详情", keys: ["[", "]"], rebindable: false, held: true },
  { id: "inspector-maximize", label: "右侧详情：最大化或还原", group: "详情", keys: ["M"], rebindable: true, held: true },
  { id: "inspector-width", label: "聚焦详情左边缘的把手后：← 调宽、→ 调窄（按住 Shift 每次 64px），Enter 恢复默认宽度", group: "详情", keys: ["ArrowLeft", "ArrowRight"], rebindable: false },
  { id: "viewer-step", label: "上一项、下一项", group: "查看器", keys: ["ArrowLeft", "ArrowRight"], rebindable: false },
  { id: "viewer-ends", label: "第一项、最后一项", group: "查看器", keys: ["Home", "End"], rebindable: false },
  { id: "viewer-zoom", label: "放大、缩小、适应窗口", group: "查看器", keys: ["+", "-", "0"], rebindable: false },
  { id: "viewer-play", label: "播放或暂停视频", group: "查看器", keys: ["Space"], rebindable: false },
  { id: "viewer-actual", label: "原始像素（1:1），再按一次回到适应窗口", group: "查看器", keys: ["1"], rebindable: false },
  { id: "viewer-info", label: "打开或收起这一项的信息", group: "查看器", keys: ["I"], rebindable: false },
  { id: "viewer-fullscreen", label: "全屏或退出全屏", group: "查看器", keys: ["F"], rebindable: false },
  { id: "viewer-close", label: "并排对比时先结束对比，再按一次关闭查看器", group: "查看器", keys: ["Escape"], rebindable: false },
  { id: "player-step", label: "键盘或耳机上的媒体键：播放队列的上一条、下一条", group: "播放器", keys: ["MediaTrackPrevious", "MediaTrackNext"], rebindable: false },
];

export const keyCommand = (id: string) => keyCommands.find((command) => command.id === id);

export interface Step { mod: boolean; alt: boolean; shift: boolean; key: string }

const namedKeys = new Set(["Escape", "Enter", "Tab", "Space", "Backspace", "Delete", "Home", "End", "PageUp", "PageDown", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "MediaTrackPrevious", "MediaTrackNext", "MediaPlayPause", "ContextMenu", ...Array.from({ length: 12 }, (_, index) => `F${index + 1}`)]);
const modifierOnly = new Set(["Shift", "Control", "Alt", "Meta", "AltGraph", "CapsLock", "Fn", "Dead", "Unidentified", "Process", "Compose"]);

/** One step of a chord from its text (`Mod+Shift+K`, `/`, `+`); null when it is not one. */
export function parseStep(text: string): Step | null {
  if (!text) return null;
  const parts = text === "+" ? ["+"] : text.endsWith("++") ? [...text.slice(0, -2).split("+"), "+"] : text.split("+");
  const key = parts.pop() || "";
  const step: Step = { mod: false, alt: false, shift: false, key: "" };
  for (const part of parts) {
    if (part === "Mod") step.mod = true;
    else if (part === "Alt") step.alt = true;
    else if (part === "Shift") step.shift = true;
    else return null;
  }
  if (/^[a-z]$/i.test(key)) step.key = key.toUpperCase();
  else if (namedKeys.has(key) || [...key].length === 1) step.key = key;
  else return null;
  return step;
}

/** A whole chord: one step, or a two-step sequence. */
export function parseChord(text: string): Step[] | null {
  const steps = text.trim().split(/\s+/).filter(Boolean).map(parseStep);
  if (!steps.length || steps.length > 2 || steps.some((step) => step === null)) return null;
  return steps as Step[];
}

export const stepText = (step: Step) => [step.mod && "Mod", step.alt && "Alt", step.shift && "Shift", step.key].filter(Boolean).join("+");
export const chordText = (steps: readonly Step[]) => steps.map(stepText).join(" ");
/** The one way a chord is written, so two spellings of the same keys compare equal. */
export const normalizeChord = (text: string) => { const steps = parseChord(text); return steps ? chordText(steps) : null; };

/**
 * The step a key press makes. A symbol already says whether Shift was held (`?` is Shift and `/`), so Shift is kept only
 * for letters and named keys: `?` is `?`, but a capital J is `Shift+J`.
 */
export function stepFromEvent(event: { key: string; ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean; shiftKey?: boolean }): Step | null {
  if (typeof event.key !== "string" || !event.key || modifierOnly.has(event.key)) return null;
  const letter = /^[a-z]$/i.test(event.key);
  const key = letter ? event.key.toUpperCase() : event.key === " " ? "Space" : event.key;
  if (!letter && !namedKeys.has(key) && [...key].length !== 1) return null;
  return { mod: !!(event.metaKey || event.ctrlKey), alt: !!event.altKey, shift: !!event.shiftKey && (letter || key.length > 1), key };
}

const keyLabels: Record<string, string> = { Escape: "Esc", ArrowUp: "↑", ArrowDown: "↓", ArrowLeft: "←", ArrowRight: "→", MediaTrackPrevious: "⏮", MediaTrackNext: "⏭", MediaPlayPause: "⏯", PageUp: "Page Up", PageDown: "Page Down" };

/** The keys to show for a chord: `Mod+K` is `Ctrl` `K`, or `⌘` `K` on Apple; `G T` is `G` `T`. */
export function chordTokens(chord: string, modifier: string): string[] {
  const steps = parseChord(chord);
  if (!steps) return [chord];
  const apple = modifier === "⌘";
  return steps.flatMap((step) => [step.mod && modifier, step.alt && (apple ? "⌥" : "Alt"), step.shift && (apple ? "⇧" : "Shift"), keyLabels[step.key] || step.key].filter((token): token is string => !!token));
}

/** Command id to its bindings: the defaults, with this account's changes to the rebindable ones. */
export type Keymap = Record<string, string[]>;

export function effectiveKeymap(overrides: Record<string, string> = {}): Keymap {
  const keymap: Keymap = {};
  for (const command of keyCommands) {
    const chosen = command.rebindable ? overrides[command.id] : undefined;
    const normal = chosen ? normalizeChord(chosen) : null;
    keymap[command.id] = normal && !bindingProblem(command.id, normal, defaultKeymapExcept(command.id, overrides)) ? [normal] : command.keys.map((key) => normalizeChord(key) || key);
  }
  return keymap;
}

/** Every other command as the account has it, to check one command's new binding against. */
function defaultKeymapExcept(id: string, overrides: Record<string, string>): Keymap {
  const keymap: Keymap = {};
  for (const command of keyCommands) {
    if (command.id === id) continue;
    const chosen = command.rebindable ? normalizeChord(overrides[command.id] || "") : null;
    keymap[command.id] = chosen ? [chosen] : command.keys.map((key) => normalizeChord(key) || key);
  }
  return keymap;
}

/** Keys that already mean something everywhere: they cannot start a shortcut of the shell. */
const reservedKeys = new Set(["Escape", "Enter", "Tab", "Space", "Backspace", "Delete", "Home", "End", "PageUp", "PageDown", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "ContextMenu", "F10"]);
/** Browser shortcuts a page never gets to see on some systems, or should not take: new tab, close, quit, reload, address bar. */
const browserChords = new Set(["Mod+W", "Mod+T", "Mod+N", "Mod+Q", "Mod+R", "Mod+L", "Mod+Shift+T", "Mod+Shift+N", "Mod+Shift+W"]);

/** Why a binding cannot be used for a command, or null when it can. `keymap` holds the other commands' bindings. */
export function bindingProblem(id: string, chord: string, keymap: Keymap): string | null {
  const command = keyCommand(id);
  if (!command?.rebindable) return "这个快捷键不能改";
  const steps = parseChord(chord);
  if (!steps) return "认不出这个按键";
  const goTo = command.group === "跳转";
  if (goTo) {
    if (steps.length !== 2 || stepText(steps[0]!) !== leaderKey) return `跳转都以 ${leaderKey} 开头，再按一个键`;
    const second = steps[1]!;
    if (second.mod || second.alt || second.shift || !/^[A-Z0-9]$/.test(second.key)) return "第二个键要是一个字母或数字";
  } else {
    if (steps.length !== 1) return "这里只能用一个键或一个组合键";
    const step = steps[0]!;
    if (step.alt) return "不支持 Alt / Option 组合：不同键盘布局下它打出的字不一样";
    if (command.anywhere && !step.mod) return "搜索在输入框里也能打开，所以要带 Ctrl / ⌘";
    if (!step.mod && reservedKeys.has(step.key)) return "这个键已经有固定用处（关闭、确认、移动或右键菜单），换一个";
    if (!step.mod && step.shift) return "单独的大写字母容易误按，换一个字母，或者加上 Ctrl / ⌘";
    if (!step.mod && stepText(step) === leaderKey) return `${leaderKey} 用来开始跳转（先按 ${leaderKey} 再按别的键），换一个`;
    if (browserChords.has(stepText(step))) return "浏览器自己用这个组合，页面拿不到";
  }
  const text = chordText(steps);
  for (const other of keyCommands) {
    if (other.id === id || !(other.dispatch || other.held)) continue;
    if ((keymap[other.id] || []).includes(text)) return `已经用在：${other.label}`;
  }
  return null;
}

export type Resolution = { kind: "run"; command: KeyCommand } | { kind: "pending"; leader: string } | { kind: "none" };

/**
 * What a key press does. Shortcuts other than search wait while a field takes text or a dialog or menu owns the keyboard.
 * After the leader key, the next press finishes the sequence or cancels it.
 */
export function resolveKey(step: Step | null, pending: string | null, keymap: Keymap, context: { typing: boolean; dialog: boolean; prevented: boolean }): Resolution {
  if (!step || context.prevented) return { kind: "none" };
  const text = stepText(step);
  const bound = (chord: string) => keyCommands.find((command) => command.dispatch && (keymap[command.id] || []).includes(chord));
  if (pending) {
    const command = bound(`${pending} ${text}`);
    return command && !context.typing && !context.dialog ? { kind: "run", command } : { kind: "none" };
  }
  const command = bound(text);
  if (command && (command.anywhere || (!context.typing && !context.dialog))) return { kind: "run", command };
  if (command || context.typing || context.dialog || step.mod || step.alt) return { kind: "none" };
  const starts = keyCommands.some((candidate) => candidate.dispatch && (keymap[candidate.id] || []).some((chord) => chord.startsWith(`${text} `)));
  return starts ? { kind: "pending", leader: text } : { kind: "none" };
}

export interface ShortcutEntry { keys: string[]; action: string; id: string }
export interface ShortcutGroup { title: KeyGroup; entries: ShortcutEntry[] }

/** The shortcut reference, with this account's bindings. */
export function shortcutReference(modifier: string, keymap: Keymap = effectiveKeymap()): ShortcutGroup[] {
  return keyGroups.map((title) => ({
    title,
    entries: keyCommands.filter((command) => command.group === title).map((command) => ({ id: command.id, action: command.label, keys: (keymap[command.id] || command.keys).flatMap((chord) => chordTokens(chord, modifier)) })),
  })).filter((group) => group.entries.length > 0);
}

/** The go-to sequences as the leader hint lists them: key and page. */
export function goToHints(keymap: Keymap): { key: string; label: string }[] {
  return keyCommands.filter((command) => command.group === "跳转").flatMap((command) => {
    const steps = parseChord((keymap[command.id] || [])[0] || "");
    return steps && steps.length === 2 ? [{ key: steps[1]!.key, label: command.label.replace(/^跳到「|」$/g, "") }] : [];
  });
}

/** `[` and `]` in a detail panel: the previous (−1) or next (1) item; 0 for any other key. */
export function inspectorStep(step: Step | null): -1 | 0 | 1 {
  if (!step || step.mod || step.alt) return 0;
  return step.key === "[" ? -1 : step.key === "]" ? 1 : 0;
}
