import { AuthError, boundedJSON, secret } from "./auth";
import {
  owners,
  type ContentRead,
  type AttachmentRead,
  type CoverageState,
  type RequestQuery,
  type RequestProjection,
  type RequestSummary,
} from "../src/request-visibility";
import { normalizeCheckpoint, normalizeProcessObservation, normalizePromptObservation, type ProcessCheckpoint, type ProcessObservation } from "../src/observation-contract";
import type {
  ServerConfig,
  Session,
  ScopeBinding,
  Owner,
  OwnerPage,
} from "./contracts";
const coverageState = (v: any): CoverageState =>
  [
    "complete",
    "partial",
    "pending",
    "unknown",
    "not_recorded",
    "forbidden",
    "unavailable",
    "expired",
    "integrity_failed",
    "needs_contract",
  ].includes(v)
    ? v
    : "unknown";
const originOf = (value: string): string | null => {
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
};
const normalizedState = (v: unknown) =>
  typeof v !== "string"
    ? "unknown"
    : (
        {
          unknown_accept: "unknown",
          unknown_result: "unknown",
          canceled: "cancelled",
          success: "succeeded",
          failure: "failed",
        } as Record<string, string>
      )[v] || v.slice(0, 64);
const text = (v: any, max = 500) =>
  typeof v === "string" ? v.slice(0, max) : "";
const number = (v: any) =>
  typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null;
