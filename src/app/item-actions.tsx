import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import { Dialog } from "radix-ui";
import { Button, type ItemAction, useToast } from "../components/ui";
import { ExternalLink, Link2 } from "../icons";
import { copyReference } from "../shared/clipboard";

/** An absolute link to a page of this app (hash routes), to copy or open in a new tab. */
export function appLink(route: string) {
  return `${window.location.origin}${window.location.pathname}#${route.startsWith("/") ? route : `/${route}`}`;
}

type Copy = (value: string, what: string) => Promise<void>;
const CopyContext = createContext<Copy>(async () => undefined);

/**
 * Copying from menus. When the browser refuses the clipboard, the value opens selected in a small dialog to copy by
 * hand, instead of the action failing silently.
 */
export function CopyProvider({ children }: { children: ReactNode }) {
  const notify = useToast();
  const [manual, setManual] = useState<{ value: string; what: string } | null>(null);
  const copy = useCallback<Copy>(async (value, what) => {
    if (await copyReference(value)) notify(`已复制${what}`, "success");
    else setManual({ value, what });
  }, [notify]);
  return (
    <CopyContext.Provider value={copy}>
      {children}
      <Dialog.Root open={!!manual} onOpenChange={(open) => { if (!open) setManual(null); }}>
        <Dialog.Portal>
          <Dialog.Overlay className="fade-in fixed inset-0 z-[86] backdrop-blur-[1px]" style={{ background: "var(--scrim)" }} />
          <Dialog.Content className="pop-in fixed left-1/2 top-1/2 z-[87] w-[min(440px,calc(100vw-24px))] -translate-x-1/2 -translate-y-1/2 rounded-[16px] border border-line bg-panel p-5 text-ink shadow-float outline-none">
            <Dialog.Title className="text-title-sm font-semibold">复制{manual?.what}</Dialog.Title>
            <Dialog.Description className="mt-1 text-body-sm text-muted">浏览器未允许直接复制，内容已选中，请按 Ctrl+C 或长按复制。</Dialog.Description>
            <input
              aria-label={`手动复制${manual?.what || ""}`}
              readOnly
              autoFocus
              value={manual?.value || ""}
              onFocus={(event) => event.currentTarget.select()}
              className="mt-4 w-full rounded-control border border-line bg-panel-soft px-3 py-2 font-mono text-xs"
            />
            <div className="mt-4 flex justify-end"><Dialog.Close asChild><Button variant="primary">完成</Button></Dialog.Close></div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </CopyContext.Provider>
  );
}

export const useCopy = () => useContext(CopyContext);

/** "在新标签打开" and "复制链接" for anything that has its own address in the app. */
export function linkActions(route: string, copy: Copy): ItemAction[] {
  return [
    { id: "open-new-tab", label: "在新标签打开", icon: <ExternalLink />, group: "link", run: () => { window.open(appLink(route), "_blank", "noopener"); } },
    { id: "copy-link", label: "复制链接", icon: <Link2 />, group: "link", run: () => void copy(appLink(route), "链接") },
  ];
}
