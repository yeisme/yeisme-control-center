import { useEffect, useRef, useState } from "react";
import { Dialog } from "radix-ui";
import { Check, Copy, Download, KeyRound, Link2, TriangleAlert } from "../icons";
import { Button, Checkbox } from "./ui";
import { copyText } from "../shared/clipboard";
import { shortcutText } from "../shared/platform";
import { buildControlInviteUrl, formatControlInviteCard } from "../shared/url-invite";
import type { KeyReveal } from "../app/key-reveal";

/**
 * A new access key and/or one-time invitation link, shown once. Never placed in
 * browser history, logs or storage: the operator copies or downloads it, confirms
 * it is saved (when a long-lived key was minted), and closing clears memory.
 */
export function KeyRevealDialog({ reveal, onDone }: { reveal: KeyReveal | null; onDone: () => void }) {
  const [saved, setSaved] = useState(false);
  const [copiedKind, setCopiedKind] = useState<"idle" | "key" | "link" | "card" | "manual">("idle");
  const field = useRef<HTMLInputElement>(null);
  const linkField = useRef<HTMLInputElement>(null);

  const hasLongKey = Boolean(reveal?.key);
  const inviteUrl = reveal?.inviteToken
    ? buildControlInviteUrl(window.location.origin, reveal.inviteToken)
    : "";

  useEffect(() => {
    setSaved(!reveal?.key);
    setCopiedKind("idle");
  }, [reveal?.key, reveal?.inviteToken]);

  const copyKey = async () => {
    if (!reveal?.key) return;
    const ok = await copyText(reveal.key);
    setCopiedKind(ok ? "key" : "manual");
    if (!ok) {
      field.current?.focus();
      field.current?.select();
    }
  };

  const copyLink = async () => {
    if (!inviteUrl) return;
    const ok = await copyText(inviteUrl);
    setCopiedKind(ok ? "link" : "manual");
    if (!ok) {
      linkField.current?.focus();
      linkField.current?.select();
    }
  };

  const copyInviteCard = async () => {
    if (!reveal) return;
    const card = formatControlInviteCard({
      username: reveal.username,
      inviteUrl: inviteUrl || undefined,
      inviteToken: reveal.inviteToken,
      accessKey: reveal.key,
      expiresAt: reveal.inviteExpiresAt,
    });
    const ok = await copyText(card);
    setCopiedKind(ok ? "card" : "manual");
  };

  const download = () => {
    if (!reveal) return;
    const lines = [
      `用户名：${reveal.username}`,
      ...(reveal.key ? [`访问 Key：${reveal.key}`] : []),
      ...(inviteUrl ? [`一次性免密直连链接：${inviteUrl}`] : []),
      "",
      "这个凭据只显示一次。请放进密码管理器，或通过私密渠道发给受邀本人。",
    ];
    const blob = new Blob([lines.join("\n") + "\n"], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `yeisme-${reveal.username}-access-key.txt`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
  };

  return (
    <Dialog.Root open={!!reveal} onOpenChange={(open) => { if (!open && saved) onDone(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fade-in fixed inset-0 z-critical-scrim backdrop-blur-[1px]" style={{ background: "var(--scrim)" }} />
        <Dialog.Content
          data-key-reveal
          onEscapeKeyDown={(event) => { if (!saved) event.preventDefault(); }}
          onPointerDownOutside={(event) => event.preventDefault()}
          className="pop-in fixed left-1/2 top-1/2 z-critical w-[min(540px,calc(100vw-24px))] -translate-x-1/2 -translate-y-1/2 rounded-[18px] border border-line bg-panel p-6 text-ink shadow-float outline-none"
        >
          <div className="flex items-start gap-3">
            <span className="grid size-10 shrink-0 place-items-center rounded-[12px] bg-warning-soft text-warning">
              {hasLongKey ? <KeyRound className="size-5" /> : <Link2 className="size-5" />}
            </span>
            <div className="min-w-0">
              <Dialog.Title className="text-title font-semibold">{reveal?.title || "新的访问凭据"}</Dialog.Title>
              <Dialog.Description className="mt-1 text-body-sm text-muted">
                账号 <span className="font-mono text-ink">@{reveal?.username}</span> 的{hasLongKey ? "访问 Key" : "一次性免密邀请链接"}。它只显示这一次，关闭后不会保存在服务端明文记录中。
              </Dialog.Description>
            </div>
          </div>

          {inviteUrl && (
            <label className="mt-5 block text-2xs text-muted">
              一次性免密直连链接（点开直接进入，首次打开后立即单次失效防转发）
              <input
                ref={linkField}
                readOnly
                value={inviteUrl}
                aria-label="一次性免密直连链接"
                onFocus={(event) => event.currentTarget.select()}
                className="mt-1 block h-10 w-full rounded-control border border-line bg-panel-soft px-3 font-mono text-[12px] tracking-tight text-ink outline-none focus:border-focus focus:ring-3 focus:ring-focus/15"
              />
            </label>
          )}

          {hasLongKey && (
            <label className="mt-4 block text-2xs text-muted">
              访问 Key
              <input
                ref={field}
                readOnly
                value={reveal?.key || ""}
                aria-label="新的访问 Key"
                onFocus={(event) => event.currentTarget.select()}
                className="mt-1 block h-11 w-full rounded-control border border-line bg-panel-soft px-3 font-mono text-[13px] tracking-tight text-ink outline-none focus:border-focus focus:ring-3 focus:ring-focus/15"
              />
            </label>
          )}

          {copiedKind === "manual" && (
            <p className="mt-2 text-2xs text-warning">
              浏览器没有允许直接复制。内容已经全选，按 {shortcutText("C")} 复制。
            </p>
          )}

          <div className="mt-3 flex flex-wrap gap-2">
            {inviteUrl && (
              <Button
                size="sm"
                variant="primary"
                icon={copiedKind === "link" ? <Check className="size-3.5" /> : <Link2 className="size-3.5" />}
                onClick={() => void copyLink()}
              >
                {copiedKind === "link" ? "已复制直连链接" : "复制直连链接"}
              </Button>
            )}
            <Button
              size="sm"
              variant="secondary"
              icon={copiedKind === "card" ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
              onClick={() => void copyInviteCard()}
            >
              {copiedKind === "card" ? "已复制邀请口令" : "复制邀请口令"}
            </Button>
            {hasLongKey && (
              <Button
                size="sm"
                variant="secondary"
                icon={copiedKind === "key" ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
                onClick={() => void copyKey()}
              >
                {copiedKind === "key" ? "已复制" : "复制 Key"}
              </Button>
            )}
            <Button size="sm" variant="ghost" icon={<Download className="size-3.5" />} onClick={download}>
              下载为文本文件
            </Button>
          </div>

          <p className="mt-4 flex gap-2 rounded-[12px] bg-panel-sunken p-3 text-2xs text-ink-soft">
            <TriangleAlert className="mt-0.5 size-3.5 shrink-0 text-warning" />
            将直连链接或口令发给受邀本人即可一键登录。{reveal?.after ? ` ${reveal.after}` : ""}
          </p>

          {hasLongKey && (
            <label className="mt-4 flex cursor-pointer items-center gap-2 text-body-sm">
              <Checkbox checked={saved} onChange={setSaved} label="我已保存这个 Key" />
              我已保存这个 Key
            </label>
          )}

          <div className="mt-5 flex justify-end">
            <Button
              variant="primary"
              disabled={!saved}
              disabledReason={saved ? undefined : "先确认你已经保存好这个 Key"}
              onClick={onDone}
            >
              完成
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
