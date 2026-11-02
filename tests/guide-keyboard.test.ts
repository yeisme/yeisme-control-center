import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { GuideContent } from "../src/pages/guide/GuideContent";
import { Picker } from "../src/pages/guide/guide-parts";
import { appGuidePath, type GuideLocation } from "../src/pages/guide/guide-location";
import { ThemeSwitch } from "../src/pages/guide/PublicGuide";
import { moveBetweenRadios, radioTabIndex, radioTarget } from "../src/pages/guide/radio-keys";

const at = (patch: Partial<GuideLocation>): GuideLocation => ({ chapter: "start", page: null, tool: null, client: "claude", section: null, ...patch });
const nav = { hrefFor: (to: GuideLocation) => `#${appGuidePath(to)}`, go: () => undefined };

describe("radio group keys", () => {
  it("steps forward with → and ↓ and back with ← and ↑, and goes round at the ends", () => {
    for (const key of ["ArrowRight", "ArrowDown"]) {
      expect(radioTarget(4, 0, key), key).toBe(1);
      expect(radioTarget(4, 2, key), key).toBe(3);
      expect(radioTarget(4, 3, key), key).toBe(0);
    }
    for (const key of ["ArrowLeft", "ArrowUp"]) {
      expect(radioTarget(4, 3, key), key).toBe(2);
      expect(radioTarget(4, 1, key), key).toBe(0);
      expect(radioTarget(4, 0, key), key).toBe(3);
    }
    // Two radios (the client picker): either direction goes to the other one.
    expect(radioTarget(2, 0, "ArrowRight")).toBe(1);
    expect(radioTarget(2, 1, "ArrowRight")).toBe(0);
    expect(radioTarget(2, 0, "ArrowLeft")).toBe(1);
  });

  it("goes to the first and last with Home and End, and stays when already there", () => {
    expect(radioTarget(5, 3, "Home")).toBe(0);
    expect(radioTarget(5, 1, "End")).toBe(4);
    expect(radioTarget(5, 0, "Home")).toBeNull();
    expect(radioTarget(5, 4, "End")).toBeNull();
  });

  it("leaves every other key, and a group with nothing to move to, alone", () => {
    for (const key of ["Enter", " ", "Tab", "Escape", "PageDown", "a", "+"]) expect(radioTarget(4, 1, key), key).toBeNull();
    expect(radioTarget(1, 0, "ArrowRight")).toBeNull();
    expect(radioTarget(0, 0, "ArrowRight")).toBeNull();
    // Focus is not on a radio of this group.
    expect(radioTarget(4, -1, "ArrowRight")).toBeNull();
    expect(radioTarget(4, 4, "ArrowRight")).toBeNull();
  });

  it("makes the checked radio the one tab stop, or the first when none is checked", () => {
    for (const checked of [0, 1, 2, 3]) expect([0, 1, 2, 3].map((index) => radioTabIndex(index, checked))).toEqual([0, 1, 2, 3].map((index) => index === checked ? 0 : -1));
    expect([0, 1, 2].map((index) => radioTabIndex(index, -1))).toEqual([0, -1, -1]);
  });
});

describe("moveBetweenRadios", () => {
  /** Stand-ins for the buttons of a radio group; the handler only asks the container for them and focuses one. */
  const group = (count: number) => {
    const radios = Array.from({ length: count }, () => ({ focus: vi.fn() }));
    const container = { querySelectorAll: (selector: string) => selector === '[role="radio"]' ? radios : [] };
    return { radios, container };
  };
  const press = (key: string, count: number, from: number, extra: Record<string, unknown> = {}) => {
    const { radios, container } = group(count);
    const event = { key, defaultPrevented: false, altKey: false, ctrlKey: false, metaKey: false, shiftKey: false, preventDefault: vi.fn(), currentTarget: container, target: radios[from], ...extra };
    const select = vi.fn();
    moveBetweenRadios(event as never, select);
    return { radios, event, select };
  };

  it("moves focus to the radio the key names, checks it, and keeps the page from scrolling", () => {
    const { radios, event, select } = press("ArrowRight", 3, 0);
    expect(radios[1].focus).toHaveBeenCalledTimes(1);
    expect(radios[0].focus).not.toHaveBeenCalled();
    expect(select).toHaveBeenCalledWith(1);
    expect(event.preventDefault).toHaveBeenCalled();
    const wrapped = press("ArrowRight", 3, 2);
    expect(wrapped.radios[0].focus).toHaveBeenCalledTimes(1);
    expect(wrapped.select).toHaveBeenCalledWith(0);
    const end = press("End", 3, 0);
    expect(end.select).toHaveBeenCalledWith(2);
  });

  it("does nothing for keys the group does not use, for modified keys and for a key that was already handled", () => {
    for (const [key, extra] of [["Enter", {}], ["ArrowRight", { ctrlKey: true }], ["ArrowRight", { altKey: true }], ["ArrowRight", { metaKey: true }], ["ArrowRight", { shiftKey: true }], ["ArrowRight", { defaultPrevented: true }], ["Home", {}]] as const) {
      const { event, select, radios } = press(key, 3, key === "Home" ? 0 : 1, extra);
      expect(select, `${key} ${JSON.stringify(extra)}`).not.toHaveBeenCalled();
      expect(event.preventDefault).not.toHaveBeenCalled();
      expect(radios.every((radio) => radio.focus.mock.calls.length === 0)).toBe(true);
    }
  });

  it("ignores a key pressed on something that is not one of its radios", () => {
    const { radios, container } = group(3);
    const select = vi.fn();
    moveBetweenRadios({ key: "ArrowRight", defaultPrevented: false, altKey: false, ctrlKey: false, metaKey: false, shiftKey: false, preventDefault: vi.fn(), currentTarget: container, target: {} } as never, select);
    expect(select).not.toHaveBeenCalled();
    expect(radios.every((radio) => radio.focus.mock.calls.length === 0)).toBe(true);
  });
});

