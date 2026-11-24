import { createHash } from "node:crypto";
import type { ScopeBinding } from "./contracts";

/** Never expose this persistence namespace as a public scope id. */
export function collectionIndexScope(scope: ScopeBinding): string {
  return scope.read_context ? `collection_${createHash("sha256").update(JSON.stringify([scope.id, scope.read_context])).digest("hex")}` : scope.id;
}
