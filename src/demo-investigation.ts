import type { RequestFact } from "./admin-state";
import type {
  RequestProjection,
  Owner,
  ContentRead,
} from "./request-visibility";
export function demoInvestigation(r: RequestFact): RequestProjection {
  const media = r.kind === "generation",
    image = r.owner === "eikona",
    audio = r.owner === "sonora";
  const attachments: RequestProjection["attachments"] = media
    ? [
        {
          ref: "demo:input:" + r.id,
          name: image
            ? "镜头构图参考.png"
            : audio
              ? "台词与语气说明.txt"
              : "分镜参考.mp4",
          mime: image ? "image/png" : audio ? "text/plain" : "video/mp4",
          bytes: image ? 1482752 : audio ? 2400 : null,
          source: "upload",
          state: "complete",
          upload_ref: "demo:upload:" + r.id,
          downloadable: false,
          ...(image ? { width: 1536, height: 1024 } : {}),
        },
      ]
    : [];
  for (const ref of r.assetRefs)
    attachments.push({
      ref,
      name: ref.split(":").at(-1) || "生成产物",
      mime: image ? "image/png" : audio ? "audio/wav" : "video/mp4",
      bytes: null,
      source: "generated",
      state: "partial",
      downloadable: false,
    });
  return {
    id: r.id,
    owner: r.owner as Owner,
    tenant: r.tenant,
    project: r.project,
    title: r.title,
    kind: r.kind,
    state: r.state,
    native_state: r.native,
    actor: r.actor,
    actor_type: r.actor.includes("service") ? "service" : "human",
    created_at: r.createdAt,
    duration_ms: r.duration,
    model: r.model,
    parent_ref: r.parentRef || null,
    attempts: [],
    output_refs: r.assetRefs,
    attachments,
    input: "complete",
    output: r.state === "succeeded" ? "complete" : "pending",
    submitted: { model: r.model, ...(media ? { count: 1 } : { stream: true }) },
    effective: { model: r.model },
    coverage: {
      owner: r.owner as Owner,
      state: "partial",
      observed_at: r.createdAt,
      reason:
        "设计演示。附件元数据与业务文本用于验证布局；未提供真实执行尝试引用。",
    },
    finance: {
      currency: r.currency,
      amount: r.amount,
      state: r.costState,
      charge_ref: r.chargeRef,
    },
  };
}
export async function demoRead(
  direction: "input" | "output",
  _purpose: string,
  signal: AbortSignal,
): Promise<ContentRead> {
  await new Promise((r) => setTimeout(r, 160));
  if (signal.aborted) throw new DOMException("Aborted", "AbortError");
  return {
    state: "complete",
    text:
      direction === "input"
        ? "【设计样例】\n制作雨夜街口的镜头。人物停在路灯下，保持既定服装和构图，背景有轻微雨雾。\n\n输入附件：镜头构图参考。此文本为界面演示创作，不来自真实请求。"
        : "【设计样例】\n已生成候选结果，等待专业工作台审阅。\n\n实际生成内容、可下载文件和交接状态由 owner 返回。",
    truncated: false,
    receipt_ref: "demo:content-read:" + direction,
  };
}
