import { randomBytes } from "node:crypto";
import { AuthError } from "./auth";
import { TaskConnections } from "./task-connections";
import { AuditStore } from "./db/audit";
import { createMemoryDB } from "./db/client";
import type { ScopeBinding, Session } from "./contracts";
import { mediaFilename } from "../src/shared/media-filename";
import type {
  EpisodeArtifactAccessPort,
  EpisodeArtifactGrant,
  EpisodeArtifactTarget,
  EpisodeMediaPurpose,
} from "./episode-artifact-access";
const maxBytes = 128 * 1024 * 1024;
const allowedMimes = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "audio/wav",
  "audio/x-wav",
  "audio/vnd.wave",
  "audio/mpeg",
  "audio/ogg",
  "audio/webm",
  "audio/mp4",
  "audio/m4a",
  "audio/x-m4a",
  "audio/flac",
  "audio/aac",
  "video/mp4",
  "video/webm",
]);
interface HandleBase {
  session: string;
  scope: string;
  ref: string;
  expires: number;
  download: boolean;
  thumbnail?: boolean;
  url: URL;
  grantExpires: number;
  filename: string;
  /** Bytes handle: in-memory attachment body, no upstream URL. */
  bytes?: Uint8Array;
  bytesMime?: string;
}
type Handle = HandleBase & (
  | { kind: "task" | "attachment"; task: string }
  | { kind: "episode"; episode: {
      target: EpisodeArtifactTarget;
      purpose: EpisodeMediaPurpose;
      grantId: string;
      mime: string;
      size: number;
      /** Stable identity only: authentication touch/refresh fields are not authority. */
      sessionBinding: string;
      scopeBinding: string;
    } }
);

function episodeSessionBinding(session: Session): string {
  return JSON.stringify([session.id, session.issuer, session.subject, session.epoch, session.personal ?? false]);
}

function episodeScopeBinding(scope: ScopeBinding): string {
  const bindings = (values: Partial<Record<string, { tenant: string; project: string; actor: string; audience: string }>> | undefined) =>
    Object.entries(values ?? {}).sort(([a], [b]) => a.localeCompare(b)).map(([owner, binding]) =>
      [owner, binding && [binding.tenant, binding.project, binding.actor, binding.audience]]);
  return JSON.stringify({
    id: scope.id, tenant: scope.tenant, team: scope.team, project: scope.project,
    connection_ids: [...(scope.connection_ids ?? [])].sort(),
    owners: bindings(scope.owners), collection: bindings(scope.collection),
    projects: scope.projects?.map((project) => [project.owner, project.project_ref, [...project.connection_ids].sort()])
      .sort(([ownerA, refA], [ownerB, refB]) => `${ownerA}:${refA}`.localeCompare(`${ownerB}:${refB}`)),
    open_tools: [...(scope.open_tools ?? [])].sort(),
  });
}

