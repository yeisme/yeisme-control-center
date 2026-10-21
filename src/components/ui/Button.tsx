import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { cx } from "./cx";

type Variant = "primary" | "secondary" | "ghost" | "quiet" | "danger";
type Size = "sm" | "md" | "icon" | "icon-sm";

const variants: Record<Variant, string> = {
  primary: "bg-primary text-primary-ink shadow-[0_1px_2px_rgb(0_0_0/12%)] hover:brightness-110 dark:hover:brightness-95",
  secondary: "bg-panel text-ink border border-line hover:border-line-strong hover:bg-panel-soft",
  ghost: "bg-transparent text-ink-soft hover:bg-panel-sunken hover:text-ink",
  quiet: "bg-transparent text-muted hover:text-ink",
  danger: "bg-danger-soft text-danger hover:brightness-95",
};

const sizes: Record<Size, string> = {
  sm: "h-8 gap-1.5 px-3 text-[13px]",
  md: "h-9 gap-2 px-3.5 text-sm",
  icon: "size-9 justify-center",
  "icon-sm": "size-8 justify-center",
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  icon?: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button({ variant = "secondary", size = "md", icon, className, children, type = "button", ...props }, ref) {
  return <button
    ref={ref}
    type={type}
    className={cx(
      "inline-flex shrink-0 select-none items-center whitespace-nowrap rounded-control font-medium transition-[background-color,border-color,color,filter,transform] duration-150 ease-out active:scale-[0.97] disabled:pointer-events-none disabled:opacity-45",
      variants[variant],
      sizes[size],
      className,
    )}
    {...props}
  >
    {icon}
    {children}
  </button>;
});
