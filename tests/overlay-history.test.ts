import { describe, expect, it } from "vitest";
import { overlayMove, querySignature } from "../src/app/overlay-history";

const query = (value: string) => new URLSearchParams(value);
const keys = ["task", "preview"] as const;

describe("overlayMove", () => {
  it("opens when an overlay parameter appears and closes when one goes away", () => {
    expect(overlayMove(query("view=active"), query("view=active&task=a"), keys)).toBe("open");
    expect(overlayMove(query("task=a"), query("task=a&preview=r1"), keys)).toBe("open");
    expect(overlayMove(query("task=a&preview=r1"), query("task=a"), keys)).toBe("close");
    expect(overlayMove(query("task=a"), query(""), keys)).toBe("close");
  });

  it("switches when an open overlay moves to another item, and leaves other changes to the page", () => {
    expect(overlayMove(query("task=a"), query("task=b"), keys)).toBe("switch");
    expect(overlayMove(query("preview=r1"), query("preview=r2"), keys)).toBe("switch");
    // The viewer hands over to the inspector: still one overlay open.
    expect(overlayMove(query("preview=r1"), query("task=a"), keys)).toBe("switch");
    expect(overlayMove(query("task=a&q=x"), query("task=a&q=xy"), keys)).toBe("other");
    expect(overlayMove(query("q=x"), query("q=xy"), keys)).toBe("other");
  });
});

describe("querySignature", () => {
  it("compares parameters regardless of the order they were written in", () => {
    expect(querySignature(query("b=2&a=1"))).toBe(querySignature(query("a=1&b=2")));
    expect(querySignature(query("a=1"))).not.toBe(querySignature(query("a=2")));
  });
});
