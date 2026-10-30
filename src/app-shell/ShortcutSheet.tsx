import { useRef } from "react";
import { Dialog } from "radix-ui";
import { Keyboard, X } from "../icons";
import { Kbd } from "../components/ui";
import { modifierLabel, shortcutGroups } from "../shared/keyboard";

/** Shortcut reference opened with `?`; the entries come from the same table the shell, lists and viewer implement. */
export function ShortcutSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const groups = shortcutGroups(modifierLabel(typeof navigator === "undefined" ? "" : navigator.userAgent));
  const content = useRef<HTMLDivElement>(null);
  return <Dialog.Root open={open} onOpenChange={onOpenChange}>
    <Dialog.Portal>
      <Dialog.Overlay className="fade-in fixed inset-0 z-[60]" style={{ background: "var(--scrim)" }} />
      <Dialog.Content
        ref={content}
        tabIndex={-1}
        aria-describedby={undefined}
        data-shortcut-sheet
        // Focus the sheet, not its close button: opened from the palette with Enter, the same key press would activate that button.
        onOpenAutoFocus={(event) => { event.preventDefault(); content.current?.focus(); }}
        className="pop-in fixed inset-x-3 top-[10vh] z-[61] mx-auto max-h-[80vh] max-w-[680px] overflow-y-auto rounded-[16px] border border-line bg-panel p-5 text-ink shadow-float outline-none"
      >
        <div className="flex items-center gap-2.5">
          <Keyboard aria-hidden="true" className="size-4 text-muted" />
          <Dialog.Title className="flex-1 text-base font-semibold">键盘快捷键</Dialog.Title>
          <Dialog.Close aria-label="关闭快捷键表" className="grid size-8 place-items-center rounded-[8px] text-muted hover:bg-panel-sunken hover:text-ink focus-visible:outline-2 focus-visible:outline-focus"><X className="size-4" /></Dialog.Close>
        </div>
        <div className="mt-4 grid gap-x-8 gap-y-5 sm:grid-cols-2">
          {groups.map((group) => <section key={group.title} aria-labelledby={`shortcut-group-${group.title}`} className={group.title === "列表" ? "sm:row-span-2" : undefined}>
            <h3 id={`shortcut-group-${group.title}`} className="text-2xs font-medium text-muted">{group.title}</h3>
            <dl className="mt-2 divide-y divide-line">
              {group.entries.map((entry) => <div key={entry.action} className="flex items-center justify-between gap-4 py-2 text-body-sm">
                <dt className="min-w-0 text-ink-soft">{entry.action}</dt>
                <dd className="flex shrink-0 items-center gap-1">{entry.keys.map((key) => <Kbd key={key}>{key}</Kbd>)}</dd>
              </div>)}
            </dl>
          </section>)}
        </div>
        <p className="mt-4 text-2xs text-muted">在输入框里输入，或者有弹窗打开时，<Kbd>/</Kbd> 和 <Kbd>?</Kbd> 不会触发。</p>
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>;
}
