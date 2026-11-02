import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { serviceDefinitions, type ServiceDirectoryEntry } from "../src/service-directory";
import { directoryView, filterDirectory, isUnintegrated, readFlag, toggleFlag, unintegratedCount, unintegratedOpenKey, useUnintegratedOpen, writeFlag, type FlagStorage } from "../src/pages/services/directory-groups";
import { ServiceDirectoryPanel, UnintegratedGroup } from "../src/pages/services/ServiceDirectory";
import { needsContractLabel } from "../src/shared/read-model/labels";

// What the server builds for a scope with no connections: registered-only entries "need a contract", integrated ones are "not configured".
const entry = (id: string, patch: Partial<ServiceDirectoryEntry> = {}): ServiceDirectoryEntry => {
  const definition = serviceDefinitions.find((item) => item.id === id)!;
  return { ...definition, connections: [], configuration: definition.integration === "not_integrated" ? "needs_contract" : "not_configured", observation: "not_checked", ...patch };
};
const directory = (patch: Record<string, Partial<ServiceDirectoryEntry>> = {}) => serviceDefinitions.map((definition) => entry(definition.id, patch[definition.id]));
const ids = (rows: { id: string }[]) => rows.map((row) => row.id);

describe("directory groups", () => {
  it("folds every registered-only entry and keeps integrated ones, in directory order", () => {
    const view = directoryView(directory(), "all", "");
    expect(view.listed).toHaveLength(8);
    expect(view.unintegrated).toHaveLength(17);
    expect(view.unintegratedTotal).toBe(17);
    expect(ids(view.listed)).toEqual(["scaena", "eikona", "sonora", "gateway", "aigora", "drivebridge", "auctra", "anatomia"]);
    expect(ids(view.unintegrated).slice(0, 3)).toEqual(["pinax", "capsa", "manju"]);
    expect(ids([...view.listed, ...view.unintegrated]).sort()).toEqual(serviceDefinitions.map((definition) => definition.id).sort());
  });

  it("keeps a registered-only entry that someone configured in the main list, where its problem is seen", () => {
    expect(isUnintegrated(entry("pinax"))).toBe(true);
    expect(isUnintegrated(entry("pinax", { configuration: "not_configured" }))).toBe(true);
    expect(isUnintegrated(entry("pinax", { configuration: "configured" }))).toBe(false);
    expect(isUnintegrated(entry("scaena"))).toBe(false);
    const view = directoryView(directory({ pinax: { configuration: "configured" } }), "all", "");
    expect(ids(view.listed)).toContain("pinax");
    expect(view.unintegrated).toHaveLength(16);
    expect(view.unintegratedTotal).toBe(16);
  });

  it("filters as before: integrated, configured and gaps, and a search over name, purpose, path and gap", () => {
    const rows = directory({ scaena: { configuration: "configured" }, eikona: { configuration: "configured" } });
    expect(ids(filterDirectory(rows, "integrated", ""))).toEqual(["scaena", "eikona", "sonora", "gateway", "aigora", "drivebridge", "auctra", "anatomia"]);
    expect(ids(filterDirectory(rows, "configured", ""))).toEqual(["scaena", "eikona"]);
    const gaps = ids(filterDirectory(rows, "gaps", ""));
    expect(gaps).not.toContain("scaena");
    expect(gaps).toContain("sonora");
    expect(gaps).toContain("pinax");
    expect(gaps).toHaveLength(23);
    expect(ids(filterDirectory(rows, "all", "  PINAX "))).toEqual(["pinax"]);
    expect(ids(filterDirectory(rows, "all", "backend-server/capsa"))).toEqual(["capsa"]);
    expect(ids(filterDirectory(rows, "all", "不解密用户内容"))).toEqual(["capsa"]);
    expect(filterDirectory(rows, "all", "no such service")).toEqual([]);
  });

  it("keeps the group's total while a filter narrows it, and asks for the matches to be shown at once", () => {
    const rows = directory();
    expect(directoryView(rows, "all", "").narrowed).toBe(false);
    expect(directoryView(rows, "integrated", "").narrowed).toBe(false);
    expect(directoryView(rows, "configured", "").narrowed).toBe(false);
    expect(directoryView(rows, "gaps", "").narrowed).toBe(true);
    const searched = directoryView(rows, "all", "open design");
    expect(searched.narrowed).toBe(true);
    expect(ids(searched.unintegrated)).toEqual(["opendesign"]);
    expect(searched.unintegratedTotal).toBe(17);
    expect(directoryView(rows, "all", "   ").narrowed).toBe(false);
    // The integrated filter leaves nothing for the group to show.
    expect(directoryView(rows, "integrated", "").unintegrated).toEqual([]);
  });

  it("counts the group in its heading", () => {
    expect(unintegratedCount(17, 17)).toBe("17 项");
    expect(unintegratedCount(3, 17)).toBe("3 / 17 项");
  });
});

