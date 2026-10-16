import { assetGroups, capabilities, capabilityCatalog, delivery, projects, reviews, tasks, usageFacts } from "../src/workspace-v18/fixtures";
import type { AssetGroup, CreationTask, WorkspaceV18State } from "../src/workspace-v18/types";
import { randomBytes } from "node:crypto";

const response = (body: unknown, status = 200) => Response.json(body, {
  status,
  headers: {
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "X-Yeisme-Demo": "workspace-v18",
  },
});

const copy = <T>(value: T): T => structuredClone(value);

function initialState(): WorkspaceV18State {
  return copy({ projects, capabilities, capabilityCatalog, usage: usageFacts, tasks, assets: assetGroups, reviews, delivery });
}

function bodyValue(value: unknown, key: string, max = 240) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "";
  const candidate = (value as Record<string, unknown>)[key];
  return typeof candidate === "string" ? candidate.trim().slice(0, max) : "";
}

function advance(task: CreationTask) {
  const order = ["queued", "running", "succeeded", "waiting_review"] as const;
  const index = order.indexOf(task.status as (typeof order)[number]);
  const next = order[Math.min(Math.max(index, 0) + 1, order.length - 1)];
  return {
    ...task,
    status: next,
    updated: "刚刚",
    stage:
      next === "running"
        ? "正在生成演示结果"
        : next === "succeeded"
          ? "结果已保存为候选版本"
          : next === "waiting_review"
            ? "候选版本等待团队决策"
            : task.stage,
  };
}

export function createWorkspaceV18Demo() {
  let state = initialState();
  let sequence = 0;
  const handles = new Map<string, { bytes: Uint8Array; mime: string; filename: string; expires: number }>();
  const demoBytes = (asset: AssetGroup, versionId: string) => {
    const version = asset.versions.find((candidate) => candidate.id === versionId)!;
    if (asset.kind === "image") {
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800"><rect width="100%" height="100%" fill="#214b3e"/><text x="60" y="120" fill="#d0e778" font-size="48" font-family="sans-serif">Yeisme demo</text><text x="60" y="190" fill="white" font-size="32" font-family="sans-serif">${asset.name} · ${version.version}</text></svg>`;
      return { bytes: new TextEncoder().encode(svg), mime: "image/svg+xml", filename: `${asset.id}-${version.version}.svg` };
    }
    const text = `Yeisme Workspace v18 demo asset\n${asset.name}\n${version.version}\n`;
    return { bytes: new TextEncoder().encode(text), mime: "text/plain", filename: `${asset.id}-${version.version}.txt` };
  };
  return async (request: Request, path: string) => {
    if (request.method === "GET" && path === "/workspace-v18/state") return response(copy(state));
    const mediaMatch = path.match(/^\/workspace-v18\/media\/([A-Za-z0-9_-]+)$/);
    if (request.method === "GET" && mediaMatch) {
      const handle = handles.get(mediaMatch[1]);
      if (!handle || handle.expires <= Date.now()) return response({ error: "download_handle_expired" }, 410);
      return new Response(Buffer.from(handle.bytes), { headers: { "Content-Type": handle.mime, "Content-Length": String(handle.bytes.byteLength), "Content-Disposition": `attachment; filename="${handle.filename}"`, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
    }
    if (request.method !== "POST") return response({ error: "operation_not_allowed" }, 405);
    if (path === "/workspace-v18/reset") {
      state = initialState();
      sequence = 0;
      handles.clear();
      return response(copy(state));
    }
    const raw = await request.text();
    if (raw.length > 4096) return response({ error: "invalid_request" }, 400);
    let parsed: unknown = {};
    try { parsed = raw ? JSON.parse(raw) : {}; } catch { return response({ error: "invalid_request" }, 400); }

    if (path === "/workspace-v18/tasks") {
      const projectId = bodyValue(parsed, "projectId", 80);
      const unitId = bodyValue(parsed, "unitId", 80);
      const capability = bodyValue(parsed, "capability", 80);
      const title = bodyValue(parsed, "title", 200);
      if (!projectId || !unitId || !capability || !title) return response({ error: "invalid_request" }, 400);
      const task: CreationTask = {
        id: `task-demo-${++sequence}`,
        title,
        capability,
        projectId,
        unitId,
        status: "queued",
        createdBy: "当前用户",
        updated: "刚刚",
        stage: "演示任务已创建，等待执行",
        source: "demo_fixture",
        completeness: "complete",
        resultAssetIds: [],
        formPayload: parsed && typeof parsed === "object" && !Array.isArray(parsed) && typeof (parsed as Record<string, unknown>).formPayload === "object"
          ? (parsed as Record<string, any>).formPayload
          : undefined,
      };
      state = { ...state, tasks: [task, ...state.tasks] };
      return response(copy(state));
    }

    const downloadMatch = path.match(/^\/workspace-v18\/assets\/([^/]+)\/versions\/([^/]+)\/access$/);
    if (downloadMatch) {
      const asset = state.assets.find((item) => item.id === decodeURIComponent(downloadMatch[1]));
      const version = asset?.versions.find((item) => item.id === decodeURIComponent(downloadMatch[2]));
      if (!asset || !version) return response({ error: "invalid_reference" }, 400);
      if (version.contentState !== "available" || version.downloadable !== true) return response({ error: version.downloadReason || "content_not_authorized" }, 403);
      const key = randomBytes(24).toString("base64url");
      const content = demoBytes(asset, version.id);
      handles.set(key, { ...content, expires: Date.now() + 120000 });
      return response({ url: `/api/control-center/v1/workspace-v18/media/${key}`, expires_at: new Date(Date.now() + 120000).toISOString(), filename: content.filename });
    }

    const advanceMatch = path.match(/^\/workspace-v18\/tasks\/([^/]+)\/advance$/);
    if (advanceMatch) {
      const id = decodeURIComponent(advanceMatch[1]);
      if (!state.tasks.some((task) => task.id === id)) return response({ error: "not_found" }, 404);
      state = { ...state, tasks: state.tasks.map((task) => task.id === id ? advance(task) : task) };
      return response(copy(state));
    }

    const approveMatch = path.match(/^\/workspace-v18\/reviews\/([^/]+)\/approve$/);
    if (approveMatch) {
      const assetId = decodeURIComponent(approveMatch[1]);
      const versionId = bodyValue(parsed, "versionId", 100);
      const asset = state.assets.find((item) => item.id === assetId);
      if (!asset || !versionId || !asset.versions.some((version) => version.id === versionId)) return response({ error: "invalid_reference" }, 400);
      const assets = state.assets.map((item) => item.id !== assetId ? item : ({
        ...item,
        versions: item.versions.map((version) => ({
          ...version,
          state: version.id === versionId ? "adopted" : version.state,
          review: version.id === versionId ? "approved" : version.review,
        })),
      } as AssetGroup));
      const nextReviews = state.reviews.map((review) => review.assetId === assetId ? { ...review, state: "approved" as const, selectedVersionId: versionId, reviewer: "当前用户" } : review);
      state = { ...state, assets, reviews: nextReviews };
      return response(copy(state));
    }

    if (path === "/workspace-v18/delivery/generate") {
      const items = state.delivery.items.map((item) => ({
        ...item,
        included: state.assets.find((asset) => asset.id === item.assetId)?.versions.some((version) => version.state === "adopted") || false,
      }));
      state = { ...state, delivery: { ...state.delivery, items, state: items.every((item) => !item.required || item.included) ? "ready" : "missing" } };
      return response(copy(state));
    }
    return response({ error: "not_found" }, 404);
  };
}
