import { randomBytes } from "node:crypto";
import { AuthError } from "./auth";
import { TaskConnections } from "./task-connections";
import type { ScopeBinding, Session } from "./contracts";
const maxBytes = 128 * 1024 * 1024;
const allowedMimes = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "audio/wav",
  "audio/mpeg",
  "audio/ogg",
  "audio/mp4",
  "audio/flac",
  "audio/aac",
  "video/mp4",
  "video/webm",
]);
interface Handle {
  session: string;
  scope: string;
  task: string;
  ref: string;
  expires: number;
  download: boolean;
  url: URL;
  grantExpires: number;
}
export class MediaBridge {
  private handles = new Map<string, Handle>();
  private inFlight = 0;
  private issuing = 0;
  constructor(
    private tasks: TaskConnections,
    private fetcher: typeof fetch = fetch,
  ) {}
  async issue(
    session: Session,
    scope: ScopeBinding,
    task: string,
    ref: string,
    action: "preview" | "download",
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
      this.handles.set(handle, {
        session: session.id,
        scope: scope.id,
        task,
        ref,
        download: action === "download",
        expires: Date.now() + 120000,
        url: grant.url,
        grantExpires: grant.expires,
      });
      return {
        url:
          "/api/control-center/v1/media/" +
          handle +
          "?scope=" +
          encodeURIComponent(scope.id),
        expires_at: new Date(this.handles.get(handle)!.expires).toISOString(),
        mime,
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
    if (handle.expires <= Date.now()) {
      this.handles.delete(key);
      throw new AuthError("media_handle_expired", 410);
    }
    if (this.inFlight >= 4) throw new AuthError("media_busy", 429);
    const range = request.headers.get("range");
    if (range && !/^bytes=(?:\d+-\d*|-\d+)$/.test(range))
      throw new AuthError("invalid_range", 416);
    this.inFlight++;
    let released = false;
    const release = () => {
      if (!released) {
        released = true;
        this.inFlight--;
      }
    };
    try {
      // Reauthorize on every transfer; URLs and upstream credentials never reach the browser.
      const { c } = this.tasks.locate(handle.task, scope);
      if (!c.allow_content) throw new AuthError("content_not_authorized", 403);
      const task = await this.tasks.detail(handle.task, scope);
      if (!task.results.some((a) => a.ref === handle.ref))
        throw new AuthError("artifact_not_found", 404);
      if (handle.grantExpires <= Date.now())
        throw new AuthError("media_grant_expired", 410);
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
            ...this.tasks.mediaHeaders(handle.task, scope),
            ...(range ? { Range: range } : {}),
          },
        });
      const upstream = await transfer();
      const reject = async (code: string, status: number) => {
        await upstream.body?.cancel();
        throw new AuthError(code, status);
      };
      if (upstream.status === 416) return await reject("invalid_range", 416);
      if (![200, 206].includes(upstream.status))
        return await reject("media_unavailable", 503);
      const mime =
        upstream.headers
          .get("content-type")
          ?.split(";")[0]
          .trim()
          .toLowerCase() || "";
      const length = Number(upstream.headers.get("content-length"));
      if (
        !allowedMimes.has(mime) ||
        !upstream.headers.has("content-length") ||
        !Number.isSafeInteger(length) ||
        length < 0 ||
        length > maxBytes
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
          ![start, end, total].every(Number.isSafeInteger) ||
          start > end ||
          end >= total ||
          end - start + 1 !== length ||
          total > maxBytes
        )
          return await reject("media_range_invalid", 503);
      }
      const headers: Record<string, string> = {
        "Content-Type": mime,
        "Content-Length": String(length),
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
        "Referrer-Policy": "no-referrer",
        "Accept-Ranges": "bytes",
        "Content-Disposition": `${handle.download ? "attachment" : "inline"}; filename="result"`,
      };
      if (contentRange && upstream.status === 206)
        headers["Content-Range"] = contentRange;
      if (request.method === "HEAD") {
        await upstream.body?.cancel();
        release();
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
              if (bytes !== length) throw new Error("media_length_mismatch");
              controller.close();
              finish();
              return;
            }
            bytes += next.value.length;
            if (bytes > length || bytes > maxBytes)
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
      return new Response(body, { status: upstream.status, headers });
    } catch (e) {
      release();
      throw e;
    }
  }
}
