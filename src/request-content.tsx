import { useEffect, useRef, useState } from "react";
import {
  FileText,
  Image,
  Video,
  Volume2,
  Download,
  ArrowRight,
  LockKeyhole,
} from "./icons";
import { Button, Empty } from "./ui";
import { CopyReference, PanelNotice } from "./workspace";
import {
  bytesLabel,
  coverageLabels,
  type ContentRead,
  type RequestProjection,
} from "./request-visibility";

export function RequestContent({
  record,
  direction,
  read,
  download,
}: {
  record: RequestProjection;
  direction: "input" | "output";
  read?: (
    direction: "input" | "output",
    purpose: string,
    signal: AbortSignal,
  ) => Promise<ContentRead>;
  download?: (ref: string) => void;
}) {
  const [content, setContent] = useState<ContentRead | null>(null),
    [pending, setPending] = useState(false),
    [purpose, setPurpose] = useState("排查请求输入与执行结果");
  const controller = useRef<AbortController | null>(null);
  useEffect(() => {
    setContent(null);
    setPending(false);
    return () => controller.current?.abort();
  }, [record.id, record.tenant, direction]);
  const load = async () => {
    if (!read || pending || !purpose.trim()) return;
    controller.current?.abort();
    const abort = new AbortController();
    controller.current = abort;
    setPending(true);
    try {
      const value = await read(direction, purpose.trim(), abort.signal);
      if (!abort.signal.aborted) setContent(value);
    } catch {
      if (!abort.signal.aborted) setContent({ state: "unavailable" });
    } finally {
      if (!abort.signal.aborted) setPending(false);
    }
  };
  const files = record.attachments.filter((a) =>
    direction === "input" ? a.source !== "generated" : a.source === "generated",
  );
  return (
    <div className="request-content-stack">
      <section className="request-section">
        <div className="section-caption">
          <span>{direction === "input" ? "提交内容" : "响应内容"}</span>
          <span className="coverage-pill">
            {coverageLabels[record[direction]]}
          </span>
        </div>
        {content?.text !== undefined ? (
          <>
            <pre className="request-readable" tabIndex={0}>
              {content.text}
            </pre>
            {content.truncated && (
              <PanelNotice tone="warning" title="当前内容已截断">
                仅显示本次授权读取范围，不能视为完整正文。
              </PanelNotice>
            )}
            {content.receipt_ref && (
              <CopyReference value={content.receipt_ref} />
            )}
            <Button onClick={() => setContent(null)}>收起并清除正文</Button>
          </>
        ) : (
          <div className="content-read-card">
            <LockKeyhole size={19} />
            <strong>按需读取，访问留痕</strong>
            <p>展开后仅在当前工作区显示获授权的业务内容。</p>
            <label className="field-label" htmlFor={"purpose-" + direction}>
              读取用途
            </label>
            <input
              id={"purpose-" + direction}
              value={purpose}
              onChange={(e) => setPurpose(e.target.value)}
              maxLength={200}
            />
            <Button
              disabled={
                pending ||
                !read ||
                !purpose.trim() ||
                [
                  "forbidden",
                  "not_recorded",
                  "expired",
                  "needs_contract",
                ].includes(record[direction])
              }
              onClick={load}
            >
              {pending
                ? "正在读取…"
                : "读取完整" + (direction === "input" ? "输入" : "响应")}
            </Button>
            {content && <p role="status">{coverageLabels[content.state]}</p>}
          </div>
        )}
      </section>
      {direction === "input" && (
        <section className="request-section">
          <div className="section-caption">
            <span>执行参数</span>
            <span>提交值 → 生效值</span>
          </div>
          {Object.keys({ ...record.submitted, ...record.effective }).length ? (
            <dl className="parameter-diff">
              {Object.keys({ ...record.submitted, ...record.effective }).map(
                (k) => (
                  <div key={k}>
                    <dt>{k}</dt>
                    <dd>
                      <code>{String(record.submitted[k] ?? "未提供")}</code>
                      <ArrowRight size={12} />
                      <code>{String(record.effective[k] ?? "未确认")}</code>
                    </dd>
                  </div>
                ),
              )}
            </dl>
          ) : (
            <p className="muted">owner 未提供可展示的参数快照</p>
          )}
        </section>
      )}
      <section className="request-section">
        <div className="section-caption">
          <span>{direction === "input" ? "输入附件" : "输出文件"}</span>
          <span>{files.length} 项已关联</span>
        </div>
        {files.length ? (
          files.map((a) => {
            const Icon = a.mime.startsWith("image/")
              ? Image
              : a.mime.startsWith("audio/")
                ? Volume2
                : a.mime.startsWith("video/")
                  ? Video
                  : FileText;
            return (
              <article className="request-attachment" key={a.ref}>
                <div className="attachment-line">
                  <span className="attachment-icon">
                    <Icon size={19} />
                  </span>
                  <div>
                    <strong>{a.name}</strong>
                    <small>
                      {a.mime} · {bytesLabel(a.bytes)} ·{" "}
                      {
                        {
                          upload: "实际上传",
                          reference: "引用资产",
                          generated: "生成产物",
                        }[a.source]
                      }
                    </small>
                  </div>
                  {a.downloadable && download && (
                    <button
                      className="icon-button"
                      aria-label={"下载 " + a.name}
                      onClick={() => download(a.ref)}
                    >
                      <Download size={16} />
                    </button>
                  )}
                </div>
                <div className="attachment-meta">
                  <span>{coverageLabels[a.state]}</span>
                  {a.width && a.height && (
                    <span>
                      {a.width} × {a.height}
                    </span>
                  )}
                  {a.duration_ms !== undefined && (
                    <span>{a.duration_ms / 1000} 秒</span>
                  )}
                </div>
                <details>
                  <summary>来源与完整引用</summary>
                  <CopyReference value={a.ref} />
                  {a.upload_ref && <CopyReference value={a.upload_ref} />}
                  <p className="muted">SHA-256：{a.sha256 || "未提供"}</p>
                </details>
              </article>
            );
          })
        ) : (
          <Empty
            title="没有已关联文件"
            description="未提供关联证据，不推断文件数量。"
          />
        )}
      </section>
    </div>
  );
}

