import { describe, expect, test } from "vitest";
import { actorOfRequest, actorOfTask } from "../src/shared/read-model/activity";
import { linkCallsToTasks } from "../src/shared/agent-monitor";

describe("agent attribution", () => {
  test("types an agent only from actor_type", () => {
    expect(actorOfTask({ actor: "coding-agent", actor_type: "agent" }).kind).toBe("agent");
    expect(actorOfTask({ actor: "this looks like an agent" }).kind).toBe("unknown");
    expect(actorOfRequest({ actor: "worker", actor_type: "agent" })).toMatchObject({ kind: "agent", typed: true });
  });

  test("joins a task to a call only by exact gateway_call_ref", () => {
    const links = linkCallsToTasks(
      [{ call_ref: "inv_abc" }, { call_ref: "inv_other" }],
      [
        { task_ref: "task_1", owner: "eikona", actor_type: "agent", origin_refs: { gateway_call_ref: "inv_abc" } },
        { task_ref: "task_near", owner: "eikona", actor_type: "agent", origin_refs: { gateway_call_ref: "inv_missing" } },
        { task_ref: "task_bad", owner: "scaena", origin_refs: { gateway_call_ref: "has space" } },
      ],
    );
    expect(links).toEqual([{ call_ref: "inv_abc", task_ref: "task_1", owner: "eikona", actor_type: "agent" }]);
  });
});
