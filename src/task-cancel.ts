import type { TaskSnapshot } from "./task-observation";
function key(scope: string, task: TaskSnapshot) {
  return (
    "yeisme.cancel.pending.v1:" +
    JSON.stringify([scope, task.connection_id, task.locator])
  );
}
export function cancellationNeedsFollowup(outcome: string) {
  return outcome === "unknown" || outcome === "requested";
}
export function pendingCancellation(
  scope: string,
  task: TaskSnapshot,
): string | undefined {
  const value = sessionStorage.getItem(key(scope, task));
  if (value !== null && !/^[-a-zA-Z0-9_]{16,100}$/.test(value))
    throw new Error("cancel_recovery_invalid");
  return value || undefined;
}
export function rememberCancellation(
  scope: string,
  task: TaskSnapshot,
  value: string,
) {
  if (!/^[-a-zA-Z0-9_]{16,100}$/.test(value))
    throw new Error("cancel_recovery_invalid");
  sessionStorage.setItem(key(scope, task), value);
}
export function finishCancellation(scope: string, task: TaskSnapshot) {
  sessionStorage.removeItem(key(scope, task));
}
