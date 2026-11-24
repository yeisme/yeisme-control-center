import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { createApp } from "../server/app";
import { SessionAuth } from "../server/auth";
import { OwnerReaders } from "../server/owners";
import { createMemoryDB } from "../server/db/client";
import { SessionStore } from "../server/db/session-store";
import { actionRecords, auditEvents } from "../server/db/schema";
import type { ServerConfig, Session } from "../server/contracts";
import { promptOwners, type PromptSummary } from "../src/shared/prompt-library";
import { ownerFetch } from "./contract/mock-owner";

const body = "synthetic-prompt-library-body";
const digest = "sha256:" + createHash("sha256").update(body).digest("hex");
const row = (owner: typeof promptOwners[number]): PromptSummary => ({ id: "p_one", owner, project: "project-one", title: "Fixture material", kind: owner === "eikona" ? "image" : owner === "scaena" ? "video" : "music", source: "manual", version: 1, digest, tags: ["test"], archived: false, readable: true, created_at: "2026-11-03T00:00:00Z", updated_at: "2026-11-03T00:00:00Z" });
function fixture(options: { forbidden?: string; wrongProject?: boolean; badBody?: boolean; role?: "admin" | "viewer"; interruptSave?: boolean } = {}) {
 const db = createMemoryDB();
 const scope = { id: "scope-one", tenant: "tenant-one", project: "project-one", team: "team", label: "Fixture", owners: Object.fromEntries(promptOwners.map(owner => [owner, { tenant: "tenant-one", project: "project-one", actor: "actor", audience: owner }])) };
 const config: ServerConfig = { origin: "http://127.0.0.1:4450", port: 4450, owners: Object.fromEntries(promptOwners.map((owner,i) => [owner, { origin: `http://127.0.0.1:${4460+i}`, audience: owner }])), principals: [{ issuer: "https://id.example", subject: "one", name: "One", role: options.role || "admin", scopes: [scope] }] };
 const session: Session = { id: "prompt-session", issuer: "https://id.example", subject: "one", name: "One", accessToken: "synthetic-delegation", accessAudience: [...promptOwners], csrf: "csrf", epoch: 1, expires: Date.now()+600000 };
 const auth = new SessionAuth(config, undefined, new SessionStore(db)); auth.sessions.set(session.id, session);
 let mutations = 0;
 const transport = ownerFetch((url, init) => {
  const owner = promptOwners[Number(url.port)-4460];
  if (owner === options.forbidden) return Response.json({ error: "forbidden" }, { status: 403 });
  if(owner==="scaena" && url.searchParams.has("project_id"))return Response.json({error:"invalid_query"},{status:400});
  const summary = { ...row(owner), ...(options.wrongProject ? {project: "other"} : {}) };
  let result: unknown;
  if (url.pathname.includes("/operations/")) result = {state:"complete",summary};
  else if (url.pathname.endsWith("content:read")) result = { schema_version: "yeisme.prompt_content.v1", summary, text: options.badBody ? "wrong" : body, state: "complete", truncated: false };
  else if (init.method === "POST" || init.method === "PATCH") { mutations++; if(options.interruptSave && mutations===1)throw new Error("synthetic response loss"); result = { schema_version: "yeisme.prompt_mutation.v1", state: "complete", summary }; }
  else result = { schema_version: "yeisme.prompt_page.v1", rows: [summary], total: 1, next_cursor: "" };
  return Response.json(owner === "sonora" ? result : { data: result });
 });
 const app = createApp(config, { db, auth, readers: new OwnerReaders(config, transport.fetcher) });
 const call = (path: string, value?: unknown) => app(new Request(config.origin + "/api/control-center/v1" + path + (path.includes("?")?"&":"?") + "scope=scope-one", { method: value === undefined ? "GET" : "POST", headers: { Cookie: `yeisme_session=${session.id}`, Origin: config.origin, "X-CSRF-Token": session.csrf, "Content-Type": "application/json" }, ...(value === undefined ? {} : { body: JSON.stringify(value) }) }));
 const prepare = async (action = "prompts.save", input: unknown = { title: "Fixture", kind: "image", text: body, tags: [], archived: false, expected_version: 0 }, owner = "eikona", target = "new") => {
  const request = { scope_id: scope.id, owner, target_kind: action === "prompts.save" ? "prompt" : "prompt_collection", target_ref: target, action, expected_revision: "0", idempotency_key: crypto.randomUUID(), input };
  const response = await call("/actions/preview", request); expect(response.status).toBe(200);
  const preview = await response.json();
  return { scope_id: scope.id, preview_ref: preview.preview_ref, preview_digest: preview.preview_digest, idempotency_key: request.idempotency_key };
 };
 return { db, call, prepare, mutations: () => mutations, calls: transport.calls };
}
describe("prompt library owner contracts", () => {
 it("aggregates all three sources and keeps unavailable sources explicit", async () => {
  const f=fixture({forbidden:"sonora"});const response=await f.call("/prompts");expect(response.status).toBe(200);const result=await response.json();expect(result.rows).toHaveLength(2);expect(result.sources.find((v:any)=>v.owner==="sonora").state).toBe("forbidden");expect(JSON.stringify(result)).not.toContain(body);
 });
 it("reads exact business content after durable audit and rejects cross-project or changed bytes",async()=>{
  const f=fixture();const response=await f.call("/prompts/eikona/p_one/content:read",{version:1});expect(response.status).toBe(200);expect((await response.json()).text).toBe(body);expect(f.db.select().from(auditEvents).all().some(v=>v.action==="prompts.content_read")).toBe(true);
  expect((await fixture({wrongProject:true}).call("/prompts/eikona/p_one/content:read",{version:1})).status).toBe(403);
  expect((await fixture({badBody:true}).call("/prompts/eikona/p_one/content:read",{version:1})).status).toBe(502);
 });
 it("saves through preview and receipt without persisting content, and replays once",async()=>{
  const f=fixture();const confirm=await f.prepare();expect(JSON.stringify(f.db.select().from(actionRecords).all())).not.toContain(body);
  const response=await f.call("/actions/confirm",confirm);expect(response.status).toBe(202);expect((await response.json()).state).toBe("succeeded");
  await f.call("/actions/confirm",confirm);expect(f.mutations()).toBe(1);expect(JSON.stringify(f.db.select().from(actionRecords).all())).not.toContain(body);expect(JSON.stringify(f.db.select().from(auditEvents).all())).not.toContain(body);
 });
 it("stores shared collection refs only and rejects cross-scope links",async()=>{
  const f=fixture();let confirm=await f.prepare("prompts.collection.create",{name:"Favorites"},"control-center");let response=await f.call("/actions/confirm",confirm);expect(response.status).toBe(202);const result=await response.json();const id=result.result_refs[0];
  confirm=await f.prepare("prompts.collection.set",{links:[{owner:"eikona",project:"project-one",id:"p_one"}],remove:false},"control-center",id);
  expect((await f.call("/actions/confirm",confirm)).status).toBe(202);
  const collections=await(await f.call("/prompt-collections")).json();expect(collections.links).toHaveLength(1);expect(JSON.stringify(collections)).not.toContain(body);
  confirm=await f.prepare("prompts.collection.set",{links:[{owner:"eikona",project:"other",id:"p_one"}],remove:false},"control-center",id);expect((await f.call("/actions/confirm",confirm)).status).toBe(403);
 });
 it("reconciles the original save after a lost response without a second mutation",async()=>{
  const f=fixture({interruptSave:true});const confirm=await f.prepare();
  expect((await f.call("/actions/confirm",confirm)).status).toBe(503);
  expect((await(await f.call("/actions/confirm",confirm)).json()).state).toBe("unknown");
  const result=await f.call(`/prompts/operations/${confirm.preview_ref}/reconcile`,{});
  expect(result.status).toBe(200);expect((await result.json()).state).toBe("succeeded");expect(f.mutations()).toBe(1);
  expect(JSON.stringify(f.db.select().from(actionRecords).all())).not.toContain(body);
 });
 it("does not let a viewer mutate owner content",async()=>{
  const f=fixture({role:"viewer"});const response=await f.call("/actions/preview",{scope_id:"scope-one",owner:"eikona",target_kind:"prompt",target_ref:"new",action:"prompts.save",expected_revision:"0",idempotency_key:"viewer",input:{title:"Fixture",kind:"image",text:body,tags:[],archived:false,expected_version:0}});expect(response.status).toBe(403);expect(f.mutations()).toBe(0);
 });
});
