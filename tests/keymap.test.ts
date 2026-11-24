import { describe, expect, it } from "vitest";
import { bindingProblem, chordTokens, effectiveKeymap, goToHints, inspectorStep, keyCommands, normalizeChord, parseChord, resolveKey, shortcutReference, stepFromEvent } from "../src/shared/keymap";
import { prefersReducedMotion } from "../src/shared/motion/reduced";

const press = (key: string, extra: { ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean; shiftKey?: boolean } = {}) => stepFromEvent({ key, ...extra });
const idle = { typing: false, dialog: false, prevented: false };

describe("chords", () => {
  it("reads and writes one spelling per chord", () => {
    expect(normalizeChord("mod+k")).toBeNull();
    expect(normalizeChord("Mod+k")).toBe("Mod+K");
    expect(normalizeChord("Shift+Mod+k")).toBe("Mod+Shift+K");
    expect(normalizeChord("g  t")).toBe("G T");
    expect(normalizeChord("+")).toBe("+");
    expect(normalizeChord("Mod++")).toBe("Mod++");
    expect(normalizeChord("G T X")).toBeNull();
    expect(parseChord("Hyper+K")).toBeNull();
  });

  it("turns a key press into a step: symbols carry their own Shift, letters and named keys keep it", () => {
    expect(press("k", { ctrlKey: true })).toEqual({ mod: true, alt: false, shift: false, key: "K" });
    expect(press("K", { metaKey: true })).toEqual({ mod: true, alt: false, shift: false, key: "K" });
    expect(press("?", { shiftKey: true })).toEqual({ mod: false, alt: false, shift: false, key: "?" });
    expect(press("J", { shiftKey: true })).toEqual({ mod: false, alt: false, shift: true, key: "J" });
    expect(press("F10", { shiftKey: true })).toEqual({ mod: false, alt: false, shift: true, key: "F10" });
    expect(press(" ")).toEqual({ mod: false, alt: false, shift: false, key: "Space" });
    expect(press("Shift", { shiftKey: true })).toBeNull();
    expect(press("Unidentified")).toBeNull();
  });

  it("shows the platform's keys", () => {
    expect(chordTokens("Mod+K", "Ctrl")).toEqual(["Ctrl", "K"]);
    expect(chordTokens("Mod+K", "⌘")).toEqual(["⌘", "K"]);
    expect(chordTokens("Shift+F10", "Ctrl")).toEqual(["Shift", "F10"]);
    expect(chordTokens("G T", "Ctrl")).toEqual(["G", "T"]);
    expect(chordTokens("ArrowUp", "Ctrl")).toEqual(["↑"]);
    expect(chordTokens("Escape", "⌘")).toEqual(["Esc"]);
  });
});

describe("the dispatcher's decisions", () => {
  const keymap = effectiveKeymap();
  it("opens search anywhere, and waits with every other shortcut while typing or while a dialog is open", () => {
    expect(resolveKey(press("k", { ctrlKey: true }), null, keymap, { ...idle, typing: true })).toMatchObject({ kind: "run", command: { id: "search" } });
    expect(resolveKey(press("k", { metaKey: true }), null, keymap, { ...idle, dialog: true })).toMatchObject({ kind: "run", command: { id: "search" } });
    expect(resolveKey(press("/"), null, keymap, idle)).toMatchObject({ kind: "run", command: { id: "page-search" } });
    expect(resolveKey(press("/"), null, keymap, { ...idle, typing: true })).toEqual({ kind: "none" });
    expect(resolveKey(press("?"), null, keymap, { ...idle, dialog: true })).toEqual({ kind: "none" });
    expect(resolveKey(press("/"), null, keymap, { ...idle, prevented: true })).toEqual({ kind: "none" });
    expect(resolveKey(press("/", { altKey: true }), null, keymap, idle)).toEqual({ kind: "none" });
    expect(resolveKey(press("k", { ctrlKey: true, altKey: true }), null, keymap, idle)).toEqual({ kind: "none" });
  });

  it("runs a go-to sequence after the leader, and anything else ends it", () => {
    expect(resolveKey(press("g"), null, keymap, idle)).toEqual({ kind: "pending", leader: "G" });
    expect(resolveKey(press("t"), "G", keymap, idle)).toMatchObject({ kind: "run", command: { id: "go-tasks", target: "/tasks" } });
    expect(resolveKey(press("x"), "G", keymap, idle)).toEqual({ kind: "none" });
    expect(resolveKey(press("g"), null, keymap, { ...idle, typing: true })).toEqual({ kind: "none" });
    expect(resolveKey(press("j"), null, keymap, idle)).toMatchObject({ kind: "run", command: { id: "list-next" } });
  });

  it("follows a rebinding and drops one that is not allowed", () => {
    const moved = effectiveKeymap({ "page-search": "S", "go-tasks": "G Y" });
    expect(resolveKey(press("s"), null, moved, idle)).toMatchObject({ kind: "run", command: { id: "page-search" } });
    expect(resolveKey(press("/"), null, moved, idle)).toEqual({ kind: "none" });
    expect(resolveKey(press("y"), "G", moved, idle)).toMatchObject({ kind: "run", command: { id: "go-tasks" } });
    // Stored by hand: J is already the next row, and Escape is reserved. Both fall back to the defaults.
    expect(effectiveKeymap({ "page-search": "J" })["page-search"]).toEqual(["/"]);
    expect(effectiveKeymap({ shortcuts: "Escape" }).shortcuts).toEqual(["?"]);
  });
});

