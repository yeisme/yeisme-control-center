import { useEffect, useRef, useState, type Ref } from "react";
import { ArrowRight, KeyRound } from "../../icons";
import { Dot, InlineNotice, Panel, Pill, cx } from "../../components/ui";
import { formatRelative } from "../../shared/read-model/format";
import {
  credentialChipText, credentialDetail, credentialKindLabel, credentialNeedsAttention, credentialTone, renewSection, sortCredentials,
  type CredentialStatus, type CredentialTone,
} from "../../shared/credentials";
import { appGuidePath } from "../guide/guide-location";
import { credentialTarget } from "./credential-target";

const toneText: Record<CredentialTone, string> = { warning: "text-warning", danger: "text-danger", neutral: "text-muted" };
const commandClass = "mt-1.5 overflow-x-auto whitespace-pre rounded-[6px] bg-panel-sunken px-2.5 py-2 font-mono text-2xs text-ink-soft";
const backfillCommand = "bun scripts/personal-config.ts credential <config-file> expiry <slot> <RFC3339>";
const neverCommand = "bun scripts/personal-config.ts credential <config-file> expiry <slot> never";
/** States where replacing the credential is the way forward, so the card points at the guide. */
const needsRenewal = new Set(["expiring", "expired", "rejected", "unreadable"]);

/** The signed-in address of the guide's renewal section for this credential's tool. */
export const renewHref = (row: Pick<CredentialStatus, "owner">) => "#" + appGuidePath({ chapter: "connect", page: null, tool: null, client: "claude", section: renewSection(row) });

function RenewLink({ row }: { row: CredentialStatus }) {
  return <a href={renewHref(row)} aria-label={`${row.label} 的续签方法`} className="inline-flex items-center gap-1 whitespace-nowrap text-2xs font-medium text-info hover:underline">续签方法<ArrowRight className="size-3" /></a>;
}

/** What the card footer says about its credential: the expiry while it is fine, the problem when it is not, and where to renew. */
export function CredentialLine({ row, now }: { row: CredentialStatus; now: number }) {
  const tone = credentialTone(row);
  const text = credentialChipText(row, now);
  return <div data-credential={row.id} data-state={row.state} className="mb-2 flex flex-wrap items-center gap-x-2 gap-y-1">
    {tone === "neutral"
      ? <span title={credentialDetail(row) || undefined} className="inline-flex items-center gap-1.5 text-muted"><KeyRound className="size-3.5 shrink-0" />{text}</span>
      : <Pill size="sm" tone={tone} icon={<KeyRound />} title={credentialDetail(row) || undefined}>{text}</Pill>}
    {needsRenewal.has(row.state) && <RenewLink row={row} />}
  </div>;
}

/** "与 A、B 共用…": at most two names, then a count, so a file many slots share does not fill the row. */
function sharedText(names: string[]) {
  if (!names.length) return "";
  const shown = names.length > 2 ? `${names.slice(0, 2).join("、")} 等 ${names.length} 项` : names.join("、");
  return ` · 与 ${shown} 共用同一个凭据文件，换凭据时一并处理`;
}

/** `linked`: a deep link named this row. It is highlighted and can take focus, which the panel gives it once. */
function CredentialRow({ row, rows, now, linked = false, rowRef }: { row: CredentialStatus; rows: CredentialStatus[]; now: number; linked?: boolean; rowRef?: Ref<HTMLLIElement> }) {
  const tone = credentialTone(row);
  const shared = row.shared_with.map((id) => rows.find((other) => other.id === id)?.label || id);
  const detail = credentialDetail(row);
  return <li ref={linked ? rowRef : undefined} tabIndex={linked ? -1 : undefined} data-credential-row={row.id} data-state={row.state} data-linked={linked || undefined} className={cx("flex flex-wrap items-start gap-x-3 gap-y-1.5 px-4 py-3", linked && "bg-primary-soft/50")}>
    <Dot tone={tone === "neutral" ? (row.state === "ok" ? "success" : "neutral") : tone} className="mt-2" />
    <div className="min-w-0 flex-1">
      <p className="truncate text-body-sm font-medium text-ink">{row.label}</p>
      <p className="text-2xs text-muted" title={shared.length > 2 ? shared.join("、") : undefined}>
        {credentialKindLabel(row.id)}
        {row.last_accepted_at ? ` · 最近被接受 ${formatRelative(row.last_accepted_at)}` : ""}
        {sharedText(shared)}
      </p>
      {detail && <p className={cx("mt-0.5 text-2xs", toneText[tone])}>{detail}</p>}
      <p className="mt-0.5 font-mono text-2xs text-faint">{row.id}</p>
    </div>
    <div className="flex shrink-0 flex-wrap items-center gap-2">
      {tone === "neutral"
        ? <span className="text-meta text-muted tabular">{credentialChipText(row, now)}</span>
        : <Pill size="sm" tone={tone}>{credentialChipText(row, now)}</Pill>}
      {needsRenewal.has(row.state) && <RenewLink row={row} />}
    </div>
  </li>;
}

