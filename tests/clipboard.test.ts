import { afterEach, describe, expect, it, vi } from "vitest";
import { copyReference, copyText } from "../src/shared/clipboard";

type Listener = (event: { clipboardData: { setData: (type: string, value: string) => void } | null; preventDefault: () => void }) => void;

interface FakeNode {
  value: string;
  style: Record<string, string>;
  parent?: FakeHost;
  setAttribute: (name: string, value: string) => void;
  focus: () => void;
  select: () => void;
  setSelectionRange: () => void;
  remove: () => void;
  closest?: (selector: string) => FakeHost | null;
}
interface FakeHost { name: string; children: FakeNode[]; appendChild: (node: FakeNode) => void }

/**
 * A document small enough to see where the textarea went, what the copy event carried and where focus ended. `fires`
 * says whether execCommand fires the copy event (a browser that returns true without copying does not).
 */
function fakeDocument({ fires = true, execResult = true, insideDialog = true } = {}) {
  const listeners: Listener[] = [];
  const host = (name: string): FakeHost => {
    const value: FakeHost = { name, children: [], appendChild: (node) => { node.parent = value; value.children.push(node); } };
    return value;
  };
  const body = host("body");
  const dialog = host("dialog");
  const focused: string[] = [];
  const copied: string[] = [];
  const button: FakeNode = {
    value: "", style: {}, setAttribute: vi.fn(), focus: () => { focused.push("button"); }, select: vi.fn(), setSelectionRange: vi.fn(), remove: vi.fn(),
    closest: (selector) => insideDialog && selector.includes('[role="dialog"]') ? dialog : null,
  };
  const doc = {
    body,
    activeElement: button as unknown,
    createElement: (): FakeNode => {
      const node: FakeNode = {
        value: "", style: {}, setAttribute: vi.fn(), focus: () => { focused.push("textarea"); doc.activeElement = node; }, select: vi.fn(), setSelectionRange: vi.fn(),
        remove: () => { if (node.parent) node.parent.children = node.parent.children.filter((child) => child !== node); },
      };
      return node;
    },
    addEventListener: (type: string, listener: Listener) => { if (type === "copy") listeners.push(listener); },
    removeEventListener: (type: string, listener: Listener) => { const index = listeners.indexOf(listener); if (type === "copy" && index >= 0) listeners.splice(index, 1); },
    execCommand: vi.fn(() => {
      if (fires) for (const listener of [...listeners]) listener({ clipboardData: { setData: (_type, value) => { copied.push(value); } }, preventDefault: vi.fn() });
      return execResult;
    }),
  };
  return { doc, body, dialog, focused, copied, listeners };
}

describe("copyText", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("uses the Clipboard API in a secure context", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    expect(await copyText("project:one")).toBe(true);
    expect(writeText).toHaveBeenCalledWith("project:one");
  });

  it("keeps the old name working", () => {
    expect(copyReference).toBe(copyText);
  });

  it("mounts the fallback textarea inside the dialog that has focus, so the focus trap cannot take it away", async () => {
    const fake = fakeDocument();
    vi.stubGlobal("navigator", {});
    vi.stubGlobal("document", fake.doc);
    let during: string[] = [];
    fake.doc.execCommand.mockImplementationOnce(() => {
      during = fake.dialog.children.map((node) => node.value);
      for (const listener of [...fake.listeners]) listener({ clipboardData: { setData: (_type, value) => { fake.copied.push(value); } }, preventDefault: vi.fn() });
      return true;
    });
    expect(await copyText("ref:two")).toBe(true);
    expect(during).toEqual(["ref:two"]);
    expect(fake.body.children).toHaveLength(0);
    // Nothing is left behind and focus is back where it was.
    expect(fake.dialog.children).toHaveLength(0);
    expect(fake.focused.at(-1)).toBe("button");
    expect(fake.listeners).toHaveLength(0);
  });

  it("puts the whole text, line breaks and all, on the clipboard through the copy event", async () => {
    const fake = fakeDocument();
    vi.stubGlobal("navigator", {});
    vi.stubGlobal("document", fake.doc);
    const text = "你在帮我做 Yeisme 的漫剧。\n\n步骤：\n1. 先查";
    expect(await copyText(text)).toBe(true);
    expect(fake.copied).toEqual([text]);
  });

  it("counts a copy that never fired as a failure, even when execCommand says true", async () => {
    const fake = fakeDocument({ fires: false, execResult: true });
    vi.stubGlobal("navigator", {});
    vi.stubGlobal("document", fake.doc);
    expect(await copyText("ref:three")).toBe(false);
    expect(fake.dialog.children).toHaveLength(0);
  });

  it("falls back when the Clipboard API refuses, and when the context is not secure it does not try it at all", async () => {
    const fake = fakeDocument({ insideDialog: false });
    const writeText = vi.fn().mockRejectedValue(new Error("denied"));
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    vi.stubGlobal("document", fake.doc);
    expect(await copyText("ref:four")).toBe(true);
    expect(fake.copied).toEqual(["ref:four"]);

    const insecure = fakeDocument();
    const unused = vi.fn();
    vi.stubGlobal("window", { isSecureContext: false });
    vi.stubGlobal("navigator", { clipboard: { writeText: unused } });
    vi.stubGlobal("document", insecure.doc);
    expect(await copyText("ref:five")).toBe(true);
    expect(unused).not.toHaveBeenCalled();
  });

  it("reports failure when execCommand refuses", async () => {
    const fake = fakeDocument({ fires: false, execResult: false });
    vi.stubGlobal("navigator", {});
    vi.stubGlobal("document", fake.doc);
    expect(await copyText("ref:six")).toBe(false);
  });
});
