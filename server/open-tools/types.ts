import { AuthError, boundedJSON, secret } from "../auth";
import { endpointURL } from "../task-connections";
import type { OpenToolConnection } from "../contracts";
import type { CatalogTool } from "../../src/shared/tool-catalog";
import type { OpenToolCheckState, OpenToolKind, OpenToolProjection } from "../../src/shared/open-tools";

export type Fetcher = (input: string | URL, init?: RequestInit) => Promise<Response>;

/**
 * One fixed GET route: the parsed body, or the reason it could not be read, never the owner's error text. A refusal
 * keeps its body only when the caller asked for that status.
 */
export type RouteRead =
  | { ok: true; body: unknown }
  | { ok: false; state: Exclude<OpenToolCheckState, "ok" | "failed">; reason: string; body?: unknown };

export interface OpenToolObservation {
  projection: OpenToolProjection;
  /** Tools the open tool itself lists (the Gateway's catalog); null when it lists none or could not be read. */
  tools: CatalogTool[] | null;
}

export interface OpenToolAdapter {
  readonly tool: OpenToolKind;
  /** How long a reading stays fresh; defaults to a minute. */
  readonly ttlMs?: number;
  observe(): Promise<OpenToolObservation>;
}

const routeTimeoutMs = 5000;
const responseLimit = 1024 * 1024;

/** Maps a refused read to a stable reason; 404 and 405 mean the route this adapter relies on is not there. */
export function refusal(status: number): { ok: false; state: Exclude<OpenToolCheckState, "ok" | "failed">; reason: string } {
  if (status === 401 || status === 403) return { ok: false, state: "forbidden", reason: status === 401 ? "open_tool_unauthenticated" : "open_tool_forbidden" };
  if (status === 404 || status === 405) return { ok: false, state: "needs_contract", reason: "open_tool_route_missing" };
  if (status === 429) return { ok: false, state: "rate_limited", reason: "open_tool_rate_limited" };
  return { ok: false, state: "unavailable", reason: "open_tool_unavailable" };
}

/**
 * Reads the open tool's fixed routes with its bearer credential. The base address is checked once (https, or http
 * to a private IP only when the config allows it); redirects are refused, each call times out after 5 s, and a
 * response over 1 MiB is dropped.
 */
export class OpenToolClient {
  private readonly base: URL;
  constructor(readonly connection: OpenToolConnection, private readonly fetcher: Fetcher = fetch) {
    const url = endpointURL(connection.endpoint, connection.allow_private_http, "open_tool_endpoint_denied");
    this.base = new URL(url.href.endsWith("/") ? url.href : url.href + "/");
  }

  url(route: string) {
    return new URL(route.replace(/^\//, ""), this.base);
  }

  /** `bodyOn`: refusal statuses whose JSON body still matters, such as a 503 readiness answer naming failed backends. */
  async get(route: string, options: { auth?: boolean; bodyOn?: number[] } = {}): Promise<RouteRead> {
    let token = "";
    if (options.auth !== false) {
      try {
        token = secret(this.connection.credential_ref);
      } catch {
        return { ok: false, state: "forbidden", reason: "open_tool_credential_unreadable" };
      }
    }
    let response: Response;
    try {
      response = await this.fetcher(this.url(route), {
        method: "GET",
        headers: { Accept: "application/json", ...(token ? { Authorization: "Bearer " + token } : {}) },
        redirect: "error",
        signal: AbortSignal.timeout(routeTimeoutMs),
      });
    } catch {
      return { ok: false, state: "unavailable", reason: "open_tool_unreachable" };
    }
    const keep = options.bodyOn?.includes(response.status);
    if (!response.ok && !keep) {
      await response.body?.cancel().catch(() => {});
      return refusal(response.status);
    }
    try {
      // boundedJSON refuses non-2xx answers, so a kept refusal is read through a copy marked ok.
      const body = await boundedJSON(keep ? new Response(response.body, { status: 200 }) : response, responseLimit);
      return response.ok ? { ok: true, body } : { ...refusal(response.status), body };
    } catch (error) {
      return { ok: false, state: "unavailable", reason: error instanceof AuthError && error.code === "response_limit_exceeded" ? "open_tool_response_too_large" : "open_tool_invalid_response" };
    }
  }
}

export const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
export const list = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
/** A short owner token such as a state or kind; anything else (free text, paths) becomes the fallback. */
export const code = (value: unknown, fallback = "") => typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,63}$/.test(value) ? value : fallback;
/** An owner id kept as a reference; refs that look like paths or URLs are dropped. */
export const ref = (value: unknown) => typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(value) ? value : "";
export const count = (value: unknown) => typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.floor(value) : null;
export const time = (value: unknown) => typeof value === "string" && Number.isFinite(Date.parse(value)) ? new Date(Date.parse(value)).toISOString() : null;
export const short = (value: unknown, max = 80) => typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max) : "";
