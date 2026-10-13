import { describe, expect, it } from "vitest";
import {
  actionFor,
  canWrite,
  confirmedTotals,
  launchContext,
  mutateOperation,
  scopedOperations,
  uniqueCharges,
  validateConnection,
  charges,
} from "../src/domain";
import { initialOperations } from "../src/data";

describe("owner-preserving prototype contracts", () => {
  it("recovers unknown results without changing identity or attempt", () => {
    const original = initialOperations[0],
      result = mutateOperation(original, "reconcile");
    expect(result.id).toBe(original.id);
    expect(result.attempt).toBe(1);
    expect(result.state).toBe("waiting_review");
    expect(original.state).toBe("unknown");
  });
  it("never permits retry for unknown or rights-blocked work", () => {
    expect(actionFor(initialOperations[0])).toBe("reconcile");
    expect(actionFor(initialOperations[1])).toBe(null);
  });
  it("keeps invalid transitions unchanged", () =>
    expect(mutateOperation(initialOperations[0], "cancel")).toBe(
      initialOperations[0],
    ));
  it("isolates projects and environments", () => {
    expect(
      scopedOperations(initialOperations, "staging", "all", "normal"),
    ).toEqual([]);
    expect(
      scopedOperations(initialOperations, "main", "coast", "normal").every(
        (x) => x.project === "coast",
      ),
    ).toBe(true);
    expect(
      scopedOperations(initialOperations, "main", "rain", "empty"),
    ).toEqual([]);
  });
  it("intersects role, scope availability and management permission", () => {
    expect(canWrite("viewer", "normal")).toBe(false);
    expect(canWrite("operator", "normal", true)).toBe(false);
    for (const scenario of ["offline", "auth", "permission"] as const)
      expect(canWrite("admin", scenario, true)).toBe(false);
    expect(canWrite("operator", "normal")).toBe(true);
  });
  it("only accepts connection and credential references", () => {
    expect(
      validateConnection(
        "connection://lan/eikona",
        "credentialctl://team/eikona",
      ),
    ).toBe("");
    expect(
      validateConnection(
        "https://arbitrary.invalid",
        "credentialctl://team/eikona",
      ),
    ).not.toBe("");
    expect(
      validateConnection("connection://lan/eikona", "not-a-reference"),
    ).not.toBe("");
  });
  it("deduplicates bills using the original source and separates currencies", () => {
    expect(uniqueCharges(charges)).toHaveLength(5);
    expect(uniqueCharges(charges)[0].owner).toBe("eikona");
    expect(confirmedTotals(charges)).toEqual({ CNY: 1.28, USD: 0.08 });
  });
  it("does not promote estimates or unknown bills to confirmed costs", () =>
    expect(
      confirmedTotals(charges.filter((c) => c.state !== "confirmed")),
    ).toEqual({ CNY: 0, USD: 0 }));
  it("preserves external references without creating an owner binding", () => {
    const ctx = launchContext(
      "#/tasks?source=frame&source_project=original&source_task=task-8&source_shot=shot-2",
    );
    expect(ctx.sourceTask).toBe("task-8");
    expect(ctx.sourceProject).toBe("original");
    expect(ctx.project).toBe("all");
  });
  it("limits route, project and return context", () => {
    const ctx = launchContext(
      "#/unknown?project=unauthorized&return_page=https://bad.invalid&source_task=%3Cscript%3E",
    );
    expect(ctx.page).toBe("overview");
    expect(ctx.project).toBe("all");
    expect(ctx.returnPage).toBe("tasks");
    expect(ctx.sourceTask).toBe("");
  });
});
