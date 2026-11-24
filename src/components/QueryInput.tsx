import { useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Search, X } from "../icons";
import { controlClass, cx, firstRowAfter } from "./ui";
import { queryKeyWords, type QueryKey } from "../shared/task-query";
import { normalizeText } from "../shared/search/match";

export interface QuerySuggestion { value: string; label: string; count?: number; hint?: string }

export interface QuerySupport {
  /** Moves readable `键:值` clauses out of the text into parameters; what is left stays in the box. */
  extract: (text: string, current: URLSearchParams) => { params: Record<string, string>; rest: string };
  /** Values offered after `键:`; the input filters them by what was typed. */
  suggest: (key: QueryKey) => QuerySuggestion[];
  /** Chip text for parameters the filter pickers do not cover (集、更新、类型、排序). */
  chips?: Record<string, { label: string; format?: (value: string) => string }>;
}

type Open = { kind: "keys" } | { kind: "values"; key: QueryKey; typed: string };

/** The token the caret is in: where it starts, and the `键:值` it holds if it is one. */
function caretToken(value: string, caret: number) {
  const before = value.slice(0, caret);
  const start = Math.max(before.lastIndexOf(" "), before.lastIndexOf("　")) + 1;
  const token = before.slice(start);
  const match = /^-?([^:：]+)[:：](.*)$/.exec(token);
  const key = match ? queryKeyWords.find((item) => item.words.some((word) => normalizeText(word) === normalizeText(match[1])))?.key : undefined;
  return { start, token, key, typed: match ? match[2].replace(/^["“「]/, "") : "" };
}

const clauseToken = /(^|[ 　])-?[^ 　:：]+[:：][^ 　]+$/;

/**
 * The search box of a list that understands `键:值`. Suggestions open only after `键:` or on Ctrl+Space; a space, Enter or
 * leaving the box turns readable clauses into filter chips; Backspace in an empty box removes the last chip; ↓ goes to
 * the first row when no suggestion list is open.
 */
export function QueryInput({ value, onChange, onCommit, onBackspaceEmpty, placeholder, label, support, className }: {
  value: string;
  onChange: (value: string) => void;
  onCommit: (value: string) => void;
  onBackspaceEmpty?: () => void;
  placeholder: string;
  label: string;
  support: QuerySupport;
  className?: string;
}) {
  const [open, setOpen] = useState<Open | null>(null);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();
  const options = useMemo(() => {
    if (!open) return [];
    if (open.kind === "keys") return queryKeyWords.map((item) => ({ value: `${item.label}:`, label: item.label, hint: item.hint }));
    const typed = normalizeText(open.typed);
    return support.suggest(open.key).filter((item) => !typed || normalizeText(item.label).includes(typed) || normalizeText(item.value).includes(typed)).slice(0, 12);
  }, [open, support]);

  const refresh = (next: string, caret: number) => {
    const token = caretToken(next, caret);
    if (token.key) { setOpen({ kind: "values", key: token.key, typed: token.typed }); setActive(0); }
    else if (open?.kind === "values") setOpen(null);
  };

  const choose = (input: HTMLInputElement, option: { value: string }) => {
    const caret = input.selectionStart ?? value.length;
    const token = caretToken(value, caret);
    const negated = token.token.startsWith("-") ? "-" : "";
    const quoted = /[ 　]/.test(option.value) && !option.value.endsWith(":") ? `"${option.value}"` : option.value;
    const keyPart = open?.kind === "values" ? `${token.token.slice(negated.length).split(/[:：]/)[0]}:` : "";
    const replacement = `${negated}${keyPart}${quoted}`;
    const next = `${value.slice(0, token.start)}${replacement}${value.slice(caret)}`;
    setOpen(null);
    if (open?.kind === "keys") {
      onChange(next);
      requestAnimationFrame(() => { input.setSelectionRange(token.start + replacement.length, token.start + replacement.length); refresh(next, token.start + replacement.length); });
      return;
    }
    onCommit(`${next} `);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    const input = event.currentTarget;
    if (event.key === " " && event.ctrlKey) { event.preventDefault(); setOpen({ kind: "keys" }); setActive(0); return; }
    if (open && options.length) {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        setActive((current) => (current + (event.key === "ArrowDown" ? 1 : -1) + options.length) % options.length);
        return;
      }
      if (event.key === "Enter" || event.key === "Tab") { event.preventDefault(); choose(input, options[active] || options[0]); return; }
    }
    if (event.key === "Escape" && open) { event.preventDefault(); event.stopPropagation(); setOpen(null); return; }
    if (event.key === "Enter") { event.preventDefault(); onCommit(value); return; }
    if (event.key === "Backspace" && !value && onBackspaceEmpty) { event.preventDefault(); onBackspaceEmpty(); return; }
    if (event.key === "ArrowDown") {
      const row = firstRowAfter(input);
      if (!row) return;
      event.preventDefault();
      row.focus();
    }
  };

  const expanded = !!open && options.length > 0;
  return <div className={cx("relative min-w-0", className)}>
    <label className="relative flex min-w-0 items-center">
      <span className="sr-only">{label}</span>
      <Search aria-hidden="true" className="pointer-events-none absolute left-3 size-4 text-faint" />
      <input
        ref={inputRef}
        value={value}
        data-page-search
        role="combobox"
        aria-expanded={expanded}
        aria-controls={expanded ? listId : undefined}
        aria-autocomplete="list"
        aria-activedescendant={expanded ? `${listId}-${active}` : undefined}
        aria-describedby={`${listId}-hint`}
        onChange={(event) => {
          const next = event.target.value;
          // A space right after a whole clause turns it into a chip at once.
          if (next.endsWith(" ") && clauseToken.test(next.trimEnd()) && !next.endsWith("  ")) { setOpen(null); onCommit(next); return; }
          onChange(next);
          refresh(next, event.target.selectionStart ?? next.length);
        }}
        onKeyDown={onKeyDown}
        onBlur={() => { setOpen(null); if (clauseToken.test(value.trimEnd()) || /(^|[ 　])-?[^ 　:：]+[:：]/.test(value)) onCommit(value); }}
        placeholder={placeholder}
        className={cx(controlClass, "pl-9 pr-8")}
      />
      {value && <button type="button" aria-label="清除搜索" onClick={() => onChange("")} className="absolute right-2 grid size-5 place-items-center rounded text-faint hover:bg-panel-sunken hover:text-ink"><X className="size-3.5" /></button>}
    </label>
    <span id={`${listId}-hint`} className="sr-only">可以输入「状态:失败」这样的条件，按 Ctrl+空格 查看全部条件。</span>
    {expanded && <ul id={listId} role="listbox" aria-label={open?.kind === "keys" ? "查询条件" : "可选的值"} className="pop-in absolute left-0 top-full z-popover mt-1 max-h-72 w-full min-w-64 overflow-y-auto rounded-[14px] border border-line bg-panel p-1.5 text-ink shadow-float">
      {options.map((option, index) => <li
        key={`${option.value}-${index}`}
        id={`${listId}-${index}`}
        role="option"
        aria-selected={index === active}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => { if (inputRef.current) choose(inputRef.current, option); }}
        onMouseEnter={() => setActive(index)}
        className={cx("flex cursor-pointer items-center gap-2 rounded-[10px] px-2.5 py-1.5 text-body-sm", index === active && "bg-panel-sunken")}
      >
        <span className="min-w-0 flex-1 truncate">{option.label}</span>
        {"hint" in option && option.hint && <span className="truncate text-2xs text-muted">{option.hint}</span>}
        {"count" in option && option.count !== undefined && <span className="tabular text-2xs text-muted">{option.count}</span>}
      </li>)}
    </ul>}
  </div>;
}
