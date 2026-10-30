import { Fragment, useRef, type ComponentType, type KeyboardEvent, type ReactElement, type ReactNode } from "react";
import { MoreHorizontal } from "../../icons";
import { IconButton } from "./Button";
import { ContextMenuContent, ContextMenuItem, ContextMenuRoot, ContextMenuSeparator, ContextMenuTrigger, MenuContent, MenuItem, MenuRoot, MenuSeparator, MenuTrigger } from "./Overlay";

/** One thing a user can do with an item. The same list feeds the item's "更多操作" menu and its context menu. */
export interface ItemAction {
  id: string;
  label: string;
  icon?: ReactNode;
  disabled?: boolean;
  /** Why the action is unavailable, shown after the label. */
  disabledReason?: string;
  tone?: "danger";
  /** Actions of different groups are separated by a line, in the order the groups first appear. */
  group?: string;
  run: () => void;
}

/** Consecutive runs of one group, in order; an action without a group joins the run before it. */
export function actionGroups(actions: ItemAction[]): ItemAction[][] {
  const runs: ItemAction[][] = [];
  for (const action of actions) {
    const last = runs[runs.length - 1];
    if (last && (action.group === undefined || action.group === last[0].group)) last.push(action);
    else runs.push([action]);
  }
  return runs;
}

type ItemProps = { children: ReactNode; icon?: ReactNode; onSelect?: () => void; disabled?: boolean; tone?: "danger" };

/** Renders actions with the given item and separator; menus and context menus differ only in those two. */
export function renderActions(actions: ItemAction[], Item: ComponentType<ItemProps>, Separator: ComponentType) {
  return actionGroups(actions).map((run, index) => (
    <Fragment key={run[0].id}>
      {index > 0 && <Separator />}
      {run.map((action) => (
        <Item key={action.id} icon={action.icon} disabled={action.disabled} tone={action.tone} onSelect={action.run}>
          <span className="min-w-0 flex-1 truncate">{action.label}</span>
          {action.disabled && action.disabledReason && <span className="shrink-0 pl-3 text-2xs text-muted">{action.disabledReason}</span>}
        </Item>
      ))}
    </Fragment>
  ));
}

export function ActionMenuItems({ actions, context = false }: { actions: ItemAction[]; context?: boolean }) {
  return <>{context ? renderActions(actions, ContextMenuItem, ContextMenuSeparator) : renderActions(actions, MenuItem, MenuSeparator)}</>;
}

/** The visible "更多操作" button. Nothing renders when there is nothing to do. */
export function ActionsMenu({ actions, label, align = "end", className }: { actions: ItemAction[]; label: string; align?: "start" | "end" | "center"; className?: string }) {
  if (!actions.length) return null;
  return (
    <MenuRoot>
      <MenuTrigger asChild>
        <IconButton label={label} icon={<MoreHorizontal className="size-4" />} className={className} onClick={(event) => event.stopPropagation()} />
      </MenuTrigger>
      <MenuContent align={align}>
        <ActionMenuItems actions={actions} />
      </MenuContent>
    </MenuRoot>
  );
}

/** Shift+F10 and the Menu key open the context menu where the focus is, like a right click there. */
function openFromKeyboard(event: KeyboardEvent<HTMLElement>) {
  if (event.key !== "ContextMenu" && !(event.key === "F10" && event.shiftKey)) return;
  event.preventDefault();
  const target = event.currentTarget;
  const focused = document.activeElement instanceof HTMLElement && target.contains(document.activeElement) ? document.activeElement : target;
  const rect = focused.getBoundingClientRect();
  target.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: rect.left + Math.min(24, rect.width / 2), clientY: rect.bottom }));
}

/**
 * Wraps one element (a row, card or link) so a right click, a long press or Shift+F10 opens the same actions as its
 * "更多操作" menu. Closing returns focus to what had it inside the element, unless the user clicked elsewhere.
 */
export function ActionsContextMenu({ actions, children }: { actions: ItemAction[]; children: ReactElement }) {
  const trigger = useRef<HTMLElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const pointer = useRef({ type: "", at: 0 });
  const swallowClickUntil = useRef(0);
  const outside = useRef(false);
  if (!actions.length) return children;
  return (
    <ContextMenuRoot onOpenChange={(open) => {
      if (!open) return;
      // Only a touch long press ends in a click on the element; a right click or Shift+F10 does not.
      const touch = pointer.current.type === "touch" && Date.now() - pointer.current.at < 2_000;
      swallowClickUntil.current = touch ? Date.now() + 1_000 : 0;
      outside.current = false;
      const active = document.activeElement;
      opener.current = trigger.current && active instanceof HTMLElement && trigger.current.contains(active) ? active : null;
    }}>
      <ContextMenuTrigger
        asChild
        ref={trigger}
        onKeyDown={openFromKeyboard}
        onPointerDown={(event) => { pointer.current = { type: event.pointerType, at: Date.now() }; }}
        // A long press opens the menu; the click that ends that touch must not also open the item.
        onClickCapture={(event) => {
          if (Date.now() >= swallowClickUntil.current) return;
          swallowClickUntil.current = 0;
          event.preventDefault();
          event.stopPropagation();
        }}
      >
        {children}
      </ContextMenuTrigger>
      <ContextMenuContent
        onInteractOutside={() => { outside.current = true; }}
        onCloseAutoFocus={(event) => {
          if (!outside.current && opener.current?.isConnected) {
            event.preventDefault();
            opener.current.focus({ preventScroll: true });
          }
          outside.current = false;
        }}
      >
        <ActionMenuItems actions={actions} context />
      </ContextMenuContent>
    </ContextMenuRoot>
  );
}
