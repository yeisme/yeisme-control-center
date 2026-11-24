import type { ReactNode } from "react";
import type { Range } from "../shared/search/match";

/** Text with the matched parts marked; the marks carry no meaning of their own for assistive tech. */
export function Highlight({ text, ranges }: { text: string; ranges?: readonly Range[] }) {
  if (!ranges?.length) return <>{text}</>;
  const parts: ReactNode[] = [];
  let at = 0;
  for (const [start, end] of ranges) {
    if (start > at) parts.push(text.slice(at, start));
    parts.push(<mark key={start} className="rounded-[3px] bg-accent/45 px-px text-inherit">{text.slice(start, end)}</mark>);
    at = end;
  }
  if (at < text.length) parts.push(text.slice(at));
  return <>{parts}</>;
}
