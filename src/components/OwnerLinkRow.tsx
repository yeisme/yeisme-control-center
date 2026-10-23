import { Route } from "../icons";
import type { WorkQueueLink } from "../shared/work-queue";
import { Button } from "./ui";

/** One owner hand-off: a CLI template for Auctra/Scaena, or a server-built URL for a configured MuWeave. Never an arbitrary link. */
export function OwnerLinkRow({ link }: { link: WorkQueueLink }) {
  const url = link.launch?.url;
  const muweave = link.launch?.owner === "muweave";
  return <div className="flex items-center gap-3 rounded-control border border-line bg-panel-soft p-3">
    <Route className="size-4 shrink-0 text-faint" />
    <span className="min-w-0 flex-1">
      <span className="block text-body-sm font-medium">{link.label}</span>
      <span className="block text-2xs text-muted">受控 LaunchContext · owner 负责最终读取</span>
      {link.command && <code className="mt-1 block break-all text-2xs text-faint">{link.command}</code>}
    </span>
    {url
      ? <Button size="sm" variant="secondary" onClick={() => { window.open(url, "_blank", "noopener,noreferrer"); }}>打开</Button>
      : <Button size="sm" variant="ghost" disabled disabledReason={muweave ? "MuWeave 尚未提供可打开的入口合同" : "owner 没有提供可打开的入口，可复制上方命令"}>{muweave ? "待合同" : "复制命令"}</Button>}
  </div>;
}