describe("what a binding may be", () => {
  const keymap = effectiveKeymap();
  it("refuses a taken, reserved or unsafe key with the reason", () => {
    expect(bindingProblem("page-search", "J", keymap)).toBe("已经用在：从页面上任何地方移到下一行");
    expect(bindingProblem("page-search", "Enter", keymap)).toMatch(/固定用处/);
    expect(bindingProblem("page-search", "G", keymap)).toMatch(/开始跳转/);
    expect(bindingProblem("page-search", "Shift+S", keymap)).toMatch(/大写/);
    expect(bindingProblem("page-search", "Alt+S", keymap)).toMatch(/Alt/);
    expect(bindingProblem("search", "S", keymap)).toMatch(/Ctrl/);
    expect(bindingProblem("search", "Mod+W", keymap)).toMatch(/浏览器/);
    expect(bindingProblem("go-tasks", "G H", keymap)).toBe("已经用在：跳到「今天」");
    expect(bindingProblem("go-tasks", "T", keymap)).toMatch(/以 G 开头/);
    expect(bindingProblem("go-tasks", "G Mod+T", keymap)).toMatch(/字母或数字/);
    expect(bindingProblem("list-move", "J", keymap)).toBe("这个快捷键不能改");
  });

  it("accepts a free key", () => {
    expect(bindingProblem("page-search", "S", keymap)).toBeNull();
    expect(bindingProblem("search", "Mod+P", keymap)).toBeNull();
    expect(bindingProblem("go-tasks", "G Y", keymap)).toBeNull();
  });

  it("keeps the keys a detail panel answers: [ and ] cannot become a shortcut of the shell", () => {
    const keymap = effectiveKeymap();
    expect(bindingProblem("page-search", "[", keymap)).toBe("已经用在：右侧详情：列表里的上一项、下一项");
    expect(bindingProblem("list-next", "]", keymap)).toBe("已经用在：右侧详情：列表里的上一项、下一项");
  });
});

describe("previous and next in a detail panel", () => {
  it("reads [ and ] without modifiers, and nothing else", () => {
    expect(inspectorStep(stepFromEvent({ key: "[" }))).toBe(-1);
    expect(inspectorStep(stepFromEvent({ key: "]" }))).toBe(1);
    expect(inspectorStep(stepFromEvent({ key: "[", ctrlKey: true }))).toBe(0);
    expect(inspectorStep(stepFromEvent({ key: "{", shiftKey: true }))).toBe(0);
    expect(inspectorStep(stepFromEvent({ key: "j" }))).toBe(0);
    expect(inspectorStep(null)).toBe(0);
  });

  it("maximizes with M by default, which does not collide with the go-to sequence G M, and may be rebound", () => {
    const keymap = effectiveKeymap();
    expect(keymap["inspector-maximize"]).toEqual(["M"]);
    expect(keymap["go-me"]).toEqual(["G M"]);
    expect(resolveKey(stepFromEvent({ key: "m" }), null, keymap, { typing: false, dialog: false, prevented: false })).toEqual({ kind: "none" });
    expect(effectiveKeymap({ "inspector-maximize": "X" })["inspector-maximize"]).toEqual(["X"]);
    // Taken by the panel, so no shell shortcut may use it, and it may not take one the shell or a panel uses.
    expect(bindingProblem("list-next", "M", keymap)).toMatch(/已经用在/);
    expect(bindingProblem("inspector-maximize", "J", keymap)).toMatch(/已经用在/);
  });
});

describe("the reference", () => {
  it("lists every group with this account's keys and keeps the texts the pages are known by", () => {
    const groups = shortcutReference("Ctrl", effectiveKeymap({ "page-search": "S" }));
    expect(groups.map((group) => group.title)).toEqual(["全局", "跳转", "列表", "详情", "查看器", "播放器"]);
    expect(groups[0]!.entries[0]!.keys).toEqual(["Ctrl", "K"]);
    expect(groups[0]!.entries.find((entry) => entry.id === "page-search")).toMatchObject({ action: "聚焦当前页的搜索框", keys: ["S"] });
    const actions = groups.flatMap((group) => group.entries.map((entry) => entry.action));
    for (const text of ["在任务、资源、请求和提醒之间移动", "放大、缩小、适应窗口"]) expect(actions).toContain(text);
    expect(new Set(keyCommands.map((command) => command.id)).size).toBe(keyCommands.length);
  });

  it("hints where each second key leads after the leader", () => {
    const hints = goToHints(effectiveKeymap({ "go-tasks": "G Y" }));
    expect(hints).toContainEqual({ key: "Y", label: "运行" });
    expect(hints).toContainEqual({ key: "H", label: "今天" });
  });
});

describe("motion preference", () => {
  const media = (matches: boolean) => () => ({ matches });
  it("follows the device's choice first, then the system", () => {
    expect(prefersReducedMotion({ dataset: { motion: "reduced" } }, media(false))).toBe(true);
    expect(prefersReducedMotion({ dataset: { motion: "full" } }, media(true))).toBe(false);
    expect(prefersReducedMotion({ dataset: {} }, media(true))).toBe(true);
    expect(prefersReducedMotion({ dataset: {} }, media(false))).toBe(false);
    expect(prefersReducedMotion(null, undefined)).toBe(false);
  });
});