export function RequestOverview({ record: r }: { record: RequestProjection }) {
  return (
    <>
      <div className="request-owner-line">
        <span>{r.owner}</span>
        <span className="coverage-pill">
          {coverageLabels[r.coverage.state]}
        </span>
      </div>
      <dl className="admin-properties">
        {[
          ["请求引用", r.id],
          ["调用者", r.actor],
          [
            "账号类型",
            { human: "人类成员", service: "服务账号", unknown: "尚未确认" }[
              r.actor_type
            ],
          ],
          ["租户", r.tenant],
          ["项目", r.project],
          ["原始状态", r.native_state],
          ["模型", r.model || "未确认"],
          [
            "耗时",
            r.duration_ms === null
              ? "未知"
              : (r.duration_ms / 1000).toFixed(2) + " 秒",
          ],
          ["父请求", r.parent_ref || "未关联"],
          ["观察时间", r.coverage.observed_at],
        ].map(([k, v]) => (
          <div key={k}>
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
      <PanelNotice title="信息来自 owner 授权投影">
        {r.coverage.reason ||
          "请求、任务、执行尝试分别保留原始身份。缺失信息不显示为正常或零。"}
      </PanelNotice>
    </>
  );
}

export function RequestBody(
  props: Omit<Parameters<typeof RequestContent>[0], "direction">,
) {
  const [direction, setDirection] = useState<"input" | "output">("input");
  return (
    <>
      <div className="content-direction" role="group" aria-label="内容方向">
        <Button
          variant={direction === "input" ? "secondary" : "ghost"}
          aria-pressed={direction === "input"}
          onClick={() => setDirection("input")}
        >
          输入与附件
        </Button>
        <Button
          variant={direction === "output" ? "secondary" : "ghost"}
          aria-pressed={direction === "output"}
          onClick={() => setDirection("output")}
        >
          输出与响应
        </Button>
      </div>
      <RequestContent
        key={props.record.owner + props.record.id + direction}
        {...props}
        direction={direction}
      />
    </>
  );
}
