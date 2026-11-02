import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CredentialLine, CredentialsPanel } from "../src/pages/services/CredentialsPanel";
import {
  credentialChipText, credentialDetail, credentialNeedsAttention, credentialReasonLabels, credentialStateLabels, credentialStates, credentialTone, formatCredentialExpiry, isCredentialProblem, parseRfc3339, renewSection, sortCredentials,
  type CredentialState, type CredentialStatus,
} from "../src/shared/credentials";

/** Local noon on a day of 2026, so the printed date does not depend on the time zone the tests run in. */
const local = (month: number, day: number, hour = 12, minute = 0) => new Date(2026, month - 1, day, hour, minute).getTime();
const iso = (ms: number) => new Date(ms).toISOString();
const row = (id: string, state: CredentialState, extra: Partial<CredentialStatus> = {}): CredentialStatus => ({ id, owner: "gateway", label: id, state, shared_with: [], ...extra });

describe("credential wording", () => {
  it("prints the date and the days left, counting the last day in hours", () => {
    expect(formatCredentialExpiry(iso(local(11, 30)), local(11, 1))).toBe("11-30 到期 · 还剩 29 天");
    expect(formatCredentialExpiry(iso(local(11, 30)), local(11, 29, 11, 59))).toBe("11-30 到期 · 还剩 2 天");
    expect(formatCredentialExpiry(iso(local(11, 30)), local(11, 30, 7))).toBe("11-30 到期 · 还剩 5 小时");
    expect(formatCredentialExpiry(iso(local(11, 30)), local(11, 30, 11, 30))).toBe("11-30 到期 · 还剩 1 小时");
    expect(formatCredentialExpiry(iso(local(11, 30)), local(11, 30))).toBe("11-30 已到期");
    expect(formatCredentialExpiry(iso(local(11, 30)), local(12, 5))).toBe("11-30 已到期");
    expect(formatCredentialExpiry("not a date", local(11, 1))).toBe("到期时间无法读取");
  });

  it("gives each state a short chip text: the date while it is recorded, otherwise the state", () => {
    const now = local(11, 1);
    expect(credentialChipText(row("a", "ok", { expires_at: iso(local(11, 30)) }), now)).toBe("11-30 到期 · 还剩 29 天");
    expect(credentialChipText(row("a", "expiring", { expires_at: iso(local(11, 4)) }), now)).toBe("11-04 到期 · 还剩 3 天");
    expect(credentialChipText(row("a", "expired", { expires_at: iso(local(10, 20)) }), now)).toBe("10-20 已到期");
    expect(credentialChipText(row("a", "rejected"), now)).toBe("凭据被拒");
    expect(credentialChipText(row("a", "unreadable", { reason: "permissions" }), now)).toBe("凭据读不到");
    expect(credentialChipText(row("a", "limited"), now)).toBe("部分读取被拒");
    expect(credentialChipText(row("a", "unknown_expiry"), now)).toBe("未记录到期时间");
    // A rejected credential does not read as healthy because its expiry is still ahead.
    expect(credentialChipText(row("a", "rejected", { expires_at: iso(local(11, 30)) }), now)).toBe("凭据被拒");
  });

  it("labels every state and every reason in Chinese, and tells problems from gaps", () => {
    for (const state of credentialStates) expect(credentialStateLabels[state]).toMatch(/[一-鿿]/);
    for (const label of Object.values(credentialReasonLabels)) expect(label).toMatch(/[一-鿿]/);
    expect(credentialStates.filter(isCredentialProblem)).toEqual(["unreadable", "rejected", "expired", "expiring", "limited"]);
    expect(credentialDetail(row("a", "unreadable", { reason: "empty" }))).toBe(credentialReasonLabels.empty);
    expect(credentialDetail(row("a", "ok"))).toBe("");
    expect(credentialTone(row("a", "expiring", { stage: "7d" }))).toBe("warning");
    expect(credentialTone(row("a", "expiring", { stage: "1d" }))).toBe("danger");
    expect(credentialTone(row("a", "rejected"))).toBe("danger");
    expect(credentialTone(row("a", "limited"))).toBe("warning");
    expect(credentialTone(row("a", "ok"))).toBe("neutral");
  });

  it("puts what needs action first, soonest expiry first, and the quiet rows last", () => {
    const rows = [
      row("ok-late", "ok", { days_left: 29 }), row("unknown", "unknown_expiry"), row("expiring-5", "expiring", { days_left: 5 }), row("limited", "limited"),
      row("expiring-2", "expiring", { days_left: 2 }), row("expired", "expired"), row("rejected-b", "rejected", { label: "乙" }), row("rejected-a", "rejected", { label: "甲" }), row("unreadable", "unreadable"),
    ];
    expect(sortCredentials(rows).map((item) => item.id)).toEqual(["unreadable", "rejected-a", "rejected-b", "expired", "expiring-2", "expiring-5", "limited", "unknown", "ok-late"]);
    // The input is left as it was.
    expect(rows[0].id).toBe("ok-late");
  });

  it("names the guide section for a credential's renewal", () => {
    expect(renewSection({ owner: "gateway" })).toBe("guide-renew-gateway");
    expect(renewSection({ owner: "drivebridge" })).toBe("guide-renew-drivebridge");
    expect(renewSection({ owner: "anatomia" })).toBe("guide-renew-anatomia");
    expect(renewSection({ owner: "eikona" })).toBe("guide-renew");
  });

  it("adds the year to the date when it is not the year of now", () => {
    const january = new Date(2027, 0, 5, 12).toISOString();
    expect(formatCredentialExpiry(january, local(12, 20))).toBe("2027-01-05 到期 · 还剩 16 天");
    expect(formatCredentialExpiry(january, new Date(2027, 0, 1, 12).getTime())).toBe("01-05 到期 · 还剩 4 天");
    expect(formatCredentialExpiry(new Date(2026, 11, 30, 12).toISOString(), new Date(2027, 0, 2, 12).getTime())).toBe("2026-12-30 已到期");
  });

  it("reads an RFC 3339 time only with seconds and a zone, and only when the date exists", () => {
    expect(parseRfc3339("2026-11-30T00:00:00Z")).toBe(Date.UTC(2026, 10, 30));
    expect(parseRfc3339("2026-11-30T23:59:59+08:00")).toBe(Date.UTC(2026, 10, 30, 15, 59, 59));
    expect(parseRfc3339("2026-11-30t00:00:00.250z")).toBe(Date.UTC(2026, 10, 30, 0, 0, 0, 250));
    expect(parseRfc3339("2026-11-30T00:00:00-05:30")).toBe(Date.UTC(2026, 10, 30, 5, 30));
    for (const bad of ["", "2026-11-30", "2026-11-30T00:00", "2026-11-30T00:00:00", "2026-11-30 00:00:00Z", "2026-02-30T00:00:00Z", "2026-13-01T00:00:00Z", "2026-11-30T24:00:00Z", "2026-11-30T00:00:60Z", "2026-11-30T00:00:00+24:00", "tomorrow"]) expect(parseRfc3339(bad), bad).toBeUndefined();
    expect(parseRfc3339("2028-02-29T00:00:00Z")).toBeDefined();
    expect(parseRfc3339("2027-02-29T00:00:00Z")).toBeUndefined();
  });

  it("flags an unreadable recorded expiry as something to correct, in words that say so", () => {
    const bad = row("a", "unknown_expiry", { reason: "invalid_expiry" });
    expect(credentialNeedsAttention(bad)).toBe(true);
    expect(credentialNeedsAttention(row("a", "unknown_expiry"))).toBe(false);
    expect(credentialNeedsAttention(row("a", "rejected"))).toBe(true);
    expect(credentialChipText(bad, local(11, 1))).toBe("到期时间读不了");
    expect(credentialTone(bad)).toBe("warning");
    expect(credentialDetail(bad)).toBe(credentialReasonLabels.invalid_expiry);
    expect(credentialDetail(row("a", "unreadable", { reason: "read_failed" }))).toBe(credentialReasonLabels.read_failed);
    expect(sortCredentials([row("ok", "ok"), bad, row("lim", "limited")]).map((item) => item.id)).toEqual(["lim", "a", "ok"]);
  });

  it("says 不过期 for a credential recorded as never expiring, and still names a fault that outranks it", () => {
    const now = local(11, 1);
    const never = row("a", "ok", { never_expires: true });
    expect(credentialChipText(never, now)).toBe("不过期");
    expect(credentialTone(never)).toBe("neutral");
    expect(credentialNeedsAttention(never)).toBe(false);
    // A refused, unreadable or limited credential is described by that, not by how long it would have lasted.
    expect(credentialChipText(row("a", "rejected", { never_expires: true }), now)).toBe("凭据被拒");
    expect(credentialChipText(row("a", "unreadable", { never_expires: true, reason: "permissions" }), now)).toBe("凭据读不到");
    expect(credentialChipText(row("a", "limited", { never_expires: true }), now)).toBe("部分读取被拒");
    // A date that is recorded still reads as a date, and a gap still reads as a gap.
    expect(credentialChipText(row("a", "ok", { expires_at: iso(local(11, 30)) }), now)).toBe("11-30 到期 · 还剩 29 天");
    expect(credentialChipText(row("a", "unknown_expiry"), now)).toBe("未记录到期时间");
    expect(sortCredentials([row("ok", "ok", { never_expires: true }), row("gap", "unknown_expiry"), row("soon", "expiring", { days_left: 3 })]).map((item) => item.id)).toEqual(["soon", "gap", "ok"]);
  });

  it("shows 不过期 on a card footer and in the panel, and no longer counts it as a missing record", () => {
    const now = local(11, 1);
    const never = row("open_tool:gateway", "ok", { owner: "gateway", label: "我的网关", never_expires: true });
    const gap = row("connection:a", "unknown_expiry", { owner: "eikona", label: "Eikona 主库" });
    const line = renderToStaticMarkup(createElement(CredentialLine, { row: never, now }));
    expect(line).toContain("不过期");
    expect(line).not.toContain("续签方法");
    // Only the gap is a missing record; the never-expiring row sits among the quiet ones, saying 不过期.
    const panel = renderToStaticMarkup(createElement(CredentialsPanel, { rows: [never, gap], now }));
    expect(panel).toContain("不过期");
    expect(panel).toContain("有 1 项凭据没有记录到期时间");
    expect(panel).toContain("（其中 1 项没有记录到期时间）");
    expect(panel).toContain("expiry &lt;slot&gt; never");
    // With every row dated or marked never, there is no hint to add a record.
    const done = renderToStaticMarkup(createElement(CredentialsPanel, { rows: [never, row("connection:b", "ok", { expires_at: iso(local(11, 30)) })], now }));
    expect(done).not.toContain("没有记录到期时间");
    expect(done).not.toContain("data-credential-backfill");
    expect(done).toContain("其余 2 项正常");
  });
});
