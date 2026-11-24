import type { AccountManagement, PersonalUserView } from "./api/control-center-client";
import { matchFields, queryTerms } from "./search/match";

export interface AccountDraft { username: string; name: string; role: "admin" | "viewer"; scope_ids: string[]; issue_invite_ttl_hours?: number }
export type AccountStatus = "active" | "disabled" | "duplicate";

export const usernamePattern = /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,79}$/;
export const roleLabels = { admin: "管理员", viewer: "只读成员" } as const;
export const roleHints = { admin: "能看全部，能管账号、看审计、确认需要管理员的操作", viewer: "只能看授权范围里的内容，不能改任何东西" } as const;
export const statusWords: Record<AccountStatus, string> = { active: "有效", disabled: "已停用", duplicate: "重名" };

/** What is wrong with a draft, in words; null when it can be saved. `taken` holds every username in use, the owner's included. */
export function draftProblem(draft: AccountDraft, taken: readonly string[], creating: boolean): string | null {
  if (creating && !usernamePattern.test(draft.username)) return "用户名只能用字母、数字、点、横线和下划线，以字母或数字开头";
  if (creating && taken.includes(draft.username)) return "这个用户名已经有了";
  if (!draft.name.trim()) return "写一个显示名，例如对方的名字";
  if (!draft.scope_ids.length) return "至少选一个范围";
  return null;
}

/** A name listed twice is off whatever its entries say, so it reads as its own state. */
export const accountStatus = (user: PersonalUserView): AccountStatus => user.duplicate ? "duplicate" : user.enabled ? "active" : "disabled";

export function accountStatusCounts(users: readonly PersonalUserView[]): Record<AccountStatus | "all", number> {
  const counts = { all: users.length, active: 0, disabled: 0, duplicate: 0 };
  for (const user of users) counts[accountStatus(user)] += 1;
  return counts;
}

/** The accounts a status tab and a search show: the search looks at the username, the display name and the scopes. */
export function visibleAccounts(users: readonly PersonalUserView[], status: AccountStatus | "all", search: string) {
  const terms = queryTerms(search);
  return users.filter((user) => (status === "all" || accountStatus(user) === status) && (!terms.length || matchFields([{ text: user.username }, { text: user.name }, { text: user.scope_ids.join(" ") }], terms, { subsequence: false })));
}

/** Every username a new account cannot take: the listed ones and the configuration's own owner. */
export const takenUsernames = (users: readonly PersonalUserView[], management?: AccountManagement | null) => [...users.map((user) => user.username), ...(management?.legacy_owner ? [management.legacy_owner.username] : [])];

/** Only what an edit changed is sent, so a field nobody touched never overwrites a change made meanwhile. */
export function accountPatch(draft: AccountDraft, user: PersonalUserView): Partial<Pick<AccountDraft, "name" | "role" | "scope_ids">> {
  const sameScopes = draft.scope_ids.length === user.scope_ids.length && draft.scope_ids.every((id) => user.scope_ids.includes(id));
  return {
    ...(draft.name.trim() !== user.name ? { name: draft.name.trim() } : {}),
    ...(draft.role !== user.role ? { role: draft.role } : {}),
    ...(sameScopes ? {} : { scope_ids: draft.scope_ids }),
  };
}
