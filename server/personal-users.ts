import type { PersonalUser } from "./contracts";

/** What the rules below look at. Accounts read from a configuration file are untrusted until they pass through them. */
type Entry = Pick<PersonalUser, "username"> & { enabled?: unknown };

/**
 * One rule for "this account may sign in", used wherever accounts are read: an entry is enabled only when `enabled` is
 * `true` or absent (files written before the field existed have none). `false` and any other value, such as `"false"`,
 * `0` or `null`, mean disabled: a hand-edited flag must never switch an account on by accident.
 */
export const isEnabledFlag = (value: unknown) => value === undefined || value === true;

/** Usernames that appear in more than one entry of the list. */
export function duplicateNames(users: readonly Entry[] | undefined): Set<string> {
  const seen = new Set<string>();
  const repeated = new Set<string>();
  for (const user of users ?? []) (seen.has(user.username) ? repeated : seen).add(user.username);
  return repeated;
}

/**
 * The entries that may sign in: an acceptable flag, and a username that no other entry shares. When a name is listed
 * twice nobody can say which entry was meant, so every entry of that name is disabled until the file is corrected.
 */
export function enabledUsers<T extends Entry>(users: readonly T[] | undefined): T[] {
  const list = users ?? [];
  const repeated = duplicateNames(list);
  return list.filter((user) => isEnabledFlag(user.enabled) && !repeated.has(user.username));
}

export function findEnabledUser<T extends Entry>(users: readonly T[] | undefined, username: string): T | undefined {
  return enabledUsers(users).find((user) => user.username === username);
}
