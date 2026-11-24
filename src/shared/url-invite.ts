export interface ExtractedControlInvite {
  token: string;
  cleanUrl: string;
}

const INVITE_QUERY_KEYS = ["token", "invite"] as const;

function stripInviteParams(params: URLSearchParams): string | null {
  let found: string | null = null;
  for (const name of INVITE_QUERY_KEYS) {
    const val = params.get(name)?.trim();
    if (val && !found) found = val;
    if (params.has(name)) params.delete(name);
  }
  return found;
}

/**
 * Extracts `?token=` / `?invite=` from search or hash before the workspace mounts,
 * returning the sanitized relative URL so `history.replaceState` can scrub the
 * address bar immediately on frame 0.
 */
export function extractUrlInviteToken(loc: {
  pathname: string;
  search: string;
  hash: string;
}): ExtractedControlInvite | null {
  let token: string | null = null;

  const searchParams = new URLSearchParams(loc.search);
  const searchHit = stripInviteParams(searchParams);
  if (searchHit) token = searchHit;

  let nextHash = loc.hash;
  if (loc.hash.startsWith("#token=") || loc.hash.startsWith("#invite=")) {
    const hashParams = new URLSearchParams(loc.hash.slice(1));
    const fragHit = stripInviteParams(hashParams);
    if (fragHit && !token) token = fragHit;
    const rest = hashParams.toString();
    nextHash = rest ? `#${rest}` : "";
  } else if (loc.hash.startsWith("#/") && loc.hash.includes("?")) {
    const qIdx = loc.hash.indexOf("?");
    const routePart = loc.hash.slice(0, qIdx);
    const hashQuery = new URLSearchParams(loc.hash.slice(qIdx + 1));
    const routeHit = stripInviteParams(hashQuery);
    if (routeHit && !token) token = routeHit;
    const rest = hashQuery.toString();
    nextHash = rest ? `${routePart}?${rest}` : routePart;
  }

  if (!token) return null;

  const cleanSearch = searchParams.toString();
  const cleanUrl = `${loc.pathname}${cleanSearch ? `?${cleanSearch}` : ""}${nextHash}`;
  return { token, cleanUrl };
}

let bootPendingInviteToken: string | null = null;

/**
 * Called synchronously before React mounts so any `?token=` or `#token=` is
 * immediately scrubbed from `window.location` at frame 0.
 */
export function captureBootInviteToken(): void {
  if (typeof window === "undefined") return;
  const hit = extractUrlInviteToken(window.location);
  if (!hit) return;
  bootPendingInviteToken = hit.token;
  window.history.replaceState(window.history.state, "", hit.cleanUrl);
}

export function consumePendingInviteToken(): string | null {
  const pending = bootPendingInviteToken;
  bootPendingInviteToken = null;
  if (pending) return pending;
  if (typeof window === "undefined") return null;
  const hit = extractUrlInviteToken(window.location);
  if (!hit) return null;
  window.history.replaceState(window.history.state, "", hit.cleanUrl);
  return hit.token;
}

/**
 * Uses URL fragment (`/#token=yki_live_...`) by default so the one-time secret
 * is never transmitted in the initial HTTP document GET request URL or proxy logs,
 * while `?token=` query links are also accepted and scrubbed identically.
 */
export function buildControlInviteUrl(origin: string, inviteToken: string, targetHash = ""): string {
  const base = origin.replace(/\/+$/, "");
  const encoded = encodeURIComponent(inviteToken);
  if (targetHash && targetHash.startsWith("#/")) {
    const sep = targetHash.includes("?") ? "&" : "?";
    return `${base}/${targetHash}${sep}token=${encoded}`;
  }
  return `${base}/#token=${encoded}`;
}

export function formatControlInviteCard(input: {
  username: string;
  inviteUrl?: string;
  inviteToken?: string;
  accessKey?: string;
  expiresAt?: string;
}): string {
  const lines = [`邀请你进入 Yeisme Studio 创作台（账号 @${input.username}）`];
  if (input.inviteUrl) {
    lines.push(`免密直连：${input.inviteUrl}`);
    lines.push("说明：点击上方链接即可自动登录进入，链接首次打开后立即单次失效防转发。");
  }
  if (input.inviteToken && !input.inviteUrl) {
    lines.push(`一次性邀请码：${input.inviteToken}`);
  }
  if (input.accessKey) {
    lines.push(`用户名：${input.username}`);
    lines.push(`访问 Key：${input.accessKey}`);
  }
  if (input.expiresAt) {
    lines.push(`邀请有效期至：${input.expiresAt.slice(0, 16).replace("T", " ")}`);
  }
  return lines.join("\n");
}

export type ParsedControlPaste =
  | { kind: "invite_token"; token: string; username?: string }
  | { kind: "credentials"; username?: string; accessKey: string }
  | null;

/**
 * Recognizes pasted invite URLs, raw `yki_live_*` one-time tokens, raw `yk_live_*`
 * access keys, or multi-line Baidu-Netdisk-style invitation cards.
 */
export function parsePastedControlInvite(raw: string): ParsedControlPaste {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const userMatch =
    trimmed.match(/(?:用户名|账号)\s*[:：]\s*@?([a-zA-Z0-9][a-zA-Z0-9_.-]{0,79})/i) ||
    trimmed.match(/账号\s+@([a-zA-Z0-9][a-zA-Z0-9_.-]{0,79})/);
  const extractedUser = userMatch?.[1];

  // 1. Check embedded URL with ?token= / ?invite=
  const urlMatch = trimmed.match(/https?:\/\/[^\s"'<>]+/i);
  if (urlMatch) {
    try {
      const parsed = new URL(urlMatch[0]);
      const hit = extractUrlInviteToken({
        pathname: parsed.pathname,
        search: parsed.search,
        hash: parsed.hash,
      });
      if (hit?.token) {
        return { kind: "invite_token", token: hit.token, username: extractedUser };
      }
    } catch {
      /* continue */
    }
  }

  // 2. Check raw or embedded one-time token yki_live_...
  const inviteTokMatch = trimmed.match(/\byki_live_[A-Za-z0-9_-]{16,120}\b/);
  if (inviteTokMatch?.[0]) {
    return { kind: "invite_token", token: inviteTokMatch[0], username: extractedUser };
  }

  // 3. Check query-like token=...
  const queryTok = trimmed.match(/(?:[?&#]|\b)(?:token|invite)=(yki_live_[A-Za-z0-9_-]{16,120})/i);
  if (queryTok?.[1]) {
    return { kind: "invite_token", token: queryTok[1], username: extractedUser };
  }

  // 4. Check multi-line or raw yk_live_... access key
  const keyMatch =
    trimmed.match(/(?:访问\s*Key|密钥|Key)\s*[:：]\s*(yk_live_[A-Za-z0-9_-]{16,120})/i) ||
    trimmed.match(/\byk_live_[A-Za-z0-9_-]{16,120}\b/);
  if (keyMatch) {
    const accessKey = keyMatch[1] || keyMatch[0];
    if (extractedUser || trimmed.includes("\n") || trimmed !== accessKey) {
      return { kind: "credentials", username: extractedUser, accessKey };
    }
  }

  return null;
}
