/**
 * What the control center knows about each credential it holds for an owner or open tool: one row per credential
 * slot, computed on the server from the file's metadata, the expiry its issuer recorded next to the reference and the
 * latest observations. A row never carries a path, an address or any part of the credential itself.
 *
 * Slot ids are stable and double as the key `personal-config credential` takes:
 * `connection:<id>`, `open_tool:<kind>`, `provider:<owner>`, `owner:<owner>`, `collection:auctra` and
 * `collection:auctra:flow`.
 */
export type CredentialState = "unreadable" | "rejected" | "expired" | "expiring" | "limited" | "ok" | "unknown_expiry";

/**
 * Why a state holds. The first four are the file checks of `unreadable`, `read_failed` is the same state when only a
 * reading says so (the file passed the checks but could not be read); `owner_denied`, `unauthenticated` and `forbidden`
 * say who refused a `rejected` credential, `content_denied` and `read_forbidden` which reads a `limited` one is refused;
 * `invalid_expiry` marks an `unknown_expiry` whose recorded expiry could not be read.
 */
export type CredentialReason =
  | "missing" | "not_file" | "permissions" | "empty" | "read_failed"
  | "owner_denied" | "unauthenticated" | "forbidden"
  | "content_denied" | "read_forbidden"
  | "invalid_expiry";

/** Which reminder step an `expiring` credential is at: within 7 days, or within 1 day. */
export type CredentialStage = "7d" | "1d";

export interface CredentialStatus {
  /** The slot id. */
  id: string;
  /** The tool or owner the credential is for (`gateway`, `eikona`, `auctra`, …). */
  owner: string;
  label: string;
  state: CredentialState;
  reason?: CredentialReason;
  stage?: CredentialStage;
  /** RFC 3339, as recorded by whoever issued the credential. Absent for a credential recorded as never expiring. */
  expires_at?: string;
  /** Whole days, rounded up; only while the credential has not expired. */
  days_left?: number;
  /** The issuer recorded that this credential does not expire (`never`), so there is no date to show or to warn about. */
  never_expires?: true;
  /** When the owner last accepted the credential, only if an observation says so. */
  last_accepted_at?: string;
  /** Ids of the other slots that point at the same file. */
  shared_with: string[];
}

/**
 * What `credential_expires_at` holds for a credential that does not expire, such as an Auctra service key or an
 * observer key. It is a word, not a time: `parseRfc3339` still refuses it, and so does everything else that is not a date.
 */
export const neverExpires = "never";
export const isNeverExpires = (value: unknown): value is typeof neverExpires => value === neverExpires;

export const dayMs = 86_400_000;
const hourMs = 3_600_000;
/** An `expiring` credential is within this many days; the closer stage starts at one day. */
export const expiringDays = 7;

/** State order for lists: what needs action now comes first, then what is coming, then what is merely quiet. */
export const credentialStates: readonly CredentialState[] = ["unreadable", "rejected", "expired", "expiring", "limited", "unknown_expiry", "ok"];

export const credentialStateLabels: Record<CredentialState, string> = {
  unreadable: "凭据读不到",
  rejected: "凭据被拒",
  expired: "凭据已过期",
  expiring: "即将到期",
  limited: "部分读取被拒",
  unknown_expiry: "未记录到期时间",
  ok: "正常",
};

export const credentialReasonLabels: Record<CredentialReason, string> = {
  missing: "凭据文件不存在，或控制中心进不去它所在的目录",
  not_file: "凭据路径不是普通文件",
  permissions: "凭据文件权限不对：必须是 0600，而且控制中心的运行账号要能读它",
  empty: "凭据文件是空的",
  read_failed: "控制中心读这个凭据文件时失败：里面只有空白，或文件刚被改动",
  owner_denied: "工具拒绝了这个凭据，授权被收回或没有开通",
  unauthenticated: "工具不认这个凭据，可能已过期或被吊销",
  forbidden: "凭据没有读取这些内容的权限",
  content_denied: "工具拒绝内容读取，预览和下载不可用",
  read_forbidden: "有一部分读取被拒，其余读取正常",
  invalid_expiry: "记录的到期时间读不了（要带秒和时区的 RFC 3339，或写成 never），按没有记录处理",
};

/** A state needs the administrator's attention; `unknown_expiry` is a gap in what is recorded, not a fault. */
export const isCredentialProblem = (state: CredentialState) => state !== "ok" && state !== "unknown_expiry";
/** A problem state, or an expiry that was recorded but cannot be read, which is a mistake to correct. */
export const credentialNeedsAttention = (row: Pick<CredentialStatus, "state" | "reason">) => isCredentialProblem(row.state) || row.reason === "invalid_expiry";

