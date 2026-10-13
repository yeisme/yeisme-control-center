export type MediaKind = "image" | "video" | "audio" | "document" | "unknown";

// Keep rendering aligned with MediaBridge's whitelist, not the broader labels.
const previewKinds: Record<string, MediaKind> = {
  "image/jpeg": "image", "image/png": "image", "image/gif": "image", "image/webp": "image",
  "video/mp4": "video", "video/webm": "video",
  "audio/wav": "audio", "audio/mpeg": "audio", "audio/ogg": "audio", "audio/mp4": "audio",
  "audio/flac": "audio", "audio/aac": "audio",
};
const extensionKinds: Record<string, MediaKind> = {
  jpg: "image", jpeg: "image", png: "image", gif: "image", webp: "image", svg: "image",
  mp4: "video", webm: "video", wav: "audio", mp3: "audio", ogg: "audio", oga: "audio",
  m4a: "audio", flac: "audio", aac: "audio", pdf: "document", txt: "document", csv: "document", json: "document",
};

export function mediaPreviewKind(mime: string): MediaKind {
  const normalized = mime.trim().toLowerCase().split(";", 1)[0].trim();
  return Object.hasOwn(previewKinds, normalized) ? previewKinds[normalized] : "unknown";
}

export function mediaKind(mime: string, ref: string): MediaKind {
  if (mime.trim()) {
    const normalized = mime.trim().toLowerCase().split(";", 1)[0].trim();
    if (/^image\/[a-z0-9.+-]+$/.test(normalized)) return "image";
    if (/^video\/[a-z0-9.+-]+$/.test(normalized)) return "video";
    if (/^audio\/[a-z0-9.+-]+$/.test(normalized)) return "audio";
    if (/^text\/[a-z0-9.+-]+$/.test(normalized) || ["application/pdf", "application/json"].includes(normalized)) return "document";
    return "unknown";
  }
  const clean = ref.split(/[?#]/, 1)[0];
  const extension = clean.match(/(?:^|[/:])[^/\\\s%?#]+\.([a-z0-9]+)$/i)?.[1].toLowerCase();
  return extension && Object.hasOwn(extensionKinds, extension) ? extensionKinds[extension] : "unknown";
}

export function mediaKindLabel(kind: MediaKind): string {
  return ({ image: "图片", video: "视频", audio: "音频", document: "文稿", unknown: "未知媒体" })[kind];
}

export function mediaErrorCode(code: unknown, status: number): string {
  if (status === 401 || code === "login_required" || code === "identity_not_bound") return "login_required";
  if (status === 403) return "content_not_authorized";
  const safeCodes = [
    "content_not_authorized", "owner_action_denied", "needs_authorization", "media_needs_contract",
    "media_grant_expired", "media_handle_expired", "artifact_not_found", "media_not_found", "task_not_found",
    "media_unavailable", "source_unavailable", "media_limits_exceeded", "media_capacity", "media_busy",
    "media_address_denied", "media_unsupported", "invalid_range", "media_range_invalid",
    "media_transfer_aborted", "media_length_mismatch", "media_stream_failed",
  ];
  if (typeof code === "string" && safeCodes.includes(code)) return code;
  const statusCodes: Record<number, string> = {
    404: "artifact_not_found", 410: "media_grant_expired", 416: "invalid_range",
    422: "media_needs_contract", 429: "media_busy", 503: "media_unavailable",
  };
  return statusCodes[status] || "media_unavailable";
}

export function mediaErrorMessage(code: string): string {
  const messages: Record<string, string> = {
    login_required: "登录已过期，请重新登录后查看原任务。",
    identity_not_bound: "当前会话身份不可用，请重新登录。",
    scope_not_found: "当前工作区不可访问，请重新选择已授权工作区。",
    content_not_authorized: "未授予内容读取权限；任务读取不会继承该权限。请检查本地内容意愿和 owner 的独立 content purpose。",
    owner_action_denied: "来源拒绝内容动作，请检查独立内容授权，不要重试生成。",
    needs_authorization: "来源授权已失效，请检查原任务和内容的独立权限。",
    media_needs_contract: "来源媒体合同不完整，请检查 MIME、有效期和 artifact_access grant 合同。",
    media_grant_expired: "预览已过期，请点击重新获取预览。",
    media_handle_expired: "预览已过期，请点击重新获取预览。",
    artifact_not_found: "结果已不属于当前任务或当前身份不可见，请刷新原任务。",
    media_not_found: "媒体句柄不可见或已失效，请重新获取预览。",
    task_not_found: "当前任务或结果不可见，请刷新任务列表。",
    media_unavailable: "来源媒体暂不可用，请稍后点击重新获取预览。",
    source_unavailable: "来源暂不可用，请稍后点击重新获取预览。",
    media_limits_exceeded: "媒体类型、长度或大小不符合传输限制；请检查来源媒体合同。",
    media_capacity: "媒体句柄或授权请求已达到容量上限，请稍后重试。",
    media_busy: "媒体传输繁忙或达到并发上限，请稍后重试。",
    media_address_denied: "媒体地址未通过控制中心校验，不会访问来源地址。",
    media_unsupported: "当前来源未提供可预览媒体；仅保留结果引用。",
    invalid_range: "媒体请求范围无效，请重新获取预览。",
    media_range_invalid: "来源媒体分段响应不符合合同，请检查来源服务。",
    media_transfer_aborted: "媒体传输中断，请点击重新获取预览。",
    media_length_mismatch: "来源媒体长度与合同不符，请检查来源服务。",
    media_stream_failed: "媒体传输失败，请点击重新获取预览。",
  };
  return Object.hasOwn(messages, code) ? messages[code] : "媒体读取未完成；请检查内容权限与来源合同后再操作。";
}
