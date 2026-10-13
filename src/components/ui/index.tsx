import { buttonBase, buttonVariants, buttonSizes } from "./template";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import {
  useRef,
  useId,
  isValidElement,
  cloneElement,
  type ReactElement,
} from "react";
import { animated, useSpring, useReducedMotion } from "@react-spring/web";
import { Dialog, Select } from "radix-ui";
import {
  Check,
  ChevronDown,
  X,
  Search,
  ArrowUpRight,
  Inbox,
} from "../../icons";
import { labels } from "../../data";
export function Button({
  children,
  variant = "",
  className = "",
  size,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: string;
  size?: "default" | "sm" | "lg" | "icon";
}) {
  const words = variant.split(" ");
  const kind = words.includes("primary")
    ? "default"
    : words.find((v) => v in buttonVariants) || "outline";
  const controlSize = size || (words.includes("small") ? "sm" : "default");
  return (
    <button
      type="button"
      {...props}
      data-slot="button"
      data-variant={kind}
      data-size={controlSize}
      className={`button ${buttonBase} ${buttonVariants[kind]} ${buttonSizes[controlSize]} ${className}`}
    >
      {children}
    </button>
  );
}
export function Badge({ state, label }: { state: string; label?: string }) {
  return (
    <span className={`badge ${state}`}>
      <span className="status-dot" />
      {label || labels[state] || state}
    </span>
  );
}
export function Pick({
  label,
  value,
  onChange,
  options,
  ...trigger
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  id?: string;
  disabled?: boolean;
  onBlur?: () => void;
  "aria-describedby"?: string;
  "aria-invalid"?: boolean;
}) {
  return (
    <Select.Root value={value} onValueChange={onChange}>
      <Select.Trigger
        {...trigger}
        className="select-trigger"
        aria-label={label}
      >
        <Select.Value />
        <ChevronDown size={14} />
      </Select.Trigger>
      <Select.Portal>
        <Select.Content
          className="select-content"
          position="popper"
          sideOffset={5}
        >
          <Select.Viewport>
            {options.map((o) => (
              <Select.Item
                key={o.value}
                value={o.value}
                className="select-item"
              >
                <Select.ItemText>{o.label}</Select.ItemText>
                <Select.ItemIndicator>
                  <Check size={14} />
                </Select.ItemIndicator>
              </Select.Item>
            ))}
          </Select.Viewport>
        </Select.Content>
      </Select.Portal>
    </Select.Root>
  );
}
export function Modal({
  open,
  close,
  title,
  description,
  children,
  wide = false,
}: {
  open: boolean;
  close: () => void;
  title: string;
  description: string;
  children: ReactNode;
  wide?: boolean;
}) {
  const returnFocus = useRef<HTMLElement | null>(null);
  const reduced = useReducedMotion();
  const motion = useSpring({
    opacity: open ? 1 : 0,
    y: open ? 0 : 5,
    config: { duration: 150 },
    immediate: !!reduced,
  });
  return (
    <Dialog.Root open={open} onOpenChange={(v) => !v && close()}>
      <Dialog.Portal>
        <Dialog.Overlay className="modal-overlay" />
        <Dialog.Content
          asChild
          onOpenAutoFocus={() => {
            returnFocus.current = document.activeElement as HTMLElement;
          }}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            if (returnFocus.current?.isConnected) returnFocus.current.focus();
          }}
        >
          <animated.div
            className={`modal ${wide ? "wide" : ""}`}
            style={{ opacity: motion.opacity, marginTop: motion.y }}
          >
            <div className="modal-heading">
              <div>
                <Dialog.Title>{title}</Dialog.Title>
                <Dialog.Description>{description}</Dialog.Description>
              </div>
              <Dialog.Close className="icon-button" aria-label="关闭对话框">
                <X size={19} />
              </Dialog.Close>
            </div>
            {children}
          </animated.div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
export function SearchBox({
  value,
  onChange,
  label = "搜索",
  placeholder = "搜索名称或引用…",
}: {
  value: string;
  onChange: (v: string) => void;
  label?: string;
  placeholder?: string;
}) {
  return (
    <div className="search-box">
      <Search size={16} />
      <input
        aria-label={label}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      {value && (
        <button aria-label="清除搜索" onClick={() => onChange("")}>
          <X size={14} />
        </button>
      )}
    </div>
  );
}
export function Empty({
  title = "没有匹配的结果",
  description = "调整范围或清除筛选，已有数据不会被删除。",
  action,
}: {
  title?: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty">
      <Inbox size={28} />
      <h3>{title}</h3>
      <p>{description}</p>
      {action}
    </div>
  );
}
export function ExternalLink({
  href,
  children,
}: {
  href: string;
  children: ReactNode;
}) {
  return (
    <a className="button" href={href} target="_blank" rel="noopener noreferrer">
      {children}
      <ArrowUpRight size={15} />
    </a>
  );
}
/** Field anatomy follows shadcn/ui; styling uses the existing CSS tokens. */
export function Field({
  label,
  hint,
  error,
  required,
  children,
}: {
  label: string;
  hint?: string;
  error?: string;
  required?: boolean;
  children: ReactNode;
}) {
  const uid = useId(),
    child = isValidElement(children)
      ? (children as ReactElement<Record<string, unknown>>)
      : null,
    id = String(child?.props.id || uid);
  const description =
    [hint ? id + "-hint" : null, error ? id + "-error" : null]
      .filter(Boolean)
      .join(" ") || undefined;
  return (
    <div data-slot="field" className="field" data-invalid={!!error}>
      <label htmlFor={id}>
        {label}
        {required && (
          <span className="field-required" aria-hidden="true">
            *
          </span>
        )}
      </label>
      {child
        ? cloneElement(child, {
            id,
            "aria-describedby": description,
            "aria-invalid": !!error,
            "aria-required": required || undefined,
          })
        : children}
      {hint && (
        <p className="field-description" id={id + "-hint"}>
          {hint}
        </p>
      )}
      {error && (
        <p className="field-error" id={id + "-error"} role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

/** Card anatomy adapted from AdminCN Free, MIT, pinned in docs/admincn-design.md. */
export function Card({
  children,
  className = "",
  ...props
}: React.HTMLAttributes<HTMLElement>) {
  return (
    <section data-slot="card" className={"ui-card " + className} {...props}>
      {children}
    </section>
  );
}
export function CardHeader({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div data-slot="card-header" className={"ui-card-header " + className}>
      {children}
    </div>
  );
}
export function CardContent({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div data-slot="card-content" className={"ui-card-content " + className}>
      {children}
    </div>
  );
}

export {
  Dialog,
  Select,
  AlertDialog,
  DropdownMenu,
  Popover,
  Checkbox,
  RadioGroup,
  Switch,
  Tooltip,
  Tabs,
  ContextMenu,
} from "radix-ui";
