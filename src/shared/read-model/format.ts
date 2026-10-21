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
