import { describe, expect, it, vi } from "vitest";
import { createApp } from "../server/app";
import { AuthError } from "../server/auth";
import { password, running, signIn } from "./personal-server.support";

const captureRef = "h_" + "a".repeat(32);

async function appWithTasks(promptContent = vi.fn(async () => ({ state: "complete" as const, text: "raw prompt", capture_ref: captureRef, task_ref: "run-1" }))) {
  const base = await running();
  const app = createApp(base.config, { auth: base.auth, tasks: { promptContent } as never });
  const signed = await signIn(app, "root", password);
  const session = [...base.auth.sessions.values()].find((value) => value.subject === "root")!;
  const request = (path: string, body: unknown, csrf = session.csrf) => app(new Request(base.config.origin + "/api/control-center/v1" + path + "?scope=personal", {
    method: "POST",
    headers: { Origin: base.config.origin, Cookie: signed.cookie, "X-CSRF-Token": csrf, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }));
  return { request, promptContent, signed };
}

describe("task prompt content route", () => {
  it("relays the owner prompt after the control-center audit", async () => {
    const { request, promptContent } = await appWithTasks();
    const response = await request("/tasks/task-key/prompt:read", { capture_ref: captureRef, purpose: "review the failed request" });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ state: "complete", text: "raw prompt" });
    expect(promptContent).toHaveBeenCalledWith("task-key", expect.anything(), captureRef, "review the failed request");
  });

  it("rejects a missing CSRF token before the owner call", async () => {
    const { request, promptContent } = await appWithTasks();
    const response = await request("/tasks/task-key/prompt:read", { capture_ref: captureRef, purpose: "review" }, "");
    expect(response.status).toBe(403);
    expect(promptContent).not.toHaveBeenCalled();
  });

  it("rejects a malformed capture reference and extra fields", async () => {
    const { request, promptContent } = await appWithTasks();
    for (const body of [
      { capture_ref: "../owner", purpose: "review" },
      { capture_ref: captureRef, purpose: "review", unknown: true },
      { capture_ref: captureRef, purpose: "" },
      { capture_ref: captureRef, purpose: "x".repeat(201) },
    ]) {
      const response = await request("/tasks/task-key/prompt:read", body);
      expect(response.status).toBe(400);
    }
    expect(promptContent).not.toHaveBeenCalled();
  });

  it("maps an owner content refusal without inventing a body", async () => {
    const { request } = await appWithTasks(vi.fn(async () => { throw new AuthError("content_not_authorized", 403); }));
    const response = await request("/tasks/task-key/prompt:read", { capture_ref: captureRef, purpose: "review" });
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ error: "content_not_authorized" });
  });
});
