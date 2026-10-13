import { describe, expect, it } from "vitest";
import {
  csv,
  defaultQuery,
  filterFacts,
  initialFacts,
  inScope,
  memberChangeError,
  memberFixtures,
  statistics,
  ownerManagementAllowed,
  grantableRoles,
  type ManagementScope,
} from "../src/admin-state";
const scope: ManagementScope = {
  perspective: "team",
  tenant: "studio",
  team: "all",
  actor: "yeisme",
  env: "main",
  project: "all",
  role: "admin",
};
describe("management projections", () => {
  it("isolates same-named projects and people by tenant references", () => {
    const rows = initialFacts().filter((r) => inScope(scope, r));
    expect(rows.length).toBeGreaterThan(100);
    expect(rows.every((r) => r.tenant === "studio")).toBe(true);
    expect(
      initialFacts()
        .filter((r) => inScope({ ...scope, tenant: "north" }, r))
        .every((r) => r.project === "north-rain"),
    ).toBe(true);
  });
  it("personal scope only returns the explicit actor in the current tenant", () => {
    const rows = initialFacts().filter((r) =>
      inScope({ ...scope, perspective: "personal" }, r),
    );
    expect(rows.length).toBeGreaterThan(0);
    expect(
      rows.every((r) => r.actor === "yeisme" && r.tenant === "studio"),
    ).toBe(true);
    expect(
      inScope(
        { ...scope, perspective: "personal", tenant: "all" },
        initialFacts()[0],
      ),
    ).toBe(false);
  });
  it("combines environment, team and project constraints", () => {
    const rows = initialFacts().filter((r) =>
      inScope({ ...scope, team: "research", project: "research" }, r),
    );
    expect(rows.length).toBeGreaterThan(0);
    expect(
      rows.every(
        (r) =>
          r.team === "research" && r.project === "research" && r.env === "main",
      ),
    ).toBe(true);
  });
  it("deduplicates request identities and charge references independently", () => {
    const r = initialFacts().find((r) => r.costState === "confirmed")!;
    const s = statistics([r, r]);
    expect(s.requests).toBe(1);
    expect(s[r.currency]).toBe(r.amount);
    const x = statistics([r, { ...r, id: r.id + "-related" }]);
    expect(x.requests).toBe(2);
    expect(x[r.currency]).toBe(r.amount);
  });
  it("excludes running, unknown and cancelled from the success denominator", () => {
    const row = initialFacts()[0];
    const rows = ["succeeded", "failed", "unknown", "running", "cancelled"].map(
      (state, i) => ({ ...row, id: String(i), state }),
    );
    const s = statistics(rows);
    expect(s.rate).toBe(0.5);
    expect(s.denominator).toBe(2);
    expect(s.unknown).toBe(1);
    expect(statistics([]).rate).toBeNull();
  });
  it("counts attempts and outputs separately from gateway and generation tasks", () => {
    const r = initialFacts()[0];
    const s = statistics([
      { ...r, kind: "generation", attempts: 3, outputs: 4 },
      { ...r, id: "gateway", kind: "gateway", attempts: 1, outputs: 0 },
    ]);
    expect(s.generation).toBe(1);
    expect(s.gateway).toBe(1);
    expect(s.attempts).toBe(4);
    expect(s.outputs).toBe(4);
  });
  it("rejects invalid date windows instead of broadening the query", () => {
    expect(
      filterFacts(initialFacts(), {
        ...defaultQuery,
        days: "custom",
        from: "",
        to: "",
      }),
    ).toEqual([]);
    expect(
      filterFacts(initialFacts(), {
        ...defaultQuery,
        days: "custom",
        from: "2026-10-03",
        to: "2026-09-01",
      }),
    ).toEqual([]);
  });
  it("uses conjunctive owner, actor, status and time filters", () => {
    const rows = filterFacts(initialFacts(), {
      ...defaultQuery,
      owner: "eikona",
      state: "succeeded",
      actor: "lin",
      days: "30",
    });
    expect(
      rows.every(
        (r) =>
          r.owner === "eikona" && r.state === "succeeded" && r.actor === "lin",
      ),
    ).toBe(true);
  });
  it("does not interpret a blank or unknown cost as confirmed zero", () => {
    const r = initialFacts()[0];
    const s = statistics([
      { ...r, costState: "unknown", amount: null },
      {
        ...r,
        id: "pending",
        chargeRef: "other",
        costState: "pending",
        amount: null,
      },
    ]);
    expect(s.CNY).toBe(0);
    expect(s.unsettled).toBe(2);
  });
  it("protects owner and self memberships and rejects unsupported roles", () => {
    expect(
      memberChangeError(memberFixtures[0], "remove", "viewer", "yeisme"),
    ).toContain("自己");
    expect(
      memberChangeError(memberFixtures[1], "suspend", "viewer", "lin"),
    ).toContain("负责人");
    expect(
      memberChangeError(memberFixtures[2], "role", "tenant_admin", "yeisme"),
    ).toContain("支持的角色");
  });
  it("project drilldowns use references even when two tenants share a title", () => {
    const rows = filterFacts(initialFacts(), {
      ...defaultQuery,
      projectRef: "north-rain",
      days: "30",
    });
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.tenant === "north")).toBe(true);
  });
  it("platform role cannot replace owner authorization and tenant admins cannot grant billing", () => {
    expect(
      ownerManagementAllowed(
        { ...scope, tenant: "north" },
        memberFixtures,
        "yeitra",
        "north-production",
      ),
    ).toBe(false);
    const reduced = memberFixtures.map((m) =>
      m.id === "m-1" ? { ...m, role: "tenant_admin" } : m,
    );
    expect(
      grantableRoles(scope, reduced, "aigora", "research").some(
        (r) => r.id === "billing_admin",
      ),
    ).toBe(false);
  });
  it("CSV quotes delimiters and neutralizes spreadsheet formula prefixes", () => {
    const out = csv([["=RUN()", "a,b", 'a"b', "a\nb"]]);
    expect(out).toContain("'=RUN()");
    expect(out).toContain('"a,b"');
    expect(out).toContain('"a""b"');
  });
});
