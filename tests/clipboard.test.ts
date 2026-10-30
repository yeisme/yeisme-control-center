import { afterEach, describe, expect, it, vi } from "vitest";
import { copyReference } from "../src/shared/clipboard";

describe("copyReference", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("uses the Clipboard API when available", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    expect(await copyReference("project:one")).toBe(true);
    expect(writeText).toHaveBeenCalledWith("project:one");
  });

  it("falls back to a hidden textarea when Clipboard API is unavailable", async () => {
    const execCommand = vi.fn().mockReturnValue(true);
    const appended: { value?: string; removed?: boolean }[] = [];
    const fakeDocument = {
      body: { appendChild: (node: { remove: () => void }) => { appended.push(node as { value?: string; removed?: boolean }); } },
      createElement: () => {
        const node = { value: "", style: {} as Record<string, string>, setAttribute: vi.fn(), focus: vi.fn(), setSelectionRange: vi.fn(), select: vi.fn(), remove: vi.fn() };
        return node;
      },
      execCommand,
    };
    vi.stubGlobal("navigator", {});
    vi.stubGlobal("document", fakeDocument);
    expect(await copyReference("project:two")).toBe(true);
    expect(execCommand).toHaveBeenCalledWith("copy");
    expect(appended[0]?.value).toBe("project:two");
  });
});
