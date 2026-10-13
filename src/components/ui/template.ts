// AdminCN Free dd1afd2f (MIT): button utilities adapted to native/Radix controls.
// Preserve the template's variants; legacy callers use primary and small aliases.
export const buttonBase =
  "group/button focus-visible:border-ring focus-visible:ring-ring/50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 inline-flex shrink-0 items-center justify-center rounded-md border border-transparent bg-clip-padding text-sm font-medium whitespace-nowrap transition-[color,background-color,border-color,box-shadow] outline-none select-none focus-visible:ring-3 active:not-aria-[haspopup]:translate-y-px disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4";
export const buttonVariants: Record<string, string> = {
  default: "bg-primary text-primary-foreground hover:bg-primary/80",
  outline:
    "border-border bg-background hover:bg-muted hover:text-foreground aria-expanded:bg-muted dark:border-input dark:bg-input/30 dark:hover:bg-input/50 shadow-xs",
  secondary: "bg-secondary text-secondary-foreground hover:bg-secondary/80",
  ghost:
    "hover:bg-muted hover:text-foreground aria-expanded:bg-muted dark:hover:bg-muted/50",
  destructive:
    "bg-destructive/10 text-destructive hover:bg-destructive/20 focus-visible:border-destructive/40 focus-visible:ring-destructive/20",
  link: "text-primary underline-offset-4 hover:underline",
};
export const buttonSizes: Record<string, string> = {
  default: "h-9 gap-1.5 px-3",
  sm: "h-8 gap-1 rounded-md px-2.5 text-xs",
  lg: "h-10 gap-1.5 px-4",
  icon: "size-9 p-0",
};