/** The radios of each radio group in the markup: whether each is checked and which tab index it has. */
function radioGroups(html: string) {
  return [...html.matchAll(/<div role="radiogroup" aria-label="([^"]*)"[^>]*>(.*?)<\/div>/g)].map((match) => ({
    label: match[1],
    radios: [...match[2].matchAll(/<button\b([^>]*)>/g)].map((button) => ({ checked: /aria-checked="true"/.test(button[1]), tabindex: /tabindex="(-?\d+)"/.exec(button[1])?.[1] })),
  }));
}

describe("the guide's pickers", () => {
  const options = [{ id: "a", label: "A" }, { id: "b", label: "B" }, { id: "c", label: "C" }];
  const render = (value: string) => renderToStaticMarkup(createElement(Picker, { label: "选择", value, options, onChange: () => undefined }));

  it("is one tab stop on the checked radio", () => {
    for (const [value, stop] of [["a", 0], ["b", 1], ["c", 2]] as const) {
      const [picker] = radioGroups(render(value));
      expect(picker.radios.map((radio) => radio.tabindex), value).toEqual([0, 1, 2].map((index) => index === stop ? "0" : "-1"));
      expect(picker.radios.map((radio) => radio.checked), value).toEqual([0, 1, 2].map((index) => index === stop));
    }
  });

  it("enters on the first radio when the value matches none", () => {
    const [picker] = radioGroups(render("gone"));
    expect(picker.radios.map((radio) => radio.tabindex)).toEqual(["0", "-1", "-1"]);
    expect(picker.radios.some((radio) => radio.checked)).toBe(false);
  });

  it("has exactly one tab stop in every radio group on the first screen of the guide", () => {
    const html = renderToStaticMarkup(createElement(GuideContent, { location: at({ tool: "sonora", client: "codex" }), nav, link: { label: "登录", href: "./" }, page: "public-guide" }));
    const groups = radioGroups(html);
    expect(groups.map((group) => group.label)).toEqual(["选择工具", "选择 Agent 客户端"]);
    for (const group of groups) {
      expect(group.radios.length, group.label).toBeGreaterThan(1);
      expect(group.radios.filter((radio) => radio.tabindex === "0"), group.label).toHaveLength(1);
      expect(group.radios.filter((radio) => radio.checked), group.label).toHaveLength(1);
      // The tab stop is the checked one.
      expect(group.radios.find((radio) => radio.tabindex === "0")?.checked, group.label).toBe(true);
    }
    const cases = radioGroups(renderToStaticMarkup(createElement(GuideContent, { location: at({ chapter: "cases", client: "codex" }), nav, link: { label: "登录", href: "./" }, page: "public-guide" })));
    expect(cases.map((group) => group.label)).toEqual(["选择回放的客户端"]);
    expect(cases[0].radios.map((radio) => radio.tabindex)).toEqual(["-1", "0"]);
  });
});

describe("the public page's theme switch", () => {
  it("is one radio group with one tab stop, on the checked preference", () => {
    // Outside a provider the preference is "system", the last of 浅色, 深色, 跟随系统.
    const [theme] = radioGroups(renderToStaticMarkup(createElement(ThemeSwitch)));
    expect(theme.label).toBe("主题");
    expect(theme.radios.map((radio) => radio.tabindex)).toEqual(["-1", "-1", "0"]);
    expect(theme.radios.map((radio) => radio.checked)).toEqual([false, false, true]);
  });
});

// What the render tests cannot see is whether the keys are wired to the groups: the browser step "the pickers and the theme
// switch are radio groups the keyboard drives" in scripts/verify-public-guide.ts presses them, and fails when they are not.
