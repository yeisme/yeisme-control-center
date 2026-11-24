import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAccountPreferences } from "./preferences";
import { effectiveKeymap, goToHints, resolveKey, stepFromEvent, type KeyCommand, type Keymap } from "../shared/keymap";
import { isTypingTarget } from "../shared/keyboard";
import { rowButton } from "../components/ui/list-keys";

/** This account's bindings: the defaults with the changes made on the settings page. */
export function useKeymap(): Keymap {
  const { prefs } = useAccountPreferences();
  return useMemo(() => effectiveKeymap(prefs.keymap), [prefs.keymap]);
}

/** How long the page waits for the second key of a go-to sequence. */
const leaderMs = 1500;
const visible = (element: HTMLElement) => element.getClientRects().length > 0;

/** J and K from anywhere on the page: the next or previous row of the list on screen, or its first or last row. */
function moveRow(delta: 1 | -1) {
  const rows = [...document.querySelectorAll<HTMLElement>(`#main ${rowButton}`)].filter(visible);
  if (!rows.length) return;
  const current = rows.indexOf(document.activeElement as HTMLElement);
  const next = current < 0 ? (delta > 0 ? 0 : rows.length - 1) : Math.min(rows.length - 1, Math.max(0, current + delta));
  rows[next]!.focus();
}

/** The page's own search box, when it shows one; otherwise the search dialog. */
function focusPageSearch(openSearch: () => void) {
  const field = [...document.querySelectorAll<HTMLInputElement>("#main [data-page-search]")].find(visible);
  if (field) { field.focus(); field.select(); } else openSearch();
}

/**
 * The one listener for the shell's shortcuts. Dialogs and open menus own the keyboard, fields own typed text, and a key
 * press a page already handled is left alone. After the leader key the hint lists where the second key leads.
 */
export function useKeymapDispatcher(handlers: { search: () => void; shortcuts: () => void }) {
  const keymap = useKeymap();
  const navigate = useNavigate();
  const [leader, setLeader] = useState<string | null>(null);
  const pending = useRef<string | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const latest = useRef({ keymap, handlers, navigate });
  latest.current = { keymap, handlers, navigate };
  useEffect(() => {
    const clear = () => { pending.current = null; setLeader(null); window.clearTimeout(timer.current); };
    const run = (command: KeyCommand) => {
      const { handlers: on, navigate: go } = latest.current;
      if (command.id === "search") on.search();
      else if (command.id === "shortcuts") on.shortcuts();
      else if (command.id === "page-search") focusPageSearch(on.search);
      else if (command.id === "list-next") moveRow(1);
      else if (command.id === "list-prev") moveRow(-1);
      else if (command.target) go(command.target);
    };
    const onKey = (event: KeyboardEvent) => {
      // The settings page is recording a new binding: that key press is the binding, not a shortcut.
      if ((event.target as Element | null)?.closest?.("[data-key-capture]")) return;
      const step = stepFromEvent(event);
      if (!step) return;
      const dialog = document.querySelector('[role="dialog"], [role="alertdialog"], [role="menu"]') !== null;
      const result = resolveKey(step, pending.current, latest.current.keymap, { typing: isTypingTarget(event.target), dialog, prevented: event.defaultPrevented });
      if (pending.current) clear();
      if (result.kind === "pending") {
        event.preventDefault();
        pending.current = result.leader;
        setLeader(result.leader);
        timer.current = window.setTimeout(clear, leaderMs);
      } else if (result.kind === "run") {
        event.preventDefault();
        run(result.command);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => { window.removeEventListener("keydown", onKey); window.clearTimeout(timer.current); };
  }, []);
  return { leader, hints: useMemo(() => goToHints(keymap), [keymap]) };
}

/** After the leader key: where each second key leads. Announced politely; it never takes focus. */
export function LeaderHint({ leader, hints }: { leader: string | null; hints: { key: string; label: string }[] }) {
  return <div role="status" aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-[calc(1.5rem+var(--workspace-bottom,0px))] z-toast flex justify-center px-3">
    {leader && <p data-leader-hint className="fade-in flex max-w-[min(720px,100%)] flex-wrap items-center gap-x-3 gap-y-1 rounded-[14px] border border-line bg-panel/95 px-4 py-2.5 text-2xs text-ink-soft shadow-float backdrop-blur">
      <span className="font-semibold text-ink">{leader} →</span>
      {hints.map((hint) => <span key={hint.key} className="inline-flex items-center gap-1"><kbd className="inline-flex h-5 min-w-5 items-center justify-center rounded border border-line bg-panel px-1 font-sans text-2xs text-ink">{hint.key}</kbd>{hint.label}</span>)}
    </p>}
  </div>;
}
