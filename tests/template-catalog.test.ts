import { describe, expect, it } from "vitest";
import {
  normalizeTemplateCatalog,
  normalizeTemplateCatalogError,
  templateGoalCells,
} from "../src/shared/template-catalog";
import type { TemplateCatalogError } from "../src/shared/template-catalog";

function item() {
  return {
    ref: "owner:promptrepo:release/rel_123",
    template_kind: "prompt",
    title: "短剧冲突参考",
    package_id: "drama.conflict",
    version: 1,
    version_ref: "1.2.0",
    digest: "sha256:abcdef0123456789",
    release_state: "published",
    source_owner: "promptrepo",
    preview: { kind: "text", body: "none" },
  };
}

function catalog() {
  return {
    schema_version: 1,
    contract_version: "template-registry.catalog.v1",
    revision: 42,
    observed_at: "2026-06-01T12:30:45.123456789Z",
    items: [item()],
    total_known: 1,
  };
}

function ready(input: unknown) {
  const result = normalizeTemplateCatalog(input);
  expect(result.availability).toBe("ready");
  if (result.availability !== "ready") throw new Error("Expected safe catalog");
  return result.catalog;
}

const cursor = (offset: number, revision = 42) => btoa(`${offset}:${revision}`).replace(/=+$/, "");

