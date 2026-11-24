import { describe, expect, it } from "vitest";
import { createApp } from "../server/app";
import { SessionAuth } from "../server/auth";
import { createMemoryDB } from "../server/db/client";
import type { ServerConfig, Session, ScopeBinding } from "../server/contracts";

const scope: ScopeBinding = { id: "scope-one", tenant: "tenant-one", team: "team", project: "project-one", label: "Project", owners: { eikona: { tenant: "tenant-one", project: "project-one", actor: "actor", audience: "eikona" }, sonora: { tenant: "tenant-one", project: "project-one", actor: "actor", audience: "sonora" }, scaena: { tenant: "tenant-one", project: "project-one", actor: "actor", audience: "scaena" } } };
const config: ServerConfig = { origin: "http://127.0.0.1:4482", port: 4482, owners: {}, principals: [{ issuer: "test", subject: "admin", name: "Admin", role: "admin", scopes: [scope] }] };
const session: Session = { id: "recipe-session", issuer: "test", subject: "admin", name: "Admin", accessToken: "", accessAudience: [], csrf: "csrf", epoch: 1, expires: Date.now() + 600_000 };

function fixture() {
  const db = createMemoryDB();
  const auth = new SessionAuth(config);
  auth.sessions.set(session.id, session);
  const app = createApp(config, { db, auth });
  const request = (path: string, method = "GET", body?: unknown) => new Request(config.origin + "/api/control-center/v1" + path, { method, headers: { Cookie: `yeisme_session=${session.id}`, Origin: config.origin, ...(method === "POST" ? { "X-CSRF-Token": session.csrf, "Content-Type": "application/json" } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  return { app, request };
}

async function createRecipe(f: ReturnType<typeof fixture>, overrides: Record<string, unknown> = {}) {
  const key = `recipe_${crypto.randomUUID().replaceAll("-", "")}`;
  const input = { owner: "eikona", project_ref: "project-one", title: "Rainy cover", kind: "image", tags: ["rain"], notes: "Reusable cover direction", visibility: "project", source: { source_kind: "owner_asset", owner_prompt_ref: "p_one", owner_version: 1, source_digest: "sha256:" + "a".repeat(64) }, facets: { schema_version: "yeisme.prompt_recipe_facets.v1", intent: "cover", field_sources: { intent: "user" } }, content_state: "readable", ...overrides };
  const previewResponse = await f.app(f.request("/actions/preview?scope=scope-one", "POST", { scope_id: "scope-one", owner: "control-center", target_kind: "prompt_recipe", target_ref: "new", action: "prompts.recipe.create", expected_revision: "0", idempotency_key: key, input }));
  expect(previewResponse.status).toBe(200);
  const preview = await previewResponse.json();
  const receiptResponse = await f.app(f.request("/actions/confirm?scope=scope-one", "POST", { scope_id: "scope-one", preview_ref: preview.preview_ref, preview_digest: preview.preview_digest, idempotency_key: key }));
  expect(receiptResponse.status).toBe(202);
  const receipt = await receiptResponse.json();
  expect(receipt.state).toBe("succeeded");
  return receipt.result_refs[0] as string;
}

describe("prompt recipe projection", () => {
  it("creates a refs-only recipe and lists it with provenance", async () => {
    const f = fixture();
    const recipe = await createRecipe(f);
    const response = await f.app(f.request("/prompt-recipes?scope=scope-one&owner=eikona"));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ schema_version: "yeisme.prompt_recipe.page.v1", total: 1, rows: [{ recipe_ref: recipe, source: { owner_prompt_ref: "p_one", source_digest: "sha256:" + "a".repeat(64) }, content_state: "readable" }] });
  });

  it("keeps revisions immutable and rejects stale edits", async () => {
    const f = fixture();
    const recipe = await createRecipe(f);
    const key = `recipe_${crypto.randomUUID().replaceAll("-", "")}`;
    const input = { owner: "eikona", project_ref: "project-one", title: "Rainy cover v2", kind: "image", tags: ["rain", "night"], notes: "Updated", visibility: "project", source: { source_kind: "owner_asset", owner_prompt_ref: "p_one", owner_version: 2, source_digest: "sha256:" + "b".repeat(64) }, facets: { schema_version: "yeisme.prompt_recipe_facets.v1", intent: "cover" }, content_state: "readable", expected_revision: 1 };
    const previewResponse = await f.app(f.request("/actions/preview?scope=scope-one", "POST", { scope_id: "scope-one", owner: "control-center", target_kind: "prompt_recipe", target_ref: recipe, action: "prompts.recipe.revise", expected_revision: "1", idempotency_key: key, input }));
    const preview = await previewResponse.json();
    expect((await f.app(f.request("/actions/confirm?scope=scope-one", "POST", { scope_id: "scope-one", preview_ref: preview.preview_ref, preview_digest: preview.preview_digest, idempotency_key: key })))).toHaveProperty("status", 202);
    const versions = await f.app(f.request(`/prompt-recipes/${recipe}/versions?scope=scope-one`));
    await expect(versions.json()).resolves.toMatchObject({ rows: [{ revision: 2 }, { revision: 1 }] });
    const stale = await f.app(f.request(`/prompt-recipes/${recipe}/use-preview?scope=scope-one`, "POST", { target_owner: "eikona", target_project_ref: "project-one", expected_revision: 1 }));
    await expect(stale.json()).resolves.toMatchObject({ availability: "blocked", blockers: ["prompt_recipe_revision_conflict"] });
  });

  it("blocks use when the recipe has no owner prompt reference or usable content", async () => {
    const f = fixture();
    const recipe = await createRecipe(f, { source: { source_kind: "manual" }, content_state: "metadata_only" });
    const response = await f.app(f.request(`/prompt-recipes/${recipe}/use-preview?scope=scope-one`, "POST", { target_owner: "eikona", target_project_ref: "project-one", expected_revision: 1 }));
    await expect(response.json()).resolves.toMatchObject({ availability: "blocked", blockers: expect.arrayContaining(["prompt_recipe_content_metadata_only", "prompt_recipe_source_ref_missing"]) });
  });

  it("keeps Scaena fail-closed until its prompt contract is published", async () => {
    const f = fixture();
    const recipe = await createRecipe(f, { owner: "scaena", kind: "video", source: { source_kind: "owner_asset", owner_prompt_ref: "scaena-prompt", owner_version: 1, source_digest: "sha256:" + "c".repeat(64) } });
    const response = await f.app(f.request(`/prompt-recipes/${recipe}/use-preview?scope=scope-one`, "POST", { target_owner: "scaena", target_project_ref: "project-one", expected_revision: 1 }));
    await expect(response.json()).resolves.toMatchObject({ availability: "needs_contract", blockers: expect.arrayContaining(["owner_prompt_contract_missing"]) });
  });

  it("rejects an owner project outside the active scope before writing", async () => {
    const f = fixture();
    const response = await f.app(f.request("/actions/preview?scope=scope-one", "POST", { scope_id: "scope-one", owner: "control-center", target_kind: "prompt_recipe", target_ref: "new", action: "prompts.recipe.create", expected_revision: "0", idempotency_key: `recipe_${crypto.randomUUID().replaceAll("-", "")}`, input: { owner: "eikona", project_ref: "foreign-project", title: "Foreign", kind: "image", source: { source_kind: "manual" }, content_state: "metadata_only" } }));
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ error: "scope_mismatch" });
    await expect((await f.app(f.request("/prompt-recipes?scope=scope-one"))).json()).resolves.toMatchObject({ total: 0 });
  });

  it("archives atomically, records the terminal revision, and replays the receipt", async () => {
    const f = fixture();
    const recipe = await createRecipe(f);
    const key = `recipe_${crypto.randomUUID().replaceAll("-", "")}`;
    const previewResponse = await f.app(f.request("/actions/preview?scope=scope-one", "POST", { scope_id: "scope-one", owner: "control-center", target_kind: "prompt_recipe", target_ref: recipe, action: "prompts.recipe.archive", expected_revision: "1", idempotency_key: key, input: { expected_revision: 1 } }));
    const preview = await previewResponse.json();
    const body = { scope_id: "scope-one", preview_ref: preview.preview_ref, preview_digest: preview.preview_digest, idempotency_key: key };
    const first = await f.app(f.request("/actions/confirm?scope=scope-one", "POST", body));
    const second = await f.app(f.request("/actions/confirm?scope=scope-one", "POST", body));
    expect(first.status).toBe(202);
    expect(second.status).toBe(202);
    const firstReceipt = await first.json();
    expect(await second.json()).toMatchObject({ receipt_ref: firstReceipt.receipt_ref, state: "succeeded" });
    await expect((await f.app(f.request(`/prompt-recipes/${recipe}?scope=scope-one`))).json()).resolves.toMatchObject({ recipe: { state: "archived", revision: 2 } });
    await expect((await f.app(f.request(`/prompt-recipes/${recipe}/versions?scope=scope-one`))).json()).resolves.toMatchObject({ rows: [{ revision: 2 }, { revision: 1 }] });
  });

  it("validates recipe filters before touching the local index", async () => {
    const f = fixture();
    const response = await f.app(f.request("/prompt-recipes?scope=scope-one&limit=101"));
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: "invalid_prompt_recipe_query" });
  });

  it("does not accept a prompt body in a recipe action", async () => {
    const f = fixture();
    const response = await f.app(f.request("/actions/preview?scope=scope-one", "POST", { scope_id: "scope-one", owner: "control-center", target_kind: "prompt_recipe", target_ref: "new", action: "prompts.recipe.create", expected_revision: "0", idempotency_key: `recipe_${crypto.randomUUID().replaceAll("-", "")}`, input: { owner: "eikona", project_ref: "project-one", title: "No body", kind: "image", text: "secret prompt body", source: { source_kind: "manual" }, content_state: "metadata_only" } }));
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: "invalid_action_input" });
  });
});