function encodeFilename(value: string) {
  return encodeURIComponent(value).replace(/[!'()*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
}

function contentDisposition(disposition: "inline" | "attachment", filename: string) {
  const ascii = filename.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return `${disposition}; filename="${ascii}"; filename*=UTF-8''${encodeFilename(filename)}`;
}
export class MediaBridge {
  private handles = new Map<string, Handle>();
  private inFlight = 0;
  private issuing = 0;
  private audit: AuditStore;
  constructor(
    private tasks: TaskConnections,
    private fetcher: typeof fetch = fetch,
    audit?: AuditStore,
    private episodePort?: EpisodeArtifactAccessPort,
  ) {
    this.audit = audit ?? new AuditStore(createMemoryDB());
  }
  /** Issues a short-lived in-memory handle for attachment bytes (no upstream URL). */
  issueBytes(
    session: Session,
    scope: ScopeBinding,
    ref: string,
    mime: string,
    bytes: Uint8Array,
  ): { url: string; expires_at: string; mime: string; filename: string } {
    for (const [key, value] of this.handles)
      if (value.expires <= Date.now()) this.handles.delete(key);
    if (this.handles.size >= 256)
      throw new AuthError("media_capacity", 429);
    if (!allowedMimes.has(mime))
      throw new AuthError("media_limits_exceeded", 422);
    const handle = randomBytes(32).toString("base64url");
    this.handles.set(handle, {
      session: session.id,
      scope: scope.id,
      kind: "attachment",
      task: "attachment:" + ref,
      ref,
      download: false,
      expires: Date.now() + 120000,
      url: new URL("attachment://local"),
      grantExpires: Date.now() + 120000,
      filename: mediaFilename(ref, mime, "attachment"),
      bytes,
      bytesMime: mime,
    });
    return {
      url:
        "/api/control-center/v1/media/" +
        handle +
        "?scope=" +
        encodeURIComponent(scope.id),
      expires_at: new Date(this.handles.get(handle)!.expires).toISOString(),
      mime,
      filename: this.handles.get(handle)!.filename,
    };
  }
  async issue(
    session: Session,
    scope: ScopeBinding,
    task: string,
    ref: string,
    action: "preview" | "download" | "thumbnail",
  ) {
    for (const [key, value] of this.handles)
      if (value.expires <= Date.now()) this.handles.delete(key);
    if (this.handles.size + this.issuing >= 256 || this.issuing >= 4)
      throw new AuthError("media_capacity", 429);
    this.issuing++;
    try {
      const grant = await this.tasks.artifact(task, scope, ref, action);
      const handle = randomBytes(32).toString("base64url");
      let mime = allowedMimes.has(grant.artifact.mime) ? grant.artifact.mime : "";
      if (!mime) {
        try {
          const probe = await this.fetcher(grant.url, {
            method: "HEAD",
            redirect: "error",
            signal: AbortSignal.timeout(10000),
            headers: this.tasks.mediaHeaders(task, scope),
          });
          const candidate = probe.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() || "";
          if (probe.ok && allowedMimes.has(candidate)) mime = candidate;
          await probe.body?.cancel();
        } catch {
          // The owner may not implement HEAD. The transfer path will still
          // validate the content type before returning any bytes.
        }
      }
      const filename = mediaFilename(grant.artifact.name, mime || grant.artifact.mime, "result");
      this.handles.set(handle, {
        session: session.id,
        scope: scope.id,
        kind: "task",
        task,
        ref,
        download: action === "download",
        thumbnail: action === "thumbnail",
        expires: Math.min(Date.now() + 120000, grant.expires),
        url: grant.url,
        grantExpires: grant.expires,
        filename,
      });
      return {
        url:
          "/api/control-center/v1/media/" +
          handle +
          "?scope=" +
          encodeURIComponent(scope.id),
        expires_at: new Date(this.handles.get(handle)!.expires).toISOString(),
        mime,
        filename,
      };
    } finally {
      this.issuing--;
    }
  }
  private validateEpisodeGrant(
    scope: ScopeBinding,
    target: EpisodeArtifactTarget,
    purpose: EpisodeMediaPurpose,
    grant: EpisodeArtifactGrant | null,
  ): EpisodeArtifactGrant {
    if (!grant) throw new AuthError("needs_contract", 409);
    if (grant.revoked !== false || grant.credentialRevoked !== false)
      throw new AuthError("content_not_authorized", 403);
    if (typeof grant.grantId !== "string" || !grant.grantId || typeof grant.name !== "string" ||
        grant.scopeId !== scope.id || grant.purpose !== purpose ||
        !grant.target || (Object.keys(target) as (keyof EpisodeArtifactTarget)[]).some(
          (key) => grant.target[key] !== target[key],
        )) throw new AuthError("episode_binding_mismatch", 403);
    if (!Number.isFinite(grant.expires) || grant.expires <= Date.now())
      throw new AuthError("media_grant_expired", 410);
    if (!allowedMimes.has(grant.mime) ||
        (purpose === "thumbnail" && !grant.mime.startsWith("image/")) ||
        !Number.isSafeInteger(grant.size) || grant.size < 0 ||
        grant.size > (purpose === "thumbnail" ? 1024 * 1024 : maxBytes))
      throw new AuthError("media_limits_exceeded", 422);
    try {
      const origin = new URL(this.episodePort!.trustedOrigin);
      const url = new URL(grant.validatedURL.href);
      if (!["http:", "https:"].includes(origin.protocol) ||
          origin.username || origin.password || origin.hash || origin.search || origin.pathname !== "/" ||
          !["http:", "https:"].includes(url.protocol) || url.origin !== origin.origin ||
          url.username || url.password || url.href.includes("#"))
        throw new Error("untrusted URL");
    } catch {
      throw new AuthError("media_url_rejected", 403);
    }
    return grant;
  }

  /** Internal episode access seam; no task synthesis and no provider fallback. */
  async issueEpisode(
    session: Session,
    scope: ScopeBinding,
    target: EpisodeArtifactTarget,
    purpose: EpisodeMediaPurpose,
  ) {
    if (!this.episodePort) throw new AuthError("needs_contract", 409);
    if (!target || !["connection", "episode_ref", "artifact_ref", "expected_revision"].every(
      (key) => {
        const value = target[key as keyof EpisodeArtifactTarget];
        return typeof value === "string" && value.length > 0 && value.length <= 512 &&
          value === value.trim() && !/[\u0000-\u001f\u007f-\u009f]/.test(value);
      },
    ) || typeof target.digest !== "string" || !/^sha256:[a-f0-9]{64}$/.test(target.digest) ||
        !["preview", "download", "thumbnail"].includes(purpose))
      throw new AuthError("episode_binding_mismatch", 403);
    for (const [key, value] of this.handles)
      if (value.expires <= Date.now()) this.handles.delete(key);
    if (this.handles.size + this.issuing >= 256 || this.issuing >= 4)
      throw new AuthError("media_capacity", 429);
    this.issuing++;
    try {
      const bound = { ...target };
      const grant = this.validateEpisodeGrant(scope, bound, purpose,
        await this.episodePort.authorize(scope, { ...bound }, purpose));
      const key = randomBytes(32).toString("base64url");
      const expires = Math.min(Date.now() + 120000, grant.expires);
      const filename = mediaFilename(grant.name, grant.mime, "result");
      this.handles.set(key, {
        kind: "episode",
        session: session.id,
        scope: scope.id,
        ref: bound.artifact_ref,
        download: purpose === "download",
        thumbnail: purpose === "thumbnail",
        expires,
        grantExpires: grant.expires,
        url: new URL(grant.validatedURL.href),
        filename,
        episode: { target: bound, purpose, grantId: grant.grantId, mime: grant.mime,
          size: grant.size, sessionBinding: episodeSessionBinding(session), scopeBinding: episodeScopeBinding(scope) },
      });
      return {
        url: "/api/control-center/v1/media/" + key + "?scope=" + encodeURIComponent(scope.id),
        expires_at: new Date(expires).toISOString(),
        mime: grant.mime,
        filename,
      };
    } finally {
      this.issuing--;
    }
  }

  async read(
    key: string,
    request: Request,
    session: Session,
    scope: ScopeBinding,
  ): Promise<Response> {
    const handle = this.handles.get(key);
    if (!handle || handle.session !== session.id || handle.scope !== scope.id)
      throw new AuthError("media_not_found", 404);
    if (handle.kind === "episode" &&
        (handle.episode.sessionBinding !== episodeSessionBinding(session) || handle.episode.scopeBinding !== episodeScopeBinding(scope)))
      throw new AuthError("media_not_found", 404);
    if (handle.expires <= Date.now()) {
      this.handles.delete(key);
      throw new AuthError("media_handle_expired", 410);
    }
    if (this.inFlight >= 4) throw new AuthError("media_busy", 429);
    // In-memory attachment bytes: serve directly, audit-first, no upstream hop.
    if (handle.bytes) {
      const eventId = this.audit.begin({
        actor: session.issuer + "|" + session.subject,
        sessionId: session.id,
        scopeId: scope.id,
        action: "media.read",
        targetRef: handle.ref,
        purpose: "attachment-preview",
      });
      this.inFlight++;
      try {
        this.audit.complete(eventId, "succeeded");
        const headers: Record<string, string> = {
          "Content-Type": handle.bytesMime!,
          "Content-Length": String(handle.bytes.length),
          "Cache-Control": "no-store",
          "X-Content-Type-Options": "nosniff",
          "Referrer-Policy": "no-referrer",
          "Content-Disposition": contentDisposition("inline", handle.filename),
        };
        return new Response(request.method === "HEAD" ? null : new Uint8Array(handle.bytes), { status: 200, headers });
      } catch (e) {
        this.audit.complete(eventId, e instanceof AuthError ? "failed" : "unavailable", e instanceof AuthError ? e.code : "media_transfer_failed");
        throw e;
      } finally {
        this.inFlight--;
      }
    }
    const range = handle.thumbnail ? null : request.headers.get("range");
    const transferLimit = handle.thumbnail ? 1024 * 1024 : maxBytes;
    if (range && !/^bytes=(?:\d+-\d*|-\d+)$/.test(range))
      throw new AuthError("invalid_range", 416);
    this.inFlight++;
    // Audit-first: the transfer is recorded before any upstream reauthorization.
    const eventId = this.audit.begin({
      actor: session.issuer + "|" + session.subject,
      sessionId: session.id,
      scopeId: scope.id,
      action: "media.read",
      targetRef: handle.ref,
      purpose: handle.download ? "download" : "preview",
    });
    const auditFailure = (e: unknown) =>
      this.audit.complete(
        eventId,
        e instanceof AuthError && (e.status === 401 || e.status === 403)
          ? "denied"
          : e instanceof AuthError
            ? "failed"
            : "unavailable",
        e instanceof AuthError ? e.code : "media_transfer_failed",
      );
    let released = false;
    const release = () => {
      if (!released) {
        released = true;
        this.inFlight--;
      }
    };
    try {
      // Reauthorize on every transfer; URLs and upstream credentials never reach the browser.
      let mediaHeaders: Record<string, string>;
      if (handle.kind === "episode") {
        if (!this.episodePort) throw new AuthError("needs_contract", 409);
        if (handle.grantExpires <= Date.now()) throw new AuthError("media_grant_expired", 410);
        const bound = handle.episode;
        const grant = this.validateEpisodeGrant(scope, bound.target, bound.purpose,
          await this.episodePort.authorize(scope, { ...bound.target }, bound.purpose));
        if (grant.grantId !== bound.grantId || grant.expires !== handle.grantExpires ||
            grant.validatedURL.href !== handle.url.href || grant.mime !== bound.mime || grant.size !== bound.size)
          throw new AuthError("episode_grant_changed", 403);
        mediaHeaders = {};
      } else {
        const { c } = this.tasks.locate(handle.task, scope);
        if (c.allow_content === false) throw new AuthError("content_not_authorized", 403);
        const task = await this.tasks.detail(handle.task, scope);
        if (!task.results.some((a) => a.ref === handle.ref)) throw new AuthError("artifact_not_found", 404);
        if (handle.thumbnail && !task.results.some((a) => a.ref === handle.ref && a.thumbnail?.state === "ready")) throw new AuthError("thumbnail_unavailable", 410);
        if (handle.grantExpires <= Date.now()) throw new AuthError("media_grant_expired", 410);
        mediaHeaders = this.tasks.mediaHeaders(handle.task, scope);
      }
      const transferSignal = AbortSignal.any([
        request.signal,
        AbortSignal.timeout(30000),
      ]);
      const transfer = () =>
        this.fetcher(handle.url, {
          method: request.method,
          redirect: "error",
          signal: transferSignal,
          headers: {
            ...mediaHeaders,
            ...(range ? { Range: range } : {}),
          },
        });
      const upstream = await transfer();
      const reject = async (code: string, status: number) => {
        await upstream.body?.cancel();
        throw new AuthError(code, status);
      };
      if (handle.kind === "episode" && (upstream.redirected ||
          (upstream.url && new URL(upstream.url).href !== handle.url.href)))
        return await reject("media_url_rejected", 403);
      if (upstream.status === 416) return await reject("invalid_range", 416);
      if (![200, 206].includes(upstream.status)) {
        const failure: readonly [string, number] = upstream.status === 401 || upstream.status === 403
          ? ["media_source_unauthorized", 403]
          : upstream.status === 404
            ? ["media_source_not_found", 404]
            : upstream.status === 410
              ? ["media_grant_expired", 410]
              : upstream.status === 429
                ? ["media_busy", 429]
                : ["media_unavailable", 503];
        return await reject(failure[0], failure[1]);
      }
      const mime =
        upstream.headers
          .get("content-type")
          ?.split(";")[0]
          .trim()
          .toLowerCase() || "";
      const contentLength = upstream.headers.get("content-length");
      const length = contentLength === null ? null : Number(contentLength);
      if (
        !allowedMimes.has(mime) || (handle.thumbnail && !mime.startsWith("image/")) ||
        (handle.kind === "episode" && (mime !== handle.episode.mime ||
          (upstream.status === 200 && length !== null && length !== handle.episode.size))) ||
        (length !== null && (!Number.isSafeInteger(length) || length < 0 || length > transferLimit))
      )
        return await reject("media_limits_exceeded", 422);
      const contentRange = upstream.headers.get("content-range");
      if (upstream.status === 206) {
        const parts = contentRange?.match(/^bytes (\d+)-(\d+)\/(\d+)$/),
          start = Number(parts?.[1]),
          end = Number(parts?.[2]),
          total = Number(parts?.[3]);
        if (
          !range ||
          !parts ||
          length === null ||
          ![start, end, total].every(Number.isSafeInteger) ||
          start > end ||
          end >= total ||
          end - start + 1 !== length ||
          total > transferLimit ||
          (handle.kind === "episode" && total !== handle.episode.size)
        )
          return await reject("media_range_invalid", 503);
      }
      const headers: Record<string, string> = {
        "Content-Type": mime,
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
        "Referrer-Policy": "no-referrer",
        "Accept-Ranges": "bytes",
        "Content-Disposition": contentDisposition(handle.download ? "attachment" : "inline", handle.filename),
      };
      if (length !== null) headers["Content-Length"] = String(length);
      if (contentRange && upstream.status === 206)
        headers["Content-Range"] = contentRange;
      if (request.method === "HEAD") {
        await upstream.body?.cancel();
        release();
        this.audit.complete(eventId, "succeeded");
        return new Response(null, { status: upstream.status, headers });
      }
      const reader = upstream.body?.getReader();
      if (!reader) throw new AuthError("media_unavailable", 503);
      let bytes = 0;
      let stopTransfer: (() => void) | undefined;
      const finish = () => {
        if (stopTransfer)
          transferSignal.removeEventListener("abort", stopTransfer);
        release();
      };
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          stopTransfer = () => {
            void reader.cancel().catch(() => {});
            controller.error(new Error("media_transfer_aborted"));
            finish();
          };
          if (transferSignal.aborted) stopTransfer();
          else
            transferSignal.addEventListener("abort", stopTransfer, {
              once: true,
            });
        },
        async pull(controller) {
          try {
            const next = await reader.read();
            if (next.done) {
              if ((length !== null && bytes !== length) ||
                  (handle.kind === "episode" && upstream.status === 200 && bytes !== handle.episode.size))
                throw new Error("media_length_mismatch");
              controller.close();
              finish();
              return;
            }
            bytes += next.value.length;
            if ((length !== null && bytes > length) || bytes > transferLimit ||
                (handle.kind === "episode" && bytes > handle.episode.size))
              throw new Error("media_limits_exceeded");
            controller.enqueue(next.value);
          } catch {
            await reader.cancel().catch(() => {});
            controller.error(new Error("media_stream_failed"));
            finish();
          }
        },
        async cancel() {
          try {
            await reader.cancel();
          } finally {
            finish();
          }
        },
      });
      this.audit.complete(eventId, "succeeded");
      return new Response(body, { status: upstream.status, headers });
    } catch (e) {
      auditFailure(e);
      release();
      throw e;
    }
  }
}
