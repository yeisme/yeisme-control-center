import { useRef, type ReactNode } from "react";
import { ContextMenu, Dialog, DropdownMenu, Popover } from "radix-ui";
import { X } from "../../icons";
import { cx } from "./cx";
import { Button } from "./Button";

/**
 * Right-hand detail workspace on desktop, full-screen sheet below 640px. Radix provides Esc and the focus trap;
 * the opener is remembered at mount because URL-driven sheets re-render the list and lose Radix's restore target.
 */
export function DetailSheet({ open, onOpenChange, title, eyebrow, description, actions, children, footer, width = "md", returnFocus }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  eyebrow?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  width?: "md" | "lg";
  /** Selector of the element that should regain focus on close when the original opener was re-rendered. */
  returnFocus?: string;
}) {
  const opener = useRef<Element | null>(null);
  if (opener.current === null && typeof document !== "undefined") opener.current = document.activeElement;
  const restore = (event: Event) => {
    const target = opener.current instanceof HTMLElement && opener.current.isConnected ? opener.current : returnFocus ? document.querySelector<HTMLElement>(returnFocus) : null;
    if (!target) return;
    event.preventDefault();
    target.focus({ preventScroll: true });
  };
  return <Dialog.Root open={open} onOpenChange={onOpenChange}>
    <Dialog.Portal>
      <Dialog.Overlay className="fade-in fixed inset-0 z-40 backdrop-blur-[1px]" style={{ background: "var(--scrim)" }} />
      <Dialog.Content
        aria-describedby={undefined}
        onCloseAutoFocus={restore}
        className={cx(
          "fixed z-50 flex flex-col bg-panel text-ink shadow-float outline-none",
          "inset-0 sheet-in-bottom",
          "sm:inset-y-3 sm:right-3 sm:left-auto sm:rounded-[16px] sm:border sm:border-line sm:sheet-in",
          width === "lg" ? "sm:w-[min(640px,calc(100vw-24px))]" : "sm:w-[min(480px,calc(100vw-24px))]",
        )}
      >
        <header className="flex items-start gap-3 border-b border-line px-5 pb-4 pt-[max(16px,env(safe-area-inset-top))]">
          <div className="min-w-0 flex-1">
            {eyebrow && <p className="text-2xs font-medium text-muted">{eyebrow}</p>}
            <Dialog.Title className="mt-0.5 text-[17px] font-semibold leading-snug text-ink break-words">{title}</Dialog.Title>
            {description && <Dialog.Description className="mt-1 text-[13px] text-muted">{description}</Dialog.Description>}
          </div>
          <div className="flex shrink-0 items-center gap-1">
            {actions}
            <Dialog.Close asChild>
              <Button variant="ghost" size="icon-sm" aria-label="关闭详情"><X className="size-4" /></Button>
            </Dialog.Close>
          </div>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-4">{children}</div>
        {footer && <footer className="border-t border-line px-5 py-3 pb-[max(12px,env(safe-area-inset-bottom))]">{footer}</footer>}
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>;
}

export const MenuRoot = DropdownMenu.Root;
export const MenuTrigger = DropdownMenu.Trigger;

export function MenuContent({ children, align = "end", className }: { children: ReactNode; align?: "start" | "end" | "center"; className?: string }) {
  return <DropdownMenu.Portal>
    <DropdownMenu.Content align={align} sideOffset={6} collisionPadding={8} className={cx("pop-in z-50 min-w-56 rounded-[12px] border border-line bg-panel p-1.5 text-ink shadow-float outline-none", className)}>
      {children}
    </DropdownMenu.Content>
  </DropdownMenu.Portal>;
}

export function MenuItem({ children, icon, onSelect, disabled, tone }: { children: ReactNode; icon?: ReactNode; onSelect?: () => void; disabled?: boolean; tone?: "danger" }) {
  return <DropdownMenu.Item disabled={disabled} onSelect={onSelect} className={cx(
    "flex h-9 cursor-default select-none items-center gap-2.5 rounded-[8px] px-2.5 text-[13px] outline-none data-[disabled]:opacity-45 data-[highlighted]:bg-panel-sunken [&>svg]:size-4 [&>svg]:text-muted",
    tone === "danger" && "text-danger [&>svg]:text-danger",
  )}>
    {icon}
    {children}
  </DropdownMenu.Item>;
}

export function MenuLabel({ children }: { children: ReactNode }) {
  return <DropdownMenu.Label className="px-2.5 pb-1.5 pt-1 text-2xs font-medium text-muted">{children}</DropdownMenu.Label>;
}

export function MenuSeparator() {
  return <DropdownMenu.Separator className="my-1.5 h-px bg-line" />;
}

export const ContextMenuRoot = ContextMenu.Root;
export const ContextMenuTrigger = ContextMenu.Trigger;

export function ContextMenuContent({ children, className }: { children: ReactNode; className?: string }) {
  return <ContextMenu.Portal>
    <ContextMenu.Content collisionPadding={8} className={cx("pop-in z-50 min-w-56 rounded-[12px] border border-line bg-panel p-1.5 text-ink shadow-float outline-none", className)}>
      {children}
    </ContextMenu.Content>
  </ContextMenu.Portal>;
}

export function ContextMenuItem({ children, icon, onSelect, disabled, tone }: { children: ReactNode; icon?: ReactNode; onSelect?: () => void; disabled?: boolean; tone?: "danger" }) {
  return <ContextMenu.Item disabled={disabled} onSelect={onSelect} className={cx(
    "flex h-9 cursor-default select-none items-center gap-2.5 rounded-[8px] px-2.5 text-[13px] outline-none data-[disabled]:opacity-45 data-[highlighted]:bg-panel-sunken [&>svg]:size-4 [&>svg]:text-muted",
    tone === "danger" && "text-danger [&>svg]:text-danger",
  )}>
    {icon}
    {children}
  </ContextMenu.Item>;
}

export function ContextMenuSeparator() {
  return <ContextMenu.Separator className="my-1.5 h-px bg-line" />;
}

export const PopoverRoot = Popover.Root;
export const PopoverTrigger = Popover.Trigger;

export function PopoverContent({ children, className, align = "end" }: { children: ReactNode; className?: string; align?: "start" | "end" | "center" }) {
  return <Popover.Portal>
    <Popover.Content align={align} sideOffset={8} collisionPadding={8} className={cx("pop-in z-50 rounded-[14px] border border-line bg-panel text-ink shadow-float outline-none", className)}>
      {children}
    </Popover.Content>
  </Popover.Portal>;
}
