import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CredentialsPanel } from "../src/pages/services/CredentialsPanel";
import { credentialTarget } from "../src/pages/services/credential-target";
import type { CredentialState, CredentialStatus } from "../src/shared/credentials";

const row = (id: string, state: CredentialState, extra: Partial<CredentialStatus> = {}): CredentialStatus => ({ id, owner: id.split(":")[1] || id, label: id, state, shared_with: [], ...extra });
const rows = [
  row("connection:eikona-main", "rejected", { reason: "owner_denied" }),
  row("open_tool:drivebridge", "expiring", { stage: "7d", days_left: 3 }),
  row("open_tool:gateway", "ok", { days_left: 40 }),
  row("connection:anatomia", "unknown_expiry"),
  row("collection:auctra", "ok", { never_expires: true }),
  row("collection:auctra:flow", "unknown_expiry", { reason: "invalid_expiry" }),
  row("provider:sonora", "limited", { reason: "read_forbidden" }),
];
const now = Date.parse("2026-11-02T00:00:00Z");

describe("the credential a deep link names", () => {
  it("is the row whose slot id is exactly the link's ref, folded when it is among the healthy ones", () => {
    expect(credentialTarget(rows, "connection:eikona-main")).toEqual({ id: "connection:eikona-main", folded: false });
    expect(credentialTarget(rows, "open_tool:drivebridge")).toEqual({ id: "open_tool:drivebridge", folded: false });
    expect(credentialTarget(rows, "open_tool:gateway")).toEqual({ id: "open_tool:gateway", folded: true });
    expect(credentialTarget(rows, "connection:anatomia")).toEqual({ id: "connection:anatomia", folded: true });
    expect(credentialTarget(rows, "collection:auctra")).toEqual({ id: "collection:auctra", folded: true });
    // A recorded expiry that cannot be read, and a limited credential, are problems the panel lists first.
    expect(credentialTarget(rows, "collection:auctra:flow")).toEqual({ id: "collection:auctra:flow", folded: false });
    expect(credentialTarget(rows, "provider:sonora")).toEqual({ id: "provider:sonora", folded: false });
  });

  it("names nothing for a missing, unknown or near-miss ref, so the page opens as it always does", () => {
    for (const ref of [undefined, null, "", "open_tool", "open_tool:", "gateway", "open_tool:Gateway", " open_tool:gateway", "open_tool:gateway ", "open_tool:gatewa", "collection:auctra:", "connection:*", "../services", "<script>"]) {
      expect(credentialTarget(rows, ref), String(ref)).toBeNull();
    }
    expect(credentialTarget([], "open_tool:gateway")).toBeNull();
  });

  it("reads the slot back from the address the work queue builds with encodeURIComponent", () => {
    for (const slot of ["open_tool:gateway", "connection:fx-eikona", "collection:auctra:flow"]) {
      const ref = new URLSearchParams(`ref=${encodeURIComponent(slot)}`).get("ref");
      expect(ref).toBe(slot);
      expect(credentialTarget([row(slot, "ok")], ref)).toEqual({ id: slot, folded: true });
    }
    expect(new URLSearchParams("").get("ref")).toBeNull();
  });
});

describe("the credentials panel with a deep link", () => {
  const render = (focusRef?: string | null) => renderToStaticMarkup(createElement(CredentialsPanel, { rows, now, focusRef }));
  const linked = (html: string) => [...html.matchAll(/<li[^>]*data-credential-row="([^"]+)"[^>]*data-linked="true"/g)].map((match) => match[1]);
  const quietOpen = (html: string) => /<details[^>]*\bopen=""[^>]*data-credentials-quiet|<details[^>]*data-credentials-quiet[^>]*\bopen=""/.test(html);

  it("marks a problem row, makes it focusable, and leaves the healthy group folded", () => {
    const html = render("connection:eikona-main");
    expect(linked(html)).toEqual(["connection:eikona-main"]);
    expect(html).toMatch(/<li[^>]*tabindex="-1"[^>]*data-credential-row="connection:eikona-main"/);
    expect(quietOpen(html)).toBe(false);
  });

  it("opens the folded group at once when the row is one of the healthy ones", () => {
    const html = render("open_tool:gateway");
    expect(linked(html)).toEqual(["open_tool:gateway"]);
    expect(quietOpen(html)).toBe(true);
    // Only that row is marked and focusable.
    expect(html.match(/tabindex="-1"/g)).toHaveLength(1);
  });

  it("is the plain panel for no ref, an unknown slot or a near miss", () => {
    const plain = render();
    expect(linked(plain)).toEqual([]);
    expect(quietOpen(plain)).toBe(false);
    expect(plain).not.toContain('tabindex="-1"');
    for (const ref of [null, "", "open_tool:nope", "Open_Tool:Gateway"]) expect(render(ref), String(ref)).toBe(plain);
  });
});