describe("body-free template catalog", () => {
  it("projects the real v1 list wire without mutating it", () => {
    const input = catalog();
    const before = JSON.stringify(input);
    const result = ready(input);
    expect(result).toEqual({
      schema_version: 1,
      contract_version: "template-registry.catalog.v1",
      revision: 42,
      observed_at: input.observed_at,
      total_known: 1,
      items: [{ ...item(), preview: { body: "none" }, maturity: "unknown", rights: "unknown", executable: false }],
    });
    expect(JSON.stringify(input)).toBe(before);
    expect(result.items[0]).not.toBe(input.items[0]);
  });

  it("accepts an explicitly empty catalog, not a missing catalog", () => {
    expect(ready({ ...catalog(), items: [], total_known: 0 }).items).toEqual([]);
    expect(normalizeTemplateCatalog({})).toEqual({ availability: "needs_contract" });
  });

  it("supports a public UI template reference and a valid paginated response", () => {
    const result = ready({
      ...catalog(),
      items: [{ ...item(), ref: "owner:promptrepo:ui/uirel_123", template_kind: "ui_template" }],
      total_known: 3,
      next_cursor: cursor(1),
    });
    expect(result.next_cursor).toBe(cursor(1));
    expect(result.items[0]?.template_kind).toBe("ui_template");
  });

  it.each(["private prompt", "", null, { text: "private prompt" }, ["private prompt"], 0])(
    "rejects any preview.body other than none without retaining the payload (%j)",
    (body) => {
      const result = normalizeTemplateCatalog({
        ...catalog(), items: [{ ...item(), preview: { body } }],
      });
      expect(result).toEqual({ availability: "body_forbidden" });
      expect(JSON.stringify(result)).not.toContain("private prompt");
    },
  );

  it("still rejects a forbidden body when another item or the envelope is invalid", () => {
    expect(normalizeTemplateCatalog({
      ...catalog(), schema_version: 9, items: [null, { preview: { body: "secret" } }],
    })).toEqual({ availability: "body_forbidden" });
  });

  it("drops unknown fields, body containers, URLs, private paths and owner messages", () => {
    const result = ready({
      ...catalog(),
      owner_url: "https://owner.invalid/private",
      private_path: "/srv/private",
      body: "top-level secret",
      degraded_owners: [{ owner: "promptrepo", reason: "private owner exception", endpoint: "https://owner.invalid" }],
      items: [{
        ...item(),
        owner_refs: [{ url: "https://owner.invalid/private" }],
        source_url: "https://owner.invalid/private",
        private_path: "/srv/private",
        body: "item secret",
        maturity: "production",
        rights: "authorized",
        allowed_actions: [{ action: "execute" }],
        preview: { body: "none", html: "secret html", slots: [{ default: "secret slot" }] },
      }],
    });
    expect(result.degraded_owners).toEqual([{ owner: "promptrepo" }]);
    expect(result.items[0]?.preview).toEqual({ body: "none" });
    const serialized = JSON.stringify(result);
    for (const secret of ["https://", "/srv/", "secret", "private owner", "authorized", "production", "allowed_actions"])
      expect(serialized).not.toContain(secret);
  });

  it.each([
    { schema_version: 2 }, { schema_version: "1" },
    { contract_version: "template-registry.catalog.v2" }, { contract_version: undefined },
    { total_known: undefined }, { total_known: "1" }, { total_known: -1 }, { total_known: 0 },
    { total_known: 1.5 }, { total_known: Number.MAX_SAFE_INTEGER + 1 },
    { revision: undefined }, { revision: -1 }, { revision: 1.1 }, { revision: "42" },
    { revision: Number.MAX_SAFE_INTEGER + 1 },
    { observed_at: "yesterday" }, { observed_at: "2026-02-30T00:00:00Z" },
    { observed_at: "2026-06-01" }, { observed_at: "2026-06-01T24:00:00Z" },
    { observed_at: undefined }, { items: null }, { items: [null] },
    { degraded_owners: [{ owner: "promptrepo" }] }, { degraded_owners: "error" },
    { degraded_owners: [{ owner: "https://private.invalid", reason: "error" }] },
  ])("fails closed for malformed list metadata: %j", (patch) => {
    expect(normalizeTemplateCatalog({ ...catalog(), ...patch })).toEqual({ availability: "needs_contract" });
  });

  it.each([null, undefined, [], "bad", 0])("rejects a non-object response: %j", (input) => {
    expect(normalizeTemplateCatalog(input)).toEqual({ availability: "needs_contract" });
  });

  it("does not replace a missing count with zero or retain partial valid items", () => {
    const { total_known: _count, ...missingCount } = catalog();
    expect(normalizeTemplateCatalog(missingCount)).toEqual({ availability: "needs_contract" });
    expect(normalizeTemplateCatalog({ ...catalog(), items: [item(), {}], total_known: 2 }))
      .toEqual({ availability: "needs_contract" });
  });

  it.each([
    { ref: "https://owner.invalid/release/1" }, { ref: "/private/release" },
    { ref: "owner:other:release/rel_123" }, { ref: "owner:promptrepo:release/../private" },
    { ref: "owner:promptrepo:release/" }, { source_owner: "https://owner.invalid" },
    { title: "/srv/private" }, { title: "https://owner.invalid" },
    { package_id: "../private" }, { version: 0 }, { version_ref: undefined },
    { digest: undefined }, { release_state: undefined }, { preview: {} },
  ])("rejects malformed item/reference metadata: %j", (patch) => {
    expect(normalizeTemplateCatalog({ ...catalog(), items: [{ ...item(), ...patch }] }))
      .toEqual({ availability: "needs_contract" });
  });

  it("rejects duplicate references", () => {
    expect(normalizeTemplateCatalog({ ...catalog(), total_known: 2, items: [item(), item()] }))
      .toEqual({ availability: "needs_contract" });
  });

  it.each(["", null, "\u0000token", "\u001f", "\u007f", "a".repeat(257)])(
    "rejects empty, control-character or overlong opaque cursors: %j", (next_cursor) => {
      expect(normalizeTemplateCatalog({ ...catalog(), next_cursor }))
        .toEqual({ availability: "needs_contract" });
    },
  );

  it.each(["not-a-cursor", cursor(1, 43), cursor(0), cursor(3), cursor(4), "MTox=="])(
    "accepts opaque cursor tokens without decoding or interpreting them: %j", (next_cursor) => {
      expect(ready({ ...catalog(), next_cursor }).next_cursor).toBe(next_cursor);
    },
  );

  it("never infers maturity or rights from publication", () => {
    const result = ready(catalog());
    expect(result.items[0]).toMatchObject({
      release_state: "published", maturity: "unknown", rights: "unknown", executable: false,
    });
  });

  it.each([
    [{ status: 409, code: "conflict" }, "stale"],
    [{ status: 409, code: "cursor_conflict" }, "stale"],
    [{ status: 409, code: "stale_cursor" }, "stale"],
    [{ status: 409, code: "release_unavailable" }, "unavailable"],
    [{ status: 409 }, "needs_contract"],
    [{ status: 409, code: "owner_private_detail" }, "needs_contract"],
    [{ status: 403 }, "forbidden"], [{ status: 404 }, "needs_contract"],
    [{ status: 405 }, "needs_contract"], [{ status: 400 }, "unavailable"],
    [{ status: 401 }, "unavailable"], [{ status: 429 }, "unavailable"],
    [{ status: 500 }, "unavailable"], [{ status: 0 }, "unavailable"],
  ] as const)("maps typed status/code to safe availability without owner error details: %j", (error, availability) => {
    const withOwnerDetails: TemplateCatalogError & { message: string; owner_url: string } = {
      ...error, message: "private owner error", owner_url: "https://private.invalid",
    };
    expect(normalizeTemplateCatalogError(withOwnerDetails)).toEqual({ availability });
  });
});

describe("three reference-only goal cells", () => {
  it("keeps maturity separate from availability and never enables execution", () => {
    expect(templateGoalCells).toHaveLength(3);
    expect(templateGoalCells.map((cell) => cell.id)).toEqual([
      "drama-30-60s-experiment", "drama-single-scene-conflict", "drama-character-consistency-demo",
    ]);
    expect(templateGoalCells[0].maturity).toBe("exploratory");
    for (const cell of templateGoalCells) {
      expect(cell.catalogAvailability).toBe("needs_contract");
      expect(cell.maturity).not.toBe("needs_contract");
      expect(cell.rights).toBe("unknown");
      expect(cell.plan.referenceOnly).toBe(true);
      expect(cell.plan.executable).toBe(false);
      expect(Object.keys(cell.plan).sort()).toEqual(["description", "executable", "referenceOnly"]);
      expect(cell.plan.description).toContain("仅供参考");
    }
  });

  it("does not promote cells when a catalog is ready or a release is published", () => {
    ready(catalog());
    expect(templateGoalCells.every((cell) => cell.catalogAvailability === "needs_contract" && !cell.plan.executable)).toBe(true);
  });
});
