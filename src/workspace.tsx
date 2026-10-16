import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useId,
  type ReactNode,
} from "react";
import { animated, useSpring, useReducedMotion } from "@react-spring/web";
import { Dialog, AlertDialog, DropdownMenu } from "./ui";
import {
  Check,
  CheckCircle2,
  ChevronLeft,
  Copy,
  GripVertical,
  Info,
  LoaderCircle,
  MoreHorizontal,
  X,
  Pin,
  PinOff,
  Maximize2,
  Minimize2,
} from "./icons";
import { finderSpring } from "./finder";

export function RightWorkspace({
  open,
  editing,
  title,
  subtitle,
  icon,
  status,
  tabs,
  footer,
  children,
  close,
  back,
  stage,
  context,
  objectKey,
  live = false,
  compact = false,
}: {
  open: boolean;
  editing: boolean;
  title: string;
  subtitle?: string;
  icon?: ReactNode;
  status?: ReactNode;
  tabs?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
  close: () => void;
  back?: () => void;
  stage: string;
  context: string;
  objectKey: string;
  live?: boolean;
  compact?: boolean;
}) {
  const [pinned, setPinned] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem("yeisme:v17:panels") || "{}").pinned === true;
    } catch {
      return false;
    }
  });
  const [expanded, setExpanded] = useState(false);
  const [width, setWidth] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem("yeisme:v17:panels") || "{}");
      return Number(saved[editing ? "form" : "detail"]) || (editing ? 520 : 360);
    } catch {
      return editing ? 520 : 360;
    }
  });
  const [viewport, setViewport] = useState(window.innerWidth);
  const [layoutWidth, setLayoutWidth] = useState(window.innerWidth - 232);
  const maxDockWidth = Math.min(640, layoutWidth - 560 - 48);
  const minPanelWidth = editing ? 520 : 360;
  const canPin = viewport >= 1440 && maxDockWidth >= minPanelWidth;
  const effectiveWidth = Math.max(minPanelWidth, Math.min(width, maxDockWidth));
  const floatingWidth = Math.max(minPanelWidth, Math.min(width, 640));
  const docked = pinned && !expanded && canPin;
  const floating = viewport > 700 && !expanded;
  const reducedMotion = useReducedMotion();
  const panelMotion = useSpring({
    opacity: open ? 1 : 0,
    config: finderSpring,
    x: expanded ? 0 : 8,
    immediate: !!reducedMotion,
  });
  useLayoutEffect(() => {
    const workspace = document.querySelector<HTMLElement>(".workspace");
    if (!workspace) return;
    const measure = () =>
      setLayoutWidth(workspace.getBoundingClientRect().width);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(workspace);
    return () => observer.disconnect();
  }, [open]);
  useEffect(() => {
    const resize = () => setViewport(window.innerWidth);
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, []);
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem("yeisme:v17:panels") || "{}");
      localStorage.setItem(
        "yeisme:v17:panels",
        JSON.stringify({ ...saved, pinned, [editing ? "form" : "detail"]: width }),
      );
    } catch {}
  }, [pinned, width, editing]);
  useLayoutEffect(() => {
    if (!open || !docked) return;
    document.documentElement.style.setProperty(
      "--workspace-dock-width",
      effectiveWidth + "px",
    );
    document.body.dataset.docked = "true";
    return () => {
      document.body.removeAttribute("data-docked");
      document.documentElement.style.removeProperty("--workspace-dock-width");
    };
  }, [open, docked, effectiveWidth]);
  const startResize = (event: React.PointerEvent<HTMLDivElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    const origin = event.clientX,
      initialWidth = effectiveWidth;
    const target = event.currentTarget;
    const move = (e: PointerEvent) =>
      setWidth(
        Math.max(
          minPanelWidth,
          Math.min(640, initialWidth + origin - e.clientX, maxDockWidth),
        ),
      );
    const end = () => {
      target.removeEventListener("pointermove", move);
      target.removeEventListener("pointerup", end);
    };
    target.addEventListener("pointermove", move);
    target.addEventListener("pointerup", end, { once: true });
  };
  const returnFocus = useRef<HTMLElement | null>(null);
  const panel = useRef<HTMLElement | null>(null);
  const body = useRef<HTMLDivElement | null>(null);
  useLayoutEffect(() => {
    if (open && editing && !floating) {
      const frame = requestAnimationFrame(() =>
        panel.current
          ?.querySelector<HTMLElement>("input:not([type=checkbox]),textarea")
          ?.focus({ preventScroll: true }),
      );
      return () => cancelAnimationFrame(frame);
    }
  }, [open, editing, objectKey]);
  const content = (
    <>
      <header className="workspace-header">
        <div className="workspace-heading-row">
          {back && (
            <button
              className="icon-button"
              aria-label="返回详情"
              onClick={back}
            >
              <ChevronLeft size={18} />
            </button>
          )}
          {icon && (
            <span className="workspace-object-icon" aria-hidden="true">
              {icon}
            </span>
          )}
          <div className="workspace-heading">
            <span className="workspace-eyebrow">{subtitle || "对象简介"}</span>
            <Dialog.Title tabIndex={-1}>{title}</Dialog.Title>
          </div>
          <DropdownMenu.Root>
            <DropdownMenu.Trigger
              className="icon-button"
              aria-label="详情更多操作"
            >
              <MoreHorizontal size={18} />
            </DropdownMenu.Trigger>
            <DropdownMenu.Portal>
              <DropdownMenu.Content className="admin-menu" align="end">
                <DropdownMenu.Item
                  className="admin-menu-item"
                  disabled={!canPin && !pinned}
                  onSelect={() => {
                    setPinned(!pinned);
                    setExpanded(false);
                  }}
                >
                  {pinned ? <PinOff size={16} /> : <Pin size={16} />}
                  {pinned ? "取消固定详情" : "固定详情"}
                </DropdownMenu.Item>
                {!canPin && (
                  <DropdownMenu.Label>
                    需为主区保留 560px 宽度
                  </DropdownMenu.Label>
                )}
                <DropdownMenu.Item
                  className="admin-menu-item"
                  onSelect={() => setExpanded(!expanded)}
                >
                  {expanded ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
                  {expanded ? "收起完整视图" : "展开完整视图"}
                </DropdownMenu.Item>
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>
          <button
            className="icon-button workspace-expand-toggle"
            aria-label={expanded ? "还原详情" : "展开全屏详情"}
            title={expanded ? "还原详情" : "展开全屏详情"}
            onClick={() => setExpanded((value) => !value)}
          >
            {expanded ? <Minimize2 size={18} /> : <Maximize2 size={18} />}
          </button>
          <button
            className="icon-button"
            aria-label="关闭详情"
            title={stage === "submitting" ? "收起，操作仍在进行" : "关闭工作区"}
            onClick={close}
          >
            <X size={18} />
          </button>
        </div>
        <div className="workspace-header-status" title={context}>
          {status}
          <span>
            <i />
            {stage === "submitting"
              ? "正在处理"
              : stage === "receipt"
                ? "操作回执"
                : live
                  ? "授权范围内只读"
                  : "设计样例 · 非实时数据"}
          </span>
        </div>
      </header>
      {tabs && <div className="workspace-tabs">{tabs}</div>}
      <div
        ref={body}
        className={
          "workspace-content " + (editing ? "editor" : "inspector-body")
        }
      >
        {children}
      </div>
      {footer && <footer className="workspace-footer">{footer}</footer>}
    </>
  );
  return (
    <Dialog.Root
      modal={!docked && !floating && !expanded}
      open={open}
      onOpenChange={(value) => !value && close()}
    >
      <Dialog.Portal>
        {!docked && !floating && !expanded && (
          <Dialog.Overlay className="workspace-overlay" />
        )}
        <Dialog.Content
          asChild
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            if (!returnFocus.current?.isConnected) {
              const active = document.activeElement as HTMLElement;
              if (!panel.current?.contains(active))
                returnFocus.current = active;
            }
            if (floating) return;
            (
              panel.current?.querySelector<HTMLElement>(
                editing ? "input:not([type=checkbox]),textarea,button" : "h2",
              ) || panel.current
            )?.focus({ preventScroll: true });
          }}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            // Scope replacement can unmount one Sheet and immediately open another.
            if (
              document.querySelector(
                '[data-slot="sheet-content"][data-state="open"]',
              )
            )
              return;
            const target = returnFocus.current?.isConnected
              ? returnFocus.current
              : document.querySelector<HTMLElement>(
                  '[data-object-id][aria-selected="true"],.finder-location',
                );
            requestAnimationFrame(() => {
              if (
                !document.querySelector(
                  '[data-slot="sheet-content"][data-state="open"]',
                )
              )
                target?.focus({ preventScroll: true });
            });
            returnFocus.current = null;
          }}
          onEscapeKeyDown={(event) => {
            if (document.querySelector('.task-preview-dialog[data-state="open"]')) {
              event.preventDefault();
              return;
            }
            if (expanded) {
              event.preventDefault();
              setExpanded(false);
            }
          }}
          onInteractOutside={(event) => {
            if (docked || floating || expanded) event.preventDefault();
          }}
          onPointerDownOutside={(event) => {
            if (docked || floating || expanded) {
              event.preventDefault();
              return;
            }
            // Portalled menus and confirmation dialogs own their dismissal.
            if (
              (event.target as HTMLElement)?.closest(
                '[role="alertdialog"],[role="listbox"],[role="menu"],[data-radix-popper-content-wrapper],[data-task-preview],.task-preview-dialog',
              )
            ) {
              event.preventDefault();
              return;
            }
            event.preventDefault();
            close();
          }}
        >
          <animated.div
            ref={panel as React.RefObject<HTMLDivElement>}
            className={
              "inspector right-workspace drawer " +
              (editing ? "editing " : "") +
              (compact ? "compact-sheet " : "") +
              (docked ? "docked " : "") +
              (expanded ? "expanded" : "")
            }
            style={{
              opacity: panelMotion.opacity,
              transform: panelMotion.x.to((x) => `translateX(${x}px)`),
              ...(docked ? { width: effectiveWidth } : {}),
              ...(floating
                ? ({ "--floating-width": `${floatingWidth}px` } as React.CSSProperties)
                : {}),
            }}
            aria-label="详情与上下文"
            aria-describedby={undefined}
            data-stage={stage}
            data-slot="sheet-content"
            data-mode={
              expanded
                ? "workspace"
                : docked
                  ? "dock"
                  : floating
                    ? "float"
                    : "modal"
            }
          >
            {docked && (
              <div
                className="workspace-resizer"
                role="separator"
                aria-label="调整详情宽度"
                aria-orientation="vertical"
                aria-valuemin={minPanelWidth}
                aria-valuemax={maxDockWidth}
                aria-valuenow={effectiveWidth}
                tabIndex={0}
                onPointerDown={startResize}
                onKeyDown={(e) => {
                  if (["ArrowLeft", "ArrowRight"].includes(e.key)) {
                    e.preventDefault();
                    setWidth((w) =>
                      Math.max(
                        minPanelWidth,
                        Math.min(
                          640,
                          w + (e.key === "ArrowLeft" ? 16 : -16),
                          maxDockWidth,
                        ),
                      ),
                    );
                  }
                }}
              />
            )}
            {content}
          </animated.div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export function WorkspaceEditor({
  children,
  footer,
  onSubmit,
  busy = false,
}: {
  children: ReactNode;
  footer: ReactNode;
  onSubmit?: () => void;
  busy?: boolean;
}) {
  return (
    <form
      className="workspace-editor"
      aria-busy={busy}
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        if (!busy) onSubmit?.();
      }}
    >
      <fieldset className="editor-scroll" disabled={busy}>
        {children}
      </fieldset>
      <footer className="editor-footer">{footer}</footer>
    </form>
  );
}
export function FormSection({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <fieldset className="form-section">
      <legend>{title}</legend>
      {description && <p className="field-description">{description}</p>}
      <div className="form-section-fields">{children}</div>
    </fieldset>
  );
}
export function PanelNotice({
  title,
  children,
  tone = "info",
}: {
  title: string;
  children?: ReactNode;
  tone?: "info" | "warning" | "error" | "success";
}) {
  return (
    <div
      className={"panel-notice " + tone}
      role={tone === "error" ? "alert" : undefined}
    >
      {tone === "success" ? <CheckCircle2 size={17} /> : <Info size={17} />}
      <div>
        <strong>{title}</strong>
        {children && <div>{children}</div>}
      </div>
    </div>
  );
}
export function DraftGuard({
  open,
  cancel,
  discard,
}: {
  open: boolean;
  cancel: () => void;
  discard: () => void;
}) {
  const discarding = useRef(false);
  useEffect(() => {
    if (open) discarding.current = false;
  }, [open]);
  return (
    <AlertDialog.Root open={open} onOpenChange={(v) => !v && cancel()}>
      <AlertDialog.Portal>
        <AlertDialog.Overlay className="modal-overlay" />
        <AlertDialog.Content
          className="draft-dialog"
          onCloseAutoFocus={(e) => {
            if (!discarding.current) {
              e.preventDefault();
              requestAnimationFrame(() =>
                document
                  .querySelector<HTMLElement>(
                    ".workspace-editor input,.workspace-editor textarea",
                  )
                  ?.focus(),
              );
            }
          }}
        >
          <AlertDialog.Title>保留未保存的修改？</AlertDialog.Title>
          <AlertDialog.Description>
            继续编辑会保留当前草稿；放弃后将恢复已保存的内容。
          </AlertDialog.Description>
          <div className="button-row">
            <AlertDialog.Cancel className="button" onClick={cancel}>
              继续编辑
            </AlertDialog.Cancel>
            <AlertDialog.Action
              className="button destructive"
              onClick={() => {
                discarding.current = true;
                discard();
              }}
            >
              放弃修改
            </AlertDialog.Action>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}
export function CopyReference({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      if (navigator.clipboard && isSecureContext)
        await navigator.clipboard.writeText(value);
      else {
        const t = document.createElement("textarea");
        t.value = value;
        t.style.position = "fixed";
        t.style.opacity = "0";
        document.body.append(t);
        t.select();
        if (!document.execCommand("copy")) throw Error("clipboard");
        t.remove();
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  };
  return (
    <span className="copy-reference">
      <code>{value}</code>
      <button
        className="icon-button"
        type="button"
        aria-label={"复制引用 " + value}
        onClick={copy}
      >
        {copied ? <Check size={13} /> : <Copy size={13} />}
      </button>
      <span className="sr-only" role="status">
        {copied ? "引用已复制" : ""}
      </span>
    </span>
  );
}
export function WorkspaceActions({
  children,
  secondary,
}: {
  children: ReactNode;
  secondary?: { label: string; action: () => void }[];
}) {
  return (
    <div className="workspace-actions">
      {children}
      {secondary?.length ? (
        <DropdownMenu.Root>
          <DropdownMenu.Trigger className="button" aria-label="更多对象操作">
            <MoreHorizontal size={18} />
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content className="finder-menu" sideOffset={6}>
              {secondary.map((item) => (
                <DropdownMenu.Item key={item.label} onSelect={item.action}>
                  {item.label}
                </DropdownMenu.Item>
              ))}
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
      ) : null}
    </div>
  );
}