describe("the remembered open state", () => {
  const memory = (initial: Record<string, string> = {}) => {
    const data = new Map(Object.entries(initial));
    return { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => void data.set(key, value), data };
  };

  it("is closed until it was opened, and reads back what was written", () => {
    const storage = memory();
    expect(readFlag(storage, unintegratedOpenKey)).toBe(false);
    writeFlag(storage, unintegratedOpenKey, true);
    expect(storage.data.get(unintegratedOpenKey)).toBe("1");
    expect(readFlag(storage, unintegratedOpenKey)).toBe(true);
    writeFlag(storage, unintegratedOpenKey, false);
    expect(storage.data.get(unintegratedOpenKey)).toBe("0");
    expect(readFlag(storage, unintegratedOpenKey)).toBe(false);
    // Anything other than the value this page wrote counts as closed.
    expect(readFlag(memory({ [unintegratedOpenKey]: "true" }), unintegratedOpenKey)).toBe(false);
  });

  it("falls back to closed when storage is missing or throws, and never throws itself", () => {
    const blocked = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("full"); } };
    expect(readFlag(undefined, unintegratedOpenKey)).toBe(false);
    expect(readFlag(blocked, unintegratedOpenKey)).toBe(false);
    expect(() => writeFlag(blocked, unintegratedOpenKey, true)).not.toThrow();
    expect(() => writeFlag(undefined, unintegratedOpenKey, true)).not.toThrow();
  });

  it("uses a key of its own in the control center's namespace", () => {
    expect(unintegratedOpenKey).toBe("yeisme.control.services.unintegrated-open");
  });

  it("flips the choice, writes the new value and returns it, whatever the storage does", () => {
    const storage = memory();
    expect(toggleFlag(storage, unintegratedOpenKey, false)).toBe(true);
    expect(storage.data.get(unintegratedOpenKey)).toBe("1");
    expect(toggleFlag(storage, unintegratedOpenKey, true)).toBe(false);
    expect(storage.data.get(unintegratedOpenKey)).toBe("0");
    // A storage that cannot be written still lets the group open and close for this visit.
    const blocked = { getItem: () => null, setItem: () => { throw new Error("full"); } };
    expect(toggleFlag(blocked, unintegratedOpenKey, false)).toBe(true);
    expect(toggleFlag(undefined, unintegratedOpenKey, true)).toBe(false);
  });

  /** Renders a component that calls the hook, and hands back what the hook gave it. */
  const probe = (storage: FlagStorage | undefined) => {
    let seen: [boolean, () => void] = [false, () => undefined];
    const Probe = () => { seen = useUnintegratedOpen(storage); return null; };
    renderToStaticMarkup(createElement(Probe));
    return seen;
  };

  it("starts from what the browser remembered, and the toggle it returns writes the new choice", () => {
    const empty = memory();
    const [closed, toggle] = probe(empty);
    expect(closed).toBe(false);
    // A server render cannot re-render after the call; what is under test is the write that comes with it.
    try { toggle(); } catch { /* nothing to re-render */ }
    expect(empty.data.get(unintegratedOpenKey)).toBe("1");
    const [open, toggleOpen] = probe(memory({ [unintegratedOpenKey]: "1" }));
    expect(open).toBe(true);
    const remembered = memory({ [unintegratedOpenKey]: "1" });
    const [, close] = probe(remembered);
    try { close(); } catch { /* nothing to re-render */ }
    expect(remembered.data.get(unintegratedOpenKey)).toBe("0");
    expect(typeof toggleOpen).toBe("function");
    expect(probe(undefined)[0]).toBe(false);
    expect(probe({ getItem: () => { throw new Error("blocked"); }, setItem: () => undefined })[0]).toBe(false);
  });
});