export function safeProjection(
  value: any,
  owner: Owner,
  binding: ScopeBinding["owners"][Owner],
): RequestProjection {
  if (
    !binding ||
    !value ||
    typeof value !== "object" ||
    value.tenant !== binding.tenant ||
    value.project !== binding.project ||
    !value.id
  )
    throw new AuthError("scope_mismatch", 403);
  const params = (v: any) =>
    Object.fromEntries(
      Object.entries(v || {})
        .filter(
          ([key, val]) =>
            [
              "model",
              "count",
              "size",
              "quality",
              "duration",
              "format",
              "stream",
              "seed",
              "temperature",
              "max_tokens",
              "voice",
              "language",
            ].includes(key) &&
            ["string", "number", "boolean"].includes(typeof val),
        )
        .map(([k, v]) => [k, typeof v === "string" ? v.slice(0, 256) : v]),
    ) as RequestProjection["submitted"];
  return {
    id: text(value.id),
    owner,
    tenant: binding.tenant,
    project: binding.project,
    title: text(value.title, 180),
    kind: ["gateway", "generation", "operation"].includes(value.kind)
      ? value.kind
      : "operation",
    state: normalizedState(value.state),
    native_state: text(value.native_state, 64),
    actor: text(value.actor),
    actor_type: ["human", "service"].includes(value.actor_type)
      ? value.actor_type
      : "unknown",
    created_at: text(value.created_at, 40),
    duration_ms: number(value.duration_ms),
    model: typeof value.model === "string" ? text(value.model, 100) : null,
    parent_ref:
      typeof value.parent_ref === "string" ? text(value.parent_ref) : null,
    attempts: (Array.isArray(value.attempts) ? value.attempts : [])
      .slice(0, 100)
      .filter((a: any) => a?.ref)
      .map((a: any) => ({
        ref: text(a.ref),
        state: text(a.state, 64),
        started_at: text(a.started_at, 40) || undefined,
        completed_at: text(a.completed_at, 40) || undefined,
      })),
    output_refs: (Array.isArray(value.output_refs) ? value.output_refs : [])
      .slice(0, 200)
      .filter((v: any) => typeof v === "string")
      .map((v: string) => v.slice(0, 500)),
    attachments: (Array.isArray(value.attachments) ? value.attachments : [])
      .slice(0, 200)
      .filter(
        (a: any) =>
          a?.ref && ["upload", "reference", "generated"].includes(a.source),
      )
      .map((a: any) => ({
        ref: text(a.ref),
        name: text(a.name, 200),
        mime: text(a.mime, 100),
        bytes: number(a.bytes),
        source: a.source,
        state: coverageState(a.state),
        upload_ref: text(a.upload_ref) || undefined,
        sha256: /^[a-f0-9]{64}$/.test(a.sha256) ? a.sha256 : undefined,
        width: number(a.width) || undefined,
        height: number(a.height) || undefined,
        duration_ms: number(a.duration_ms) ?? undefined,
        downloadable: a.downloadable === true,
      })),
    input: coverageState(value.input),
    output: coverageState(value.output),
    submitted: params(value.submitted),
    effective: params(value.effective),
    coverage: {
      owner,
      state: coverageState(value.coverage?.state),
      observed_at: text(value.coverage?.observed_at, 40),
      reason: text(value.coverage?.reason, 300),
    },
    ...(normalizeProcessObservation(value.process) ? { process: normalizeProcessObservation(value.process) } : {}),
    ...(normalizePromptObservation(value.prompt_capture) ? { prompt_capture: normalizePromptObservation(value.prompt_capture) } : {}),
    ...(text(value.task_ref, 512) ? { task_ref: text(value.task_ref, 512) } : {}),
    ...(text(value.trace_ref, 512) ? { trace_ref: text(value.trace_ref, 512) } : {}),
  };
}
export function aigoraProjection(
  v: any,
  b: NonNullable<ScopeBinding["owners"][Owner]>,
): RequestProjection {
  return safeProjection(
    {
      id: v.request_ref,
      tenant: b.tenant,
      project: b.project,
      title: v.request?.capability || v.request_ref,
      kind: "gateway",
      state:
        ({ success: "succeeded", failure: "failed" } as Record<string, string>)[
          v.request?.outcome
        ] ||
        v.request?.outcome ||
        "unknown",
      native_state: v.request?.outcome,
      actor: v.attribution?.actor_ref,
      created_at: v.request?.observed_at,
      duration_ms: v.request?.duration_ms,
      model: v.routing_selection?.requested_model,
      parent_ref: null,
      attempts: v.executions?.attempts?.map((a: any) => ({
        ref: a.attempt_ref,
        state: a.provider_outcome || a.reconciliation,
      })),
      output_refs: [],
      attachments: [],
      input: "unknown",
      output: "unknown",
      submitted: { model: v.request?.requested_model },
      effective: {},
      coverage: {
        state: "partial",
        observed_at: v.watermark || v.request?.observed_at,
        reason: "网关调查投影；归档内容需要独立授权读取",
      },
    },
    "aigora",
    b,
  );
}
// Raw archive payloads never pass through. Only explicit business text fields are extracted.
export function businessText(v: any, direction: "input" | "output") {
  const texts: string[] = [];
  const content = (c: any) => {
    if (typeof c === "string") texts.push(c);
    else if (Array.isArray(c))
      for (const p of c)
        if (
          p &&
          ["text", "input_text", "output_text"].includes(p.type) &&
          typeof p.text === "string"
        )
          texts.push(p.text);
  };
  if (direction === "input") {
    if (typeof v.prompt === "string") content(v.prompt);
    if (typeof v.input === "string") content(v.input);
    for (const m of [
      ...(Array.isArray(v.messages) ? v.messages : []),
      ...(Array.isArray(v.input) ? v.input : []),
    ])
      if (m?.role === "user") content(m.content);
  } else {
    for (const c of v.choices || [])
      if (c.message?.role === "assistant") content(c.message.content);
    for (const c of v.output || [])
      if (c.role === "assistant") content(c.content);
    if (typeof v.output_text === "string") content(v.output_text);
  }
  return texts.join("\n\n").slice(0, 65536);
}
export class OwnerReaders {
  constructor(
    private config: ServerConfig,
    private fetcher: typeof fetch = fetch,
  ) {}
  private binding(owner: Owner, _s: Session, scope: ScopeBinding) {
    const target = this.config.owners[owner],
      b = scope.owners[owner];
    if (!target) throw new AuthError("source_not_configured", 503);
    if (!b || !b.actor || b.audience !== target.audience)
      throw new AuthError("delegation_unavailable", 403);
    return { target, b };
  }
  /** Session (OIDC) delegation wins; a per-owner service credential backs personal sessions. */
  private bearer(owner: Owner, s: Session, scope: ScopeBinding): string {
    const { target } = this.binding(owner, s, scope);
    if (s.accessToken && s.accessAudience.includes(target.audience))
      return s.accessToken;
    if (target.credential_ref) return secret(target.credential_ref);
    throw new AuthError("delegation_unavailable", 403);
  }
  private async request(
    owner: Owner,
    s: Session,
    scope: ScopeBinding,
    path: string,
    init: RequestInit = {},
    responseLimit = 2 * 1048576,
  ) {
    const { target, b } = this.binding(owner, s, scope),
      token = this.bearer(owner, s, scope),
      url = new URL(path, target.origin);
    if (owner === "aigora") {
      const check = new URL("/operator/v1/control-center/scope", target.origin);
      check.search = new URLSearchParams({
        tenant_id: b.tenant,
        project_id: b.project,
        actor_id: b.actor,
      }).toString();
      const gate = await boundedJSON(
        await this.fetcher(check, {
          headers: { Authorization: "Bearer " + token },
          redirect: "error",
          signal: AbortSignal.timeout(5000),
        }),
      );
      if (
        gate.tenant !== b.tenant ||
        gate.project !== b.project ||
        gate.actor !== b.actor
      )
        throw new AuthError("scope_mismatch", 403);
    }
    if (url.origin !== originOf(target.origin))
      throw new AuthError("upstream_not_allowed", 403);
    const response = await this.fetcher(url, {
      ...init,
      headers: {
        Authorization: "Bearer " + token,
        "Content-Type": "application/json",
        ...(init.headers || {}),
      },
      redirect: "error",
      signal: AbortSignal.timeout(6000),
    });
    if (!response.ok)
      throw new AuthError(
        response.status === 401 || response.status === 403
          ? "owner_forbidden"
          : response.status === 404
            ? "needs_contract"
            : "owner_unavailable",
        response.status === 403 || response.status === 401 ? 403 : 503,
      );
    return boundedJSON(response, responseLimit);
  }
  private path(owner: Owner, scope: ScopeBinding) {
    return owner === "aigora"
      ? "/operator/v1/observability/requests"
      : owner === "scaena"
        ? "/api/v1/projects/" +
          encodeURIComponent(scope.owners.scaena!.project) +
          "/control-center/requests"
        : "/api/v1/control-center/requests";
  }
  private query(
    owner: Owner,
    q: RequestQuery,
    scope: ScopeBinding,
    cursor?: string,
  ) {
    const b = scope.owners[owner]!;
    const p = new URLSearchParams({
      from: q.from,
      to: q.to,
      limit: String(q.limit),
      project_id: b.project,
      tenant_id: b.tenant,
    });
    if (cursor) p.set("cursor", cursor);
    if (q.state !== "all")
      p.set(owner === "aigora" ? "outcome" : "state", q.state);
    if (q.search) p.set("search", q.search);
    for (const k of [
      "input_type",
      "attachments",
      "outputs",
      "completeness",
    ] as const)
      if (q[k] !== "all") p.set(k, q[k]);
    return p;
  }
  async list(
    owner: Owner,
    s: Session,
    scope: ScopeBinding,
    q: RequestQuery,
    cursor?: string,
  ): Promise<OwnerPage> {
    const { b } = this.binding(owner, s, scope);
    if (
      owner === "aigora" &&
      (q.search ||
        [q.input_type, q.attachments, q.outputs].some((v) => v !== "all"))
    )
      throw new AuthError("filter_needs_contract", 503);
    const raw = await this.request(
      owner,
      s,
      scope,
      this.path(owner, scope) + "?" + this.query(owner, q, scope, cursor),
    );
    const result = ["eikona", "scaena"].includes(owner) ? raw.data : raw;
    const rows =
      owner === "aigora"
        ? (result.data || []).map((v: any) => aigoraProjection(v, b))
        : (result.rows || []).map((v: any) => safeProjection(v, owner, b));
    return {
      rows,
      coverage: {
        owner,
        state: coverageState(
          result.coverage?.state ||
            (result.meta?.coverage === "complete" ? "complete" : "partial"),
        ),
        observed_at: result.coverage?.observed_at || new Date().toISOString(),
      },
      next_cursor: result.next_cursor || result.meta?.next_cursor,
    };
  }
  async detail(owner: Owner, id: string, s: Session, scope: ScopeBinding) {
    const { b } = this.binding(owner, s, scope);
    const raw = await this.request(
      owner,
      s,
      scope,
      this.path(owner, scope) +
        "/" +
        encodeURIComponent(id) +
        "?" +
        new URLSearchParams({ project_id: b.project, tenant_id: b.tenant }),
    );
    const value = ["eikona", "scaena"].includes(owner) ? raw.data : raw;
    return owner === "aigora"
      ? aigoraProjection(value.data, b)
      : safeProjection(value, owner, b);
  }
  async observations(owner: Owner, id: string, after: string | undefined, s: Session, scope: ScopeBinding): Promise<{ observation?: ProcessObservation; events: ProcessCheckpoint[]; next_cursor?: string; resume_cursor?: string; gap: boolean; freshness: "fresh" | "stale" | "unknown"; observed_at: string }> {
    const { b } = this.binding(owner, s, scope);
    const raw = await this.request(
      owner,
      s,
      scope,
      (owner === "aigora" ? "/operator/v1/request-traces/" + encodeURIComponent(id) : this.path(owner, scope) + "/" + encodeURIComponent(id)) + "/observations?" + new URLSearchParams({
        project_id: b.project,
        tenant_id: b.tenant,
        ...(after ? { after } : {}),
      }),
    );
    const value = ["eikona", "scaena"].includes(owner) ? raw.data : raw;
    if (!value || typeof value !== "object" || !Array.isArray(value.events)) throw new AuthError("needs_contract", 422);
    const events = value.events.slice(0, 100).flatMap((item: unknown) => {
      const checkpoint = normalizeCheckpoint(item); return checkpoint ? [checkpoint] : [];
    });
    return {
      ...(normalizeProcessObservation(value.observation || value.process) ? { observation: normalizeProcessObservation(value.observation || value.process) } : {}),
      events,
      next_cursor: text(value.next_cursor, 2048) || undefined,
      resume_cursor: text(value.resume_cursor || value.next_after_cursor, 2048) || undefined,
      gap: value.gap === true,
      freshness: value.freshness === "fresh" || value.freshness === "stale" ? value.freshness : "unknown",
      observed_at: text(value.observed_at, 40) || new Date().toISOString(),
    };
  }
  async summary(
    owner: Owner,
    s: Session,
    scope: ScopeBinding,
    q: RequestQuery,
  ) {
    this.binding(owner, s, scope);
    if (
      owner === "aigora" &&
      (q.search ||
        [q.input_type, q.attachments, q.outputs].some((v) => v !== "all"))
    )
      throw new AuthError("filter_needs_contract", 503);
    const result = await this.request(
      owner,
      s,
      scope,
      this.path(owner, scope) + "/summary?" + this.query(owner, q, scope),
    );
    if (owner !== "aigora") {
      const source = ["eikona", "scaena"].includes(owner)
        ? result.data
        : result;
      const metrics = Object.fromEntries(
        [
          "gateway",
          "generation",
          "operation",
          "attempts",
          "outputs",
          "succeeded",
          "failed",
          "uploaded_files",
          "uploaded_bytes",
          "referenced_assets",
        ].map((key) => [
          key,
          {
            value: number(source?.[key]?.value),
            state: coverageState(source?.[key]?.state),
          },
        ]),
      );
      // SAFETY: metric keys are a fixed allowlist projected onto the frozen
      // RequestSummary wire shape; the runtime normalization above already
      // constrained every value to the metric contract.
      return {
        ...metrics,
        from: q.from,
        to: q.to,
        coverage: [
          {
            owner,
            state: coverageState(source?.coverage?.[0]?.state),
            observed_at: text(source?.coverage?.[0]?.observed_at, 40),
            reason: text(source?.coverage?.[0]?.reason, 300),
          },
        ],
      } as unknown as RequestSummary;
    }
    const d = result.data,
      unknown = { value: null, state: "unknown" },
      metric = (x: any) => ({
        value: number(x?.value),
        state: coverageState(x?.state),
      });
    return {
      gateway: metric(d.total),
      generation: unknown,
      operation: unknown,
      attempts: unknown,
      outputs: unknown,
      succeeded: metric(d.by_outcome?.success || d.by_outcome?.succeeded),
      failed: metric(d.by_outcome?.failure || d.by_outcome?.failed),
      uploaded_files: unknown,
      uploaded_bytes: unknown,
      referenced_assets: unknown,
      coverage: [
        { owner, state: coverageState(d.total?.state), observed_at: d.as_of },
      ],
      from: q.from,
      to: q.to,
    } as RequestSummary;
  }
  async content(
    owner: Owner,
    id: string,
    direction: "input" | "output",
    purpose: string,
    s: Session,
    scope: ScopeBinding,
  ): Promise<ContentRead> {
    const path =
      owner === "aigora"
        ? "/operator/v1/request-traces/" +
          encodeURIComponent(id) +
          "/archive:read"
        : this.path(owner, scope) +
          "/" +
          encodeURIComponent(id) +
          "/content:read";
    const b = scope.owners[owner];
    const raw = await this.request(owner, s, scope, path, {
      method: "POST",
      body: JSON.stringify(
        owner === "aigora"
          ? {
              direction: direction === "input" ? "client_in" : "client_out",
              purpose,
              max_bytes: 65536,
            }
          : {
              direction,
              purpose,
              max_bytes: 65536,
              project_id: b?.project,
              tenant_id: b?.tenant,
            },
      ),
    });
    const value = ["eikona", "scaena"].includes(owner) ? raw.data : raw;
    if (owner === "aigora") {
      const d = value.data || value;
      let text = "";
      try {
        text = businessText(
          JSON.parse(
            Buffer.from(d.content_base64 || "", "base64").toString("utf8"),
          ),
          direction,
        );
      } catch {
        return { state: "partial", truncated: !!d.truncated };
      }
      return {
        state: text ? "complete" : "not_recorded",
        text: text || undefined,
        truncated: !!d.truncated,
        receipt_ref:
          typeof d.receipt_ref === "string" ? d.receipt_ref : undefined,
      };
    }
    // Owner must explicitly declare business-only content after its authorization and audit gate.
    if (
      value.schema_version !== "yeisme.business_content.v1" ||
      value.audience !== "authorized_user"
    )
      throw new AuthError("content_contract_invalid", 503);
    return {
      state: coverageState(value.state),
      text:
        typeof value.text === "string"
          ? (value.content_kind === "effective_business_input"
              ? "【实际生效的业务输入；不等同于原始提交】\n\n"
              : "") + value.text.slice(0, 65536)
          : undefined,
      truncated: !!value.truncated || value.text?.length > 65536,
      receipt_ref: text(value.receipt_ref) || undefined,
    };
  }
  /**
   * Attachment body read (Eikona wire contract, adopted by Scaena/Sonora):
   * text inline or base64 bytes; state-only rows stay truthful.
   */
  async attachmentContent(
    owner: Owner,
    id: string,
    attachmentRef: string,
    direction: "input" | "output",
    purpose: string,
    s: Session,
    scope: ScopeBinding,
  ): Promise<AttachmentRead & { data?: Uint8Array }> {
    if (owner === "aigora")
      throw new AuthError("attachment_not_supported", 422);
    const b = scope.owners[owner];
    const raw = await this.request(
      owner,
      s,
      scope,
      this.path(owner, scope) +
        "/" +
        encodeURIComponent(id) +
        "/attachments/" +
        encodeURIComponent(attachmentRef) +
        "/content:read",
      {
        method: "POST",
        body: JSON.stringify({
          direction,
          purpose,
          max_bytes: 8 * 1024 * 1024,
          project_id: b?.project,
          tenant_id: b?.tenant,
        }),
      },
      12 * 1024 * 1024,
    );
    const value = ["eikona", "scaena"].includes(owner) ? raw.data : raw;
    if (!value || typeof value !== "object")
      throw new AuthError("content_contract_invalid", 503);
    if (
      value.schema_version !== undefined &&
      value.schema_version !== "yeisme.request_attachment_content.v1"
    )
      throw new AuthError("content_contract_invalid", 503);
    const result: AttachmentRead & { data?: Uint8Array } = {
      state: coverageState(value.state),
      truncated: value.truncated === true,
      receipt_ref: text(value.receipt_ref) || undefined,
      mime: text(value.mime, 100) || undefined,
      sha256: /^[a-f0-9]{64}$/.test(value.sha256) ? value.sha256 : undefined,
    };
    if (typeof value.text === "string" && value.text) {
      result.text = value.text.slice(0, 65536);
      result.truncated = result.truncated || value.text.length > 65536;
      return result;
    }
    if (typeof value.data === "string" && value.data) {
      // SAFETY: base64 payload is bounded by the 12MB JSON cap; the decoded
      // size is re-checked against the 8MB attachment limit before use.
      const bytes = new Uint8Array(Buffer.from(value.data, "base64"));
      if (!bytes.length || bytes.length > 8 * 1024 * 1024)
        throw new AuthError("attachment_limit_exceeded", 422);
      result.data = bytes;
      result.bytes = bytes.length;
    }
    return result;
  }
  async organization(owner: Owner, s: Session, scope: ScopeBinding) {
    const { b } = this.binding(owner, s, scope);
    if (owner === "aigora") {
      const v = await this.request(
        owner,
        s,
        scope,
        "/operator/v1/tenants/" + encodeURIComponent(b.tenant) + "/members",
      );
      return {
        tenant: b.tenant,
        members: (v.data || []).map((m: any) => ({
          id: m.id || m.principal_id,
          name: m.display_name || m.principal_id,
          type:
            m.principal_type === "service_account"
              ? "service"
              : m.principal_type === "user"
                ? "human"
                : "unknown",
          role: m.role,
          team: m.team_id || "",
          binding: "unlinked",
        })),
      };
    }
    if (owner === "scaena") {
      const v = await this.request(
        owner,
        s,
        scope,
        "/api/v1/projects/" + encodeURIComponent(b.project) + "/members",
      );
      return {
        tenant: b.tenant,
        members: (v.data || []).map((m: any) => ({
          id: m.actor_id || m.ActorID,
          name: m.actor_id || m.ActorID,
          type: "unknown",
          role: m.role || m.Role,
          team: "",
          binding: "unlinked",
        })),
      };
    }
    return this.request(
      owner,
      s,
      scope,
      "/api/v1/control-center/organization?" +
        new URLSearchParams({ tenant_id: b.tenant, project_id: b.project }),
    );
  }
}
export { owners };
