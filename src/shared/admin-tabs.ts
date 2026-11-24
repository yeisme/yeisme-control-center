export type AdminTab = "accounts" | "organizations" | "members" | "audit";

export const adminTabLabels: Record<AdminTab, string> = { accounts: "账号", organizations: "组织与团队", members: "工具成员", audit: "审计" };

/** What a person may open: accounts and the audit log are for administrators only. */
export const adminTabsFor = (isAdmin: boolean): AdminTab[] => isAdmin ? ["accounts", "organizations", "members", "audit"] : ["organizations", "members"];

/**
 * The tab a visit asks for: `?tab=`, else the old address it came in by (`#/members`, `#/audit`, `#/accounts`), else the
 * first one the person may see. `collaboration` is the name the tab had on the old team page.
 */
export function adminTabFor(requested: string | null, alias: string, allowed: readonly AdminTab[]): AdminTab {
  const named = requested === "collaboration" ? "organizations" : requested || (["members", "audit", "accounts"].includes(alias) ? alias : "");
  return (allowed as readonly string[]).includes(named) ? named as AdminTab : allowed[0];
}
