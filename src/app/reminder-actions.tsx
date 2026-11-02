import { Clock3, RotateCcw } from "../icons";
import type { ItemAction } from "../components/ui";
import { canReopen, canSnooze, snoozeChoices, snoozeUntil } from "../notifications";

/**
 * The two ways to put a reminder off or back: "稍后提醒" with a few fixed times, and "重新打开" for one that was handled
 * or snoozed. The reminders page and the bell offer the same ones, so both build them here. An action is left out when
 * the reminder cannot take it, rather than shown disabled: the server refuses a snooze on anything but an unread reminder.
 */
export function snoozeActions(item: { state: string; recovered_at?: string | null }, run: (until: string) => void, disabled = false, clock: () => Date = () => new Date()): ItemAction[] {
  if (!canSnooze(item)) return [];
  return snoozeChoices(clock()).map((choice) => ({
    id: `snooze-${choice.id}`,
    label: `稍后提醒：${choice.label}`,
    icon: <Clock3 className="size-3.5" />,
    group: "snooze",
    disabled,
    // Worked out when it is chosen, not when the menu was built: a page left open overnight would send yesterday's time.
    run: () => run(snoozeUntil(choice.id, clock())),
  }));
}

export function reopenActions(item: { state: string; snoozed_until?: string | null; recovered_at?: string | null }, run: () => void, disabled = false, now = Date.now()): ItemAction[] {
  return canReopen(item, now)
    ? [{ id: "reopen", label: "重新打开", icon: <RotateCcw className="size-3.5" />, group: "resolve", disabled, run }]
    : [];
}
