import type { ReactNode } from "react";
import { Checkbox as RadixCheckbox, Tabs as RadixTabs, ToggleGroup as RadixToggleGroup } from "radix-ui";
import { Check, Minus } from "../../icons";
import { cx } from "./cx";

interface Option<T extends string> {
  id: T;
  label: ReactNode;
  count?: number | null;
  disabled?: boolean;
}

const segment = "inline-flex h-8 items-center gap-1.5 whitespace-nowrap rounded-[7px] px-3 text-[13px] font-medium text-muted transition-[background-color,color,box-shadow] duration-150 hover:text-ink disabled:pointer-events-none disabled:opacity-45 data-[state=active]:bg-panel data-[state=active]:text-ink data-[state=active]:shadow-[0_1px_2px_rgb(0_0_0/8%)] data-[state=on]:bg-panel data-[state=on]:text-ink data-[state=on]:shadow-[0_1px_2px_rgb(0_0_0/8%)]";
const track = "inline-flex max-w-full items-center gap-0.5 overflow-x-auto rounded-control bg-panel-sunken p-0.5";

function Count({ value }: { value?: number | null }) {
  if (value === undefined || value === null) return null;
  return <span className="tabular rounded px-1 text-2xs text-faint">{value}</span>;
}

/** Real tabs: arrow keys move between triggers and each trigger controls a `TabPanel`. */
export function Tabs<T extends string>({ value, onChange, options, label, children, className, listClassName }: { value: T; onChange: (value: T) => void; options: Option<T>[]; label: string; children: ReactNode; className?: string; listClassName?: string }) {
  return <RadixTabs.Root value={value} onValueChange={(next) => onChange(next as T)} className={className}>
    <RadixTabs.List aria-label={label} className={cx(track, listClassName)}>
      {options.map((option) => <RadixTabs.Trigger key={option.id} value={option.id} disabled={option.disabled} className={segment}>
        {option.label}
        <Count value={option.count} />
      </RadixTabs.Trigger>)}
    </RadixTabs.List>
    {children}
  </RadixTabs.Root>;
}

export function TabPanel({ value, children, className }: { value: string; children: ReactNode; className?: string }) {
  return <RadixTabs.Content value={value} className={cx("outline-none", className)}>{children}</RadixTabs.Content>;
}

/** Single-choice filter (not navigation): exactly one option stays pressed. */
export function ToggleGroup<T extends string>({ value, onChange, options, label, className }: { value: T; onChange: (value: T) => void; options: Option<T>[]; label: string; className?: string }) {
  return <RadixToggleGroup.Root type="single" value={value} onValueChange={(next) => { if (next) onChange(next as T); }} aria-label={label} className={cx(track, className)}>
    {options.map((option) => <RadixToggleGroup.Item key={option.id} value={option.id} disabled={option.disabled} className={segment}>
      {option.label}
      <Count value={option.count} />
    </RadixToggleGroup.Item>)}
  </RadixToggleGroup.Root>;
}

export function Checkbox({ checked, onChange, label, className, disabled }: { checked: boolean | "indeterminate"; onChange: (checked: boolean) => void; label: string; className?: string; disabled?: boolean }) {
  return <RadixCheckbox.Root
    checked={checked}
    disabled={disabled}
    onCheckedChange={(next) => onChange(next === true)}
    aria-label={label}
    className={cx("grid size-4 shrink-0 place-items-center rounded-[4px] border border-line-strong bg-panel text-primary-ink transition-colors duration-150 hover:border-primary data-[state=checked]:border-primary data-[state=checked]:bg-primary data-[state=indeterminate]:border-primary data-[state=indeterminate]:bg-primary disabled:opacity-45", className)}
  >
    <RadixCheckbox.Indicator className="[&>svg]:size-3">{checked === "indeterminate" ? <Minus /> : <Check />}</RadixCheckbox.Indicator>
  </RadixCheckbox.Root>;
}
