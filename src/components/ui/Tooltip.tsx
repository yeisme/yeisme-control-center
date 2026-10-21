import type { ReactNode } from "react";
import { Tooltip as RadixTooltip } from "radix-ui";
import { cx } from "./cx";

export function TooltipProvider({ children }: { children: ReactNode }) {
  return <RadixTooltip.Provider delayDuration={250} skipDelayDuration={150}>{children}</RadixTooltip.Provider>;
}

/** Hover/focus hint. The trigger must be focusable so keyboard users get the same text. */
export function Tooltip({ content, children, side = "top", className }: { content: ReactNode; children: ReactNode; side?: "top" | "right" | "bottom" | "left"; className?: string }) {
  if (content === null || content === undefined || content === "") return <>{children}</>;
  return <RadixTooltip.Root>
    <RadixTooltip.Trigger asChild>{children}</RadixTooltip.Trigger>
    <RadixTooltip.Portal>
      <RadixTooltip.Content
        side={side}
        sideOffset={6}
        collisionPadding={8}
        className={cx("pop-in z-[90] max-w-xs rounded-[8px] bg-ink px-2.5 py-1.5 text-xs leading-5 text-panel shadow-float text-pretty", className)}
      >
        {content}
      </RadixTooltip.Content>
    </RadixTooltip.Portal>
  </RadixTooltip.Root>;
}
