import type { ScopeBinding, ServerConfig } from "./contracts";
import { observationSettings } from "./observation-config";
import { enabledUsers } from "./personal-users";
import type { ControlCenterRole } from "../src/service-directory";

/** Issuer of every personal-mode session. The reminder ledger keys a recipient as `issuer|subject`. */
export const personalIssuer = "yeisme:personal";

export interface PersonalAccount {
  /** `issuer|subject`, the way the reminder ledger names its recipient. */
  identity: string;
  username: string;
  role: ControlCenterRole;
  scope_ids: string[];
  /** The owner account of the config's top-level `personal` block, as opposed to a named user. */
  legacy: boolean;
}

/**
 * Who can hold a personal session, read from the config the way `SessionAuth` resolves and signs them in: an enabled
 * named user wins over the legacy owner of the same name, a disabled user does not exist, the legacy owner can only
 * sign in by name once named users exist, and nothing exists unless the server runs in personal mode. Read-only; it
 * never creates or changes an account.
 */
export function personalAccounts(config: ServerConfig): PersonalAccount[] {
  const personal = config.personal;
  if (config.auth_mode !== "personal" || !personal) return [];
  const accounts: PersonalAccount[] = [];
  const names = new Set<string>();
  // The shared rule: an acceptable `enabled` flag and a username listed once. A repeated name disables every entry of it.
  for (const user of enabledUsers(personal.users)) {
    names.add(user.username);
    accounts.push({ identity: `${personalIssuer}|${user.username}`, username: user.username, role: user.role === "admin" ? "admin" : "viewer", scope_ids: user.scope_ids || [], legacy: false });
  }
  const owner = personal.username || "owner";
  // With named users configured (disabled ones count), the legacy owner signs in only under the name set in the config.
  const legacyCanSignIn = !personal.users?.length || personal.username !== undefined;
  if (legacyCanSignIn && !names.has(owner)) accounts.push({ identity: `${personalIssuer}|${owner}`, username: owner, role: personal.role === "admin" ? "admin" : "viewer", scope_ids: personal.scope_ids || [], legacy: true });
  return accounts;
}

/** Every base scope the config binds, once each. Shared-project scopes (`project_*`) are not in the config and never appear here. */
export function baseScopes(config: ServerConfig): ScopeBinding[] {
  const seen = new Set<string>();
  const scopes: ScopeBinding[] = [];
  for (const principal of config.principals) for (const scope of principal.scopes) {
    if (seen.has(scope.id) || scope.id.startsWith("project_")) continue;
    seen.add(scope.id);
    scopes.push(scope);
  }
  return scopes;
}

/**
 * The identities that get background reminders for a scope: enabled admin accounts bound to it, or, when
 * `observation.recipients` names some, those of them that appear in that list. A viewer is never a recipient, and
 * naming one in the list does not make them one.
 */
export function reminderRecipients(config: ServerConfig, scopeId: string): string[] {
  // Read through the validated settings: a malformed `recipients` is no list at all, never an exception.
  const named = observationSettings(config).recipients;
  return personalAccounts(config)
    .filter((account) => account.role === "admin" && account.scope_ids.includes(scopeId) && (!named.length || named.includes(account.identity)))
    .map((account) => account.identity);
}
