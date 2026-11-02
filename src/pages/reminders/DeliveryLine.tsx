import { useState } from "react";
import { Switch } from "radix-ui";
import { api } from "../../shared/api/control-center-client";
import { useScopedRead } from "../../app/workspace";
import { useNotifications } from "../../app/notifications-context";
import { cx } from "../../components/ui";
import { observationLineText } from "./observation-line";

/**
 * The switch for desktop notifications. The browser is asked for permission by the click that turns it on and never
 * otherwise; when the browser cannot show notifications at all, or this site is not allowed to, the switch is off and
 * disabled and says why.
 */
export function DesktopSwitch() {
  const { desktop } = useNotifications();
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);
  const unavailable = desktop.support.state === "unavailable";
  const toggle = async (next: boolean) => {
    if (busy) return;
    setBusy(true);
    setRefusal(null);
    try { setRefusal(await desktop.set(next)); } finally { setBusy(false); }
  };
  const hint = desktop.support.state === "unavailable" ? desktop.support.message
    : refusal ?? (desktop.on
      ? "页面在后台或窗口没有焦点时，有新的未读提醒会弹出系统通知；通知里只有工具名和数量，没有任务内容。"
      : "打开后，页面在后台或窗口没有焦点时，有新的未读提醒会弹出系统通知。第一次打开时浏览器会请求许可。");
  return <div className="flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1" data-desktop-notify data-desktop-state={unavailable ? "unavailable" : desktop.on ? "on" : "off"}>
    <label htmlFor="desktop-notify" className="font-medium text-ink-soft">桌面通知</label>
    <Switch.Root
      id="desktop-notify"
      checked={desktop.on}
      disabled={unavailable}
      onCheckedChange={(next) => void toggle(next)}
      aria-describedby="desktop-notify-hint"
      className={cx(
        "relative h-5 w-9 shrink-0 rounded-full border border-line-strong bg-panel-sunken transition-colors duration-150 disabled:opacity-45",
        "data-[state=checked]:border-primary data-[state=checked]:bg-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus",
      )}
    >
      <Switch.Thumb className="block size-3.5 translate-x-[3px] rounded-full bg-ink-soft transition-transform duration-150 data-[state=checked]:translate-x-[19px] data-[state=checked]:bg-primary-ink" />
    </Switch.Root>
    <span id="desktop-notify-hint" className={cx("min-w-0 text-pretty", refusal ? "text-warning" : "text-muted")}>{hint}</span>
  </div>;
}

/** What background observation did, in one line; absent while it is loading or when the server does not have the route. */
export function ObservationLine() {
  // An older server has no such route: after a few failed tries with nothing to show, the page stops asking.
  const read = useScopedRead((scope, signal) => api.observationStatus(scope, signal), { poll: (data, failures) => data || failures < 3 ? 60_000 : null });
  if (!read.data || (read.status !== "ready" && read.status !== "stale")) return null;
  return <p className="min-w-0 text-pretty text-muted" data-observation-line data-observation-enabled={String(read.data.enabled)}>{observationLineText(read.data)}</p>;
}
