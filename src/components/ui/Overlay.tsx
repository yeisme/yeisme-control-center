import { useRef, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";
import { ContextMenu, Dialog, DropdownMenu, Popover } from "radix-ui";
import { Check, X } from "../../icons";
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
    const target = opener.current instanceof HTMLElement && opener.current !== document.body && opener.current.isConnected ? opener.current : returnFocus ? document.querySelector<HTMLElement>(returnFocus) : null;
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

// Menus sit above every panel: the task inspector (55) and the media viewer (71) included.
const menuSurface = "pop-in z-[80] rounded-[12px] border border-line bg-panel p-1.5 text-ink shadow-float outline-none";
const menuPanel = cx(menuSurface, "min-w-56 max-w-[min(360px,calc(100vw-16px))]");
// A context menu opens where the pointer is; on a phone neither side of a mid-screen press fits 14rem, so it narrows to
// the room Radix measured there (labels truncate) instead of running off the screen.
const contextPanel = cx(menuSurface, "min-w-[min(14rem,var(--radix-context-menu-content-available-width))] max-w-[min(360px,var(--radix-context-menu-content-available-width))]");
const menuItem = (tone?: "danger") => cx(
  "flex h-9 cursor-default select-none items-center gap-2.5 rounded-[8px] px-2.5 text-[13px] outline-none data-[disabled]:opacity-45 data-[highlighted]:bg-panel-sunken [&>svg]:size-4 [&>svg]:shrink-0 [&>svg]:text-muted",
  tone === "danger" && "text-danger [&>svg]:text-danger",
);
const checkItem = "flex h-9 cursor-default select-none items-center gap-2.5 rounded-[8px] px-2.5 text-[13px] outline-none data-[highlighted]:bg-panel-sunken";
const menuLabel = "px-2.5 pb-1.5 pt-1 text-2xs font-medium text-muted";
const menuSeparator = "my-1.5 h-px bg-line";
// Menus render in a portal, yet React still bubbles their clicks to the trigger's ancestors (a clickable row or card).
const keepClicksInside = (event: ReactMouseEvent) => event.stopPropagation();

export const MenuRoot = DropdownMenu.Root;
export const MenuTrigger = DropdownMenu.Trigger;

export function MenuContent({ children, align = "end", className }: { children: ReactNode; align?: "start" | "end" | "center"; className?: string }) {
  return <DropdownMenu.Portal>
    <DropdownMenu.Content align={align} sideOffset={6} collisionPadding={8} onClick={keepClicksInside} className={cx(menuPanel, className)}>
      {children}
    </DropdownMenu.Content>
  </DropdownMenu.Portal>;
}

export function MenuItem({ children, icon, onSelect, disabled, tone }: { children: ReactNode; icon?: ReactNode; onSelect?: () => void; disabled?: boolean; tone?: "danger" }) {
  return <DropdownMenu.Item disabled={disabled} onSelect={onSelect} className={menuItem(tone)}>
    {icon}
    {children}
  </DropdownMenu.Item>;
}

/** A menu entry that switches a setting; assistive tech hears it as checked or not. */
export function MenuCheckboxItem({ children, checked, onCheckedChange }: { children: ReactNode; checked: boolean; onCheckedChange: (checked: boolean) => void }) {
  return <DropdownMenu.CheckboxItem checked={checked} onCheckedChange={onCheckedChange} onSelect={(event) => event.preventDefault()} className={checkItem}>
    <span aria-hidden="true" className="grid size-4 shrink-0 place-items-center text-muted"><DropdownMenu.ItemIndicator><Check className="size-4" /></DropdownMenu.ItemIndicator></span>
    {children}
  </DropdownMenu.CheckboxItem>;
}

export function MenuLabel({ children }: { children: ReactNode }) {
  return <DropdownMenu.Label className={menuLabel}>{children}</DropdownMenu.Label>;
}

export function MenuSeparator() {
  return <DropdownMenu.Separator className={menuSeparator} />;
}

export const ContextMenuRoot = ContextMenu.Root;
export const ContextMenuTrigger = ContextMenu.Trigger;

export function ContextMenuContent({ children, className, onCloseAutoFocus, onInteractOutside }: { children: ReactNode; className?: string; onCloseAutoFocus?: (event: Event) => void; onInteractOutside?: () => void }) {
  return <ContextMenu.Portal>
    <ContextMenu.Content collisionPadding={8} onClick={keepClicksInside} onCloseAutoFocus={onCloseAutoFocus} onInteractOutside={onInteractOutside} className={cx(contextPanel, className)}>
      {children}
    </ContextMenu.Content>
  </ContextMenu.Portal>;
}

export function ContextMenuItem({ children, icon, onSelect, disabled, tone }: { children: ReactNode; icon?: ReactNode; onSelect?: () => void; disabled?: boolean; tone?: "danger" }) {
  return <ContextMenu.Item disabled={disabled} onSelect={onSelect} className={menuItem(tone)}>
    {icon}
    {children}
  </ContextMenu.Item>;
}

export function ContextMenuCheckboxItem({ children, checked, onCheckedChange }: { children: ReactNode; checked: boolean; onCheckedChange: (checked: boolean) => void }) {
  return <ContextMenu.CheckboxItem checked={checked} onCheckedChange={onCheckedChange} onSelect={(event) => event.preventDefault()} className={checkItem}>
    <span aria-hidden="true" className="grid size-4 shrink-0 place-items-center text-muted"><ContextMenu.ItemIndicator><Check className="size-4" /></ContextMenu.ItemIndicator></span>
    {children}
  </ContextMenu.CheckboxItem>;
}

export function ContextMenuLabel({ children }: { children: ReactNode }) {
  return <ContextMenu.Label className={menuLabel}>{children}</ContextMenu.Label>;
}

export function ContextMenuSeparator() {
  return <ContextMenu.Separator className={menuSeparator} />;
}

export const PopoverRoot = Popover.Root;
export const PopoverTrigger = Popover.Trigger;

/** Popover panel. Radix gives it the dialog role, so `label` names it for assistive tech. */
export function PopoverContent({ children, className, align = "end", label }: { children: ReactNode; className?: string; align?: "start" | "end" | "center"; label: string }) {
  return <Popover.Portal>
    <Popover.Content aria-label={label} align={align} sideOffset={8} collisionPadding={8} className={cx("pop-in z-50 rounded-[14px] border border-line bg-panel text-ink shadow-float outline-none", className)}>
      {children}
    </Popover.Content>
  </Popover.Portal>;
}