/** Problems first, then by state order; credentials about to expire go soonest first, the rest by label. */
export function sortCredentials(rows: readonly CredentialStatus[]): CredentialStatus[] {
  const rank = (state: CredentialState) => credentialStates.indexOf(state);
  const soonest = (row: CredentialStatus) => row.days_left ?? Number.MAX_SAFE_INTEGER;
  return [...rows].sort((a, b) => rank(a.state) - rank(b.state)
    || soonest(a) - soonest(b)
    || a.label.localeCompare(b.label, "zh-Hans-CN")
    || (a.id < b.id ? -1 : 1));
}

/**
 * An RFC 3339 date-time as epoch milliseconds, or undefined. Seconds and a zone (`Z` or an offset) are required, so a
 * bare date or a local time, which would mean different instants on different machines, is refused, and so is a date
 * that does not exist (February 30th).
 */
export function parseRfc3339(value: string): number | undefined {
  const parts = /^(\d{4})-(\d{2})-(\d{2})[Tt](\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:[Zz]|[+-](\d{2}):(\d{2}))$/.exec(value);
  if (!parts) return undefined;
  // The offset groups are absent for Z; zero them rather than let them become NaN.
  const [year, month, day, hour, minute, second, offsetHour, offsetMinute] = parts.slice(1).map((part) => part === undefined ? 0 : Number(part));
  const real = month >= 1 && month <= 12 && day >= 1 && day <= new Date(Date.UTC(year, month, 0)).getUTCDate() && hour <= 23 && minute <= 59 && second <= 59 && offsetHour <= 23 && offsetMinute <= 59;
  const at = real ? Date.parse(value.toUpperCase()) : NaN;
  return Number.isFinite(at) ? at : undefined;
}

/** Milliseconds until the recorded expiry; undefined when none is recorded or it cannot be read. */
export function expiryRemainingMs(expiresAt: string | undefined, now: number): number | undefined {
  const at = expiresAt ? parseRfc3339(expiresAt) : undefined;
  return at === undefined ? undefined : at - now;
}

const two = (value: number) => String(value).padStart(2, "0");
/** `MM-DD` in the reader's time zone, with the year when it is not the year of `now`. */
export function credentialExpiryDate(expiresAt: string, now: number = Date.now()): string {
  const at = new Date(expiresAt);
  if (Number.isNaN(at.getTime())) return "";
  const day = `${two(at.getMonth() + 1)}-${two(at.getDate())}`;
  return at.getFullYear() === new Date(now).getFullYear() ? day : `${at.getFullYear()}-${day}`;
}

/** "11-30 到期 · 还剩 29 天", counted from `now`; the last day is counted in hours. */
export function formatCredentialExpiry(expiresAt: string, now: number): string {
  const remaining = expiryRemainingMs(expiresAt, now);
  const date = credentialExpiryDate(expiresAt, now);
  if (remaining === undefined || !date) return "到期时间无法读取";
  if (remaining <= 0) return `${date} 已到期`;
  if (remaining < dayMs) return `${date} 到期 · 还剩 ${Math.max(1, Math.ceil(remaining / hourMs))} 小时`;
  return `${date} 到期 · 还剩 ${Math.ceil(remaining / dayMs)} 天`;
}

/** Quiet (`neutral`) for what is fine or merely unrecorded; the other two mark something to act on. */
export type CredentialTone = "warning" | "danger" | "neutral";

export function credentialTone(row: Pick<CredentialStatus, "state" | "stage" | "reason">): CredentialTone {
  if (row.state === "unreadable" || row.state === "rejected" || row.state === "expired") return "danger";
  if (row.state === "expiring") return row.stage === "1d" ? "danger" : "warning";
  if (row.state === "limited" || row.reason === "invalid_expiry") return "warning";
  return "neutral";
}

/** The short text for a card footer or a list row. */
export function credentialChipText(row: CredentialStatus, now: number): string {
  if (row.state === "ok" && row.never_expires) return "不过期";
  if ((row.state === "ok" || row.state === "expiring" || row.state === "expired") && row.expires_at) return formatCredentialExpiry(row.expires_at, now);
  if (row.reason === "invalid_expiry") return "到期时间读不了";
  return credentialStateLabels[row.state];
}

/** The longer reading for a tooltip or a row's second line; empty when the state has nothing to add. */
export function credentialDetail(row: CredentialStatus): string {
  return row.reason ? credentialReasonLabels[row.reason] : "";
}

/** Tools whose guide has a renewal section of their own; every other credential points at the general one. */
export const renewGuideTools = ["anatomia", "drivebridge", "gateway"] as const;
export const renewSectionId = "guide-renew";

/** The guide section to open for a credential's "续签方法" link. */
export function renewSection(row: Pick<CredentialStatus, "owner">): string {
  return (renewGuideTools as readonly string[]).includes(row.owner) ? `${renewSectionId}-${row.owner}` : renewSectionId;
}

const kindLabels: Record<string, string> = { connection: "任务连接", open_tool: "开放工具", provider: "生成 Provider", owner: "请求读取", collection: "收集" };
/** What kind of credential a slot is, from its id prefix. */
export const credentialKindLabel = (id: string) => kindLabels[id.split(":", 1)[0]] || "凭据";