describe("the directory panel", () => {
  const rows = directory();
  const render = (props: Partial<Parameters<typeof UnintegratedGroup>[0]> = {}) => renderToStaticMarkup(createElement(UnintegratedGroup, { rows: rows.filter(isUnintegrated), total: 17, open: false, forced: false, onToggle: () => undefined, ...props }));

  it("lists the integrated entries and shows the registered-only ones as a closed disclosure", () => {
    const html = renderToStaticMarkup(createElement(ServiceDirectoryPanel, { services: rows }));
    expect(html).toContain('aria-label="服务目录列表"');
    expect(html).toContain("Scaena");
    expect(html).toContain('aria-label="未接入的服务列表"');
    // Closed: the button says so, and the table sits in a hidden panel that the button controls.
    const button = html.match(/<button[^>]*aria-expanded="false"[^>]*aria-controls="([^"]+)"/);
    expect(button).not.toBeNull();
    expect(html).toContain(`id="${button![1]}" hidden=""`);
    expect(html).toContain("未接入");
    expect(html).toContain("17 项");
    // The group's heading says it is not integrated, so its rows have no status column and no pill that repeats it.
    const group = html.slice(html.indexOf('data-directory-group="unintegrated"'));
    expect(group).not.toContain(">状态<");
    expect(group).not.toContain("类型 · 接入");
    expect(group).not.toContain(needsContractLabel);
    // The main list keeps them.
    expect(html.slice(0, html.indexOf('data-directory-group="unintegrated"'))).toContain(">状态<");
  });

  it("opens the group at once when the browser remembered it open, and not otherwise", () => {
    const remembered = renderToStaticMarkup(createElement(ServiceDirectoryPanel, { services: rows, storage: { getItem: (key: string) => key === unintegratedOpenKey ? "1" : null, setItem: () => undefined } }));
    expect(remembered).toMatch(/aria-expanded="true"/);
    expect(remembered).toContain('data-expanded="true"');
    expect(remembered).not.toMatch(/id="[^"]+" hidden=""/);
    const forgotten = renderToStaticMarkup(createElement(ServiceDirectoryPanel, { services: rows, storage: { getItem: () => "0", setItem: () => undefined } }));
    expect(forgotten).toMatch(/aria-expanded="false"/);
    expect(forgotten).toMatch(/id="[^"]+" hidden=""/);
  });

  it("names the group in a heading, with the count", () => {
    const html = render();
    expect(html).toMatch(/<h3[^>]*><button[^>]*aria-expanded="false"/);
    expect(html).toMatch(/未接入<span[^>]*>17 项<\/span>/);
  });

  it("opens when it was remembered open, and the button says so", () => {
    const html = render({ open: true });
    expect(html).toContain('aria-expanded="true"');
    expect(html).not.toMatch(/id="[^"]+" hidden=""/);
    expect(html).toContain('data-expanded="true"');
  });

  it("lists matches plainly, with no button to close them, while a search or 缺口 asks for them", () => {
    const html = render({ rows: rows.filter((row) => row.id === "pinax"), forced: true });
    expect(html).not.toContain("<button");
    expect(html).not.toContain("aria-expanded");
    expect(html).not.toMatch(/ hidden=""/);
    expect(html).toContain("1 / 17 项");
    expect(html).toContain("Pinax");
    expect(html).toContain('data-expanded="true"');
  });

  it("says when nothing matches instead of showing an empty group", () => {
    // A directory of integrated entries only: the group is not drawn at all.
    const integratedOnly = renderToStaticMarkup(createElement(ServiceDirectoryPanel, { services: rows.filter((row) => !isUnintegrated(row)) }));
    expect(integratedOnly).not.toContain("data-directory-group");
    expect(integratedOnly).toContain('aria-label="服务目录列表"');
    const none = renderToStaticMarkup(createElement(ServiceDirectoryPanel, { services: [] }));
    expect(none).toContain("没有匹配的服务");
    expect(none).not.toContain("data-directory-group");
  });
});
