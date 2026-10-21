import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { AuthError } from "../../server/auth";
import { errorClass } from "../../server/app";
import { safeProjection } from "../../server/owners";
import { safeTask } from "../../server/task-connections";
import { summarizeRequests, matchesRequest, defaultRequestQuery, type RequestProjection, type Coverage } from "../../src/request-visibility";
import type { TaskConnection } from "../../server/contracts";

const fixture = (name: string) =>
  JSON.parse(
    readFileSync(
      resolve(__dirname, "../fixtures/contract", name),
      "utf8",
    ),
  ) as unknown;

const binding = {
  tenant: "tenant-a",
  project: "project-1",
  actor: "user-1",
  audience: "aud-eikona",
};

describe("frozen contract samples", () => {
  it("projects a raw owner row exactly as the frozen page sample shows", () => {
    const page = fixture("requests-page.partial.json") as {
      rows: RequestProjection[];
      coverage: Coverage[];
      epoch: number;
    };
    const projection = safeProjection(page.rows[0], "eikona", binding);
    expect(projection.id).toBe(page.rows[0].id);
    expect(projection.submitted).toEqual(page.rows[0].submitted);
    expect(page.epoch).toBe(1);
    expect(page.coverage.map((c) => c.state)).toEqual([
      "complete",
      "unavailable",
    ]);
  });

  it("keeps a partial page out of summary totals and preserves nulls", () => {
    const page = fixture("requests-page.partial.json") as {
      rows: RequestProjection[];
      coverage: Coverage[];
    };
    const q = defaultRequestQuery(new Date("2026-10-12T08:00:00Z"));
    q.from = "2026-10-11T08:00:00Z";
    expect(matchesRequest(page.rows[0], q)).toBe(true);
    const summary = summarizeRequests(page.rows, q.from, q.to, page.coverage);
    expect(summary.generation.state).toBe("partial");
    // An empty upload list is a true zero; absence of uploads is never "unknown".
    expect(summary.uploaded_files.value).toBe(0);
    expect(summary.uploaded_bytes.value).toBe(0);
    expect(summary.outputs.state).toBe("partial");
  });

  it("keeps unknown progress unknown in the task snapshot sample", () => {
    const snapshot = fixture("task-snapshot.unknown-progress.json") as Record<
      string,
      unknown
    >;
    const connection: TaskConnection = {
      id: "c1",
      owner: "scaena",
      instance_id: "scaena-main",
      label: "Scaena main",
      environment: "production",
      endpoint: "https://scaena.example",
      credential_ref: "/dev/null",
      project: "project-1",
      enabled: true,
      allow_content: true,
      allow_cancel: true,
    };
    const projected = safeTask(
      {
        ...snapshot,
        locator: {
          ...(snapshot.locator as Record<string, unknown>),
          task_family: "delegation",
        },
      },
      connection,
    );
    expect(projected.progress.total).toBeNull();
    expect(projected.progress.percent).toBeNull();
    expect(projected.results[0].bytes).toBeNull();
    expect(projected.coverage).toBe("partial");
  });

  it("maps every frozen error sample onto its contract class", () => {
    const samples = (fixture("content-and-errors.json") as {
      errors: Record<string, { error: string; class: string }>;
    }).errors;
    const statusFor: Record<string, number> = {
      forbidden: 403,
      conflict: 409,
      revision_conflict: 409,
      unavailable: 503,
      login: 401,
      needs_contract: 422,
      rate_limited: 429,
      expired_handle: 410,
      audit_first: 503,
    };
    for (const [key, sample] of Object.entries(samples)) {
      const mapped = errorClass(
        new AuthError(sample.error, statusFor[key]),
      );
      expect(mapped, key).toBe(sample.class);
    }
  });
});
