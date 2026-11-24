const timeFormatter = new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false });
const fullFormatter = new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });

export function parseTime(value: string | null | undefined) {
  if (!value) return null;
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : null;
}

export function formatTime(value: string | null | undefined, fallback = "未提供") {
  const time = parseTime(value);
  return time === null ? fallback : timeFormatter.format(time);
}

export function formatFullTime(value: string | null | undefined, fallback = "未提供") {
  const time = parseTime(value);
  return time === null ? fallback : fullFormatter.format(time);
}

export function formatRelative(value: string | null | undefined, now = Date.now(), fallback = "时间未提供") {
  const time = parseTime(value);
  if (time === null) return fallback;
  const seconds = Math.round((now - time) / 1000);
  if (seconds < 0) return timeFormatter.format(time);
  if (seconds < 45) return "刚刚";
  if (seconds < 3600) return `${Math.max(1, Math.round(seconds / 60))} 分钟前`;
  if (seconds < 86400) return `${Math.round(seconds / 3600)} 小时前`;
  if (seconds < 86400 * 7) return `${Math.round(seconds / 86400)} 天前`;
  return timeFormatter.format(time);
}

/** Pads text set between Chinese words with a space on each side that starts or ends with digits or Latin: 是 3 分钟前的, 是刚刚的. */
export const cjkSpaced = (text: string) => `${/^[\x21-\x7e]/.test(text) ? " " : ""}${text}${/[\x21-\x7e]$/.test(text) ? " " : ""}`;

export function formatBytes(value: number | null | undefined) {
  if (value === null || value === undefined) return null;
  if (value >= 1073741824) return (value / 1073741824).toFixed(1) + " GB";
  if (value >= 1048576) return (value / 1048576).toFixed(1) + " MB";
  if (value >= 1024) return (value / 1024).toFixed(1) + " KB";
  return value + " B";
}

export function formatDurationMs(value: number | null | undefined) {
  if (value === null || value === undefined) return null;
  if (value < 1000) return `${value} ms`;
  const seconds = value / 1000;
  if (seconds < 60) return `${seconds.toFixed(seconds < 10 ? 1 : 0)} 秒`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(Math.round(seconds % 60)).padStart(2, "0")}`;
}

/** A working span in a person's units: 42 秒, 18 分, 2 小时 14 分, 3 天 4 小时. Under a second reads as "不到 1 秒". */
export function formatSpan(value: number | null | undefined) {
  if (value === null || value === undefined) return null;
  const seconds = Math.floor(value / 1000);
  if (seconds < 1) return value > 0 ? "不到 1 秒" : "0 秒";
  if (seconds < 60) return `${seconds} 秒`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return minutes < 10 && seconds % 60 ? `${minutes} 分 ${seconds % 60} 秒` : `${minutes} 分`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return minutes % 60 ? `${hours} 小时 ${minutes % 60} 分` : `${hours} 小时`;
  const days = Math.floor(hours / 24);
  return hours % 24 ? `${days} 天 ${hours % 24} 小时` : `${days} 天`;
}

const currencySymbols: Record<string, string> = { CNY: "¥", USD: "$", EUR: "€" };

export function formatMoney(amount: number | null | undefined, currency: string) {
  if (amount === null || amount === undefined) return null;
  const symbol = currencySymbols[currency.toUpperCase()];
  const fixed = amount.toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return symbol ? `${symbol} ${fixed}` : `${fixed} ${currency}`;
}

export function formatCount(value: number | null | undefined) {
  return value === null || value === undefined ? null : value.toLocaleString("zh-CN");
}

export function initials(name: string) {
  const trimmed = name.trim();
  if (!trimmed) return "?";
  const first = [...trimmed][0];
  return /[a-z]/i.test(first) ? first.toUpperCase() : first;
}
