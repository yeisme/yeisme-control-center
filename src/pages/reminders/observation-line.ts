import type { ObservationStatus } from "../../shared/api/control-center-client";
import { cjkSpaced } from "../../shared/read-model/format";

/**
 * The one line the reminders page says about background observation: whether it is on, when it last ran and what it did,
 * when it runs next, and whether the signed-in account is one who receives its reminders. Counts and times only; the
 * route carries nothing else, and this adds nothing of its own.
 */

const ago = (iso: string, now: number) => {
  const minutes = Math.max(0, Math.round((now - Date.parse(iso)) / 60_000));
  return minutes < 1 ? "刚刚" : minutes < 60 ? `${minutes} 分钟前` : minutes < 24 * 60 ? `${Math.round(minutes / 60)} 小时前` : `${Math.round(minutes / 1440)} 天前`;
};

const inTime = (iso: string, now: number) => {
  const minutes = Math.round((Date.parse(iso) - now) / 60_000);
  return minutes < 1 ? "马上" : minutes < 60 ? `约 ${minutes} 分钟后` : minutes < 24 * 60 ? `约 ${Math.round(minutes / 60)} 小时后` : `约 ${Math.round(minutes / 1440)} 天后`;
};

export function observationLineText(status: ObservationStatus, now = Date.now()): string {
  if (!status.config_valid) return "后台观察的配置有问题，已经关闭；没有人打开页面时不会产生提醒。";
  if (!status.enabled) return "后台观察没有开启：没有人打开页面时，不会自动产生提醒。";
  if (!status.running) return "后台观察已经配置，但这个进程没有在运行它。";
  const parts = [`每 ${status.interval_minutes} 分钟观察一次`];
  const last = status.last_cycle;
  if (last) {
    const problems = Object.values(last.errors).reduce((sum, n) => sum + n, 0);
    parts.push(`上次${cjkSpaced(ago(last.finished_at, now))}：读了 ${last.pages_read} 页，新增 ${last.reminders_opened} 条、恢复 ${last.reminders_recovered} 条${problems ? `，${problems} 处没读成` : ""}`);
  } else parts.push("还没有跑过第一次");
  if (status.next_run_at) parts.push(`下次${inTime(status.next_run_at, now)}`);
  parts.push(status.recipient ? "这个范围的后台提醒会发给你" : status.observed ? "这个范围的后台提醒发给别的管理员，不发给你" : "这个范围没有人接收后台提醒");
  return parts.join(" · ");
}