/**
 * Every credential this scope uses. Problems come first; healthy ones fold away. The expiry is what the administrator
 * recorded, since the tools do not report it, so rows without one say so and how to add it. The server sends these rows
 * to personal administrators only, so the slot ids and the command are shown without a role check here.
 */
export function CredentialsPanel({ rows, now, focusRef }: { rows: CredentialStatus[]; now: number; focusRef?: string | null }) {
  const sorted = sortCredentials(rows);
  const problems = sorted.filter(credentialNeedsAttention);
  const quiet = sorted.filter((row) => !credentialNeedsAttention(row));
  // Rows whose expiry was recorded but cannot be read are in the problem list; these have no record at all.
  const unrecorded = quiet.filter((row) => row.state === "unknown_expiry").length;
  // A deep link (`#/services?ref=<slot>`, from the work queue's renewal items) names one row. An unknown slot names none.
  const target = credentialTarget(rows, focusRef);
  const quietGroup = useRef<HTMLDetailsElement>(null);
  const linkedRow = useRef<HTMLLIElement>(null);
  const handled = useRef<string | null>(null);
  // A folded row is open from the first render, so it is never hidden for a frame; the group is the reader's afterwards.
  const [openAtFirst] = useState(() => target?.folded === true);
  // Once per link, not on every reload of the page's data: open the group if the row is folded, bring the row into view
  // and give it focus, so a keyboard or screen reader user lands on it too.
  useEffect(() => {
    if (!target) { handled.current = null; return; }
    if (handled.current === target.id) return;
    handled.current = target.id;
    if (target.folded && quietGroup.current) quietGroup.current.open = true;
    linkedRow.current?.scrollIntoView({ block: "center" });
    linkedRow.current?.focus({ preventScroll: true });
  }, [target?.id, target?.folded]);
  return <section aria-label="凭据" data-credentials className="space-y-3">
    <h2 className="text-title-sm font-semibold text-ink">凭据<span className="ml-2 text-2xs font-normal text-muted tabular">{rows.length} 项{problems.length ? ` · ${problems.length} 项要处理` : ""}</span></h2>
    <Panel bodyClassName="p-0">
      {problems.length
        ? <ul aria-label="需要处理的凭据" className="divide-y divide-line">{problems.map((row) => <CredentialRow key={row.id} row={row} rows={rows} now={now} linked={row.id === target?.id} rowRef={linkedRow} />)}</ul>
        : <p className="px-4 py-3 text-body-sm text-muted">没有需要处理的凭据。</p>}
      {quiet.length > 0 && <details ref={quietGroup} open={openAtFirst || undefined} data-credentials-quiet className={cx("px-4 py-2.5 text-body-sm", problems.length > 0 && "border-t border-line")}>
        <summary className="cursor-pointer font-medium text-ink-soft">其余 {quiet.length} 项{unrecorded === 0 ? "正常" : unrecorded === quiet.length ? "，都没有记录到期时间" : `（其中 ${unrecorded} 项没有记录到期时间）`}</summary>
        <ul aria-label="其余凭据" className="mt-2 divide-y divide-line">{quiet.map((row) => <CredentialRow key={row.id} row={row} rows={rows} now={now} linked={row.id === target?.id} rowRef={linkedRow} />)}</ul>
      </details>}
    </Panel>
    {unrecorded > 0 && <InlineNotice tone="info" className="py-2 text-2xs">
      有 {unrecorded} 项凭据没有记录到期时间。工具不会告诉控制中心凭据什么时候到期，没有这条记录就没法提前提醒；已经在用的，补记一下：
      <pre tabIndex={0} data-credential-backfill className={commandClass}>{backfillCommand}</pre>
      <span className="mt-2 block">凭据本来就不会过期的（比如 Auctra 的服务密钥），记成 never，这里就会写“不过期”，不再算缺记录：</span>
      <pre tabIndex={0} data-credential-never className={commandClass}>{neverCommand}</pre>
    </InlineNotice>}
  </section>;
}
