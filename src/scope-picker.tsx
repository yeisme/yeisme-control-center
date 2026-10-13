import {
  useState,
  Children,
  isValidElement,
  type ReactNode,
  type ReactElement,
} from "react";
import { Field } from "./ui";
import { Popover } from "./ui";
import { ChevronDown, X } from "./icons";
export function ScopePicker({
  summary,
  environment,
  children,
}: {
  summary: string;
  environment?: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          className="scope-trigger"
          aria-label="选择工作范围"
          title={[summary, environment].filter(Boolean).join(" · ")}
        >
          <span>{summary}</span>
          {environment && (
            <small className="scope-environment">{environment}</small>
          )}
          <ChevronDown size={14} />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          className="scope-popover"
          align="start"
          sideOffset={9}
          collisionPadding={12}
          aria-label="工作范围"
        >
          <header>
            <strong>工作范围</strong>
            <Popover.Close className="icon-button" aria-label="收起工作范围">
              <X size={16} />
            </Popover.Close>
          </header>
          <div className="scope-fields">
            {Children.toArray(children).map((child, i) => {
              const label = isValidElement(child)
                ? (child as ReactElement<{ label?: string }>).props.label
                : undefined;
              return label ? (
                <Field key={label} label={label}>
                  {child}
                </Field>
              ) : (
                <span key={i}>{child}</span>
              );
            })}
          </div>
          <footer>切换范围后，只显示当前授权的数据。</footer>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
