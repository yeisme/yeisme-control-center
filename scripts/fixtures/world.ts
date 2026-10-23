import { deflateSync } from "node:zlib";

export type Scenario = "rich" | "degraded" | "empty";
type Owner = "eikona" | "scaena" | "sonora";

const now = Date.now();
const minutes = (value: number) => new Date(now - value * 60_000).toISOString();

// --- Media bytes (generated, no assets on disk) ---

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buffer: Buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type: string, data: Buffer) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

/** Gradient tile with a soft diagonal band so previews look like real frames rather than flat swatches. */
export function png(width: number, height: number, from: [number, number, number], to: [number, number, number]) {
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 3 + 1)] = 0;
    for (let x = 0; x < width; x++) {
      const t = (x / width) * 0.6 + (y / height) * 0.4;
      const band = Math.max(0, 1 - Math.abs(((x + y * 1.4) % 180) - 90) / 90) * 0.18;
      const offset = y * (width * 3 + 1) + 1 + x * 3;
      for (let i = 0; i < 3; i++) raw[offset + i] = Math.min(255, Math.round(from[i] + (to[i] - from[i]) * t + 255 * band));
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", header), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

export function wav(seconds: number, frequency: number) {
  const rate = 16000;
  const samples = Math.round(rate * seconds);
  const buffer = Buffer.alloc(44 + samples * 2);
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(buffer.length - 8, 4);
  buffer.write("WAVEfmt ", 8);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(rate, 24);
  buffer.writeUInt32LE(rate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(samples * 2, 40);
  for (let i = 0; i < samples; i++) {
    const envelope = Math.min(1, i / 800, (samples - i) / 1600);
    buffer.writeInt16LE(Math.round(Math.sin((2 * Math.PI * frequency * i) / rate) * 9000 * envelope), 44 + i * 2);
  }
  return buffer;
}

// --- Task observation rows ---

export interface ResultSpec { ref: string; name: string; mime: string; bytes: number; width?: number; height?: number; duration_ms?: number; state: string; media: string; thumbnail?: { state: "ready" | "unavailable" | "forbidden" | "needs_contract"; ref?: string } }
export interface TaskSpec {
  owner: Owner;
  connection: string;
  project: string;
  family: string;
  ref: string;
  title: string;
  state: string;
  stage: string;
  createdMinutes: number;
  updatedMinutes: number;
  progress?: { kind: "percent" | "count" | "indeterminate"; completed?: number; total?: number; percent?: number };
  results?: ResultSpec[];
  episode?: string;
  recovery?: Record<string, unknown>;
  coverage?: "complete" | "partial";
  actor?: string;
}

export function taskRow(spec: TaskSpec) {
  const stages = spec.state === "queued" ? ["accepted", "queued"] : spec.state === "running" ? ["accepted", "queued", "validating", "submitting", "generating"] : ["accepted", "queued", "validating", "submitting", "generating", "downloading", spec.stage];
  const promptState = spec.state === "queued" ? "queued" : spec.state === "running" ? "captured" : spec.results?.length ? "captured" : "not_recorded";
  const promptCapture = { state: promptState, source: "task", capture_ref: `capture-${spec.ref}`, task_ref: spec.ref, version: "prompt-v1", digest: "a".repeat(64), length: 128, locale: "zh-CN", summary: "脱敏业务提示词摘要", readable: true, observed_at: minutes(spec.updatedMinutes) };
  const checkpoints = stages.map((stage, index) => ({ id: `${spec.ref}-e${index}`, sequence: index, occurred_at: minutes(spec.createdMinutes - ((Math.max(1, spec.createdMinutes - spec.updatedMinutes) * index) / Math.max(1, stages.length - 1))), kind: stage === "validating" ? "prompt_validate" : stage === "submitting" ? "submit" : stage === "generating" || stage === "running" ? "provider_running" : stage === "downloading" ? "artifact_collect" : stage === "completed" || stage === "succeeded" ? "artifact_ready" : "unknown", stage, state: index === stages.length - 1 ? spec.state : "running", summary: stage === "validating" ? "已完成提示词结构校验" : stage === "submitting" ? "已提交 owner 执行" : undefined, prompt_capture: stage === "validating" ? promptCapture : undefined }));
  return {
    schema_version: "yeisme.task_observation.v1",
    locator: { owner: spec.owner, project: spec.project, task_family: spec.family, task_ref: spec.ref },
    title: spec.title,
    state: spec.state,
    native_state: spec.state === "unknown" ? "submission_unknown" : spec.state,
    stage: spec.stage,
    revision: `rev-${spec.ref.slice(-6)}-${spec.updatedMinutes}`,
    created_at: minutes(spec.createdMinutes),
    updated_at: minutes(spec.updatedMinutes),
    started_at: spec.state === "queued" ? null : minutes(spec.createdMinutes - 1),
    progress: { kind: "indeterminate", ...spec.progress },
    source: "fixture-owner",
    actor: spec.actor ?? "lin.zhou",
    parent_ref: null,
    ...(spec.episode ? { episode_ref: spec.episode } : {}),
    results: (spec.results || []).map(({ media: _media, ...result }) => result),
    allowed_actions: [
      ["queued", "pending", "created", "running", "cancel_requested"].includes(spec.state) && ["run", "local-job", "delegation"].includes(spec.family)
        ? { action: "cancel", enabled: true }
        : { action: "cancel", enabled: false, reason: "not_supported" },
      ...(spec.results?.length ? [{ action: "preview", enabled: true }, { action: "download", enabled: true }] : []),
    ],
    coverage: spec.coverage || "complete",
    process: { schema_version: "yeisme.process_observation.v1", state: ["queued", "running", "pending"].includes(spec.state) ? "active" : spec.state === "failed" ? "blocked" : "complete", freshness: "fresh", coverage: spec.coverage || "complete", observed_at: minutes(spec.updatedMinutes), task_ref: spec.ref, prompt_capture: promptCapture, checkpoints, resume_cursor: `${spec.ref}-resume`, gap: false },
    prompt_capture: promptCapture,
    ...(spec.recovery ? { provider_recovery: spec.recovery } : {}),
  };
}

const imageTitles = ["旧车站 · 氛围参考", "雨巷远景 · 第二版", "林晚 · 角色定妆", "霓虹招牌 · 细节", "天台 · 黄昏光比", "站台 · 人群背景", "便利店 · 室内参考", "雨伞特写", "列车进站 · 构图", "海报主视觉 · 草图"];
const audioTitles = ["第 01 场 · 对白", "片尾环境音乐", "雨声氛围 · 循环", "旁白 · 开场", "第 02 场 · 对白", "列车广播 · 音效"];

function colorFor(index: number): [[number, number, number], [number, number, number]] {
  const palettes: [[number, number, number], [number, number, number]][] = [
    [[23, 60, 48], [120, 160, 140]],
    [[40, 52, 92], [150, 120, 190]],
    [[70, 40, 30], [220, 150, 90]],
    [[20, 40, 70], [90, 170, 200]],
    [[60, 30, 60], [210, 120, 160]],
  ];
  return palettes[index % palettes.length];
}

export interface World {
  tasks: Record<string, TaskSpec[]>;
  events: (spec: TaskSpec) => { id: string; occurred_at: string; stage: string; state: string }[];
  media: Map<string, { mime: string; bytes: Buffer }>;
}

export function buildWorld(scenario: Scenario, videoBytes: Buffer | null): World {
  const media = new Map<string, { mime: string; bytes: Buffer }>();
  const tasks: Record<string, TaskSpec[]> = { "fx-eikona": [], "fx-sonora": [], "fx-sonora-locked": [], "fx-scaena": [], "fx-eikona-denied": [], "fx-eikona-coast": [], "fx-sonora-coast": [] };
  if (scenario === "empty") return { tasks, events: () => [], media };

  const image = (key: string, name: string, index: number, width = 320, height = 200): ResultSpec => {
    const [from, to] = colorFor(index);
    const bytes = png(width, height, from, to);
    media.set(key, { mime: "image/png", bytes });
    return { ref: `eikona://artifact/${key}`, name, mime: "image/png", bytes: bytes.length, width, height, state: "candidate", media: key, thumbnail: { state: "ready", ref: `eikona://artifact/${key}#thumbnail` } };
  };
  const audio = (key: string, name: string, seconds: number, frequency: number): ResultSpec => {
    const bytes = wav(seconds, frequency);
    media.set(key, { mime: "audio/wav", bytes });
    return { ref: `sonora://audio-asset/${key}`, name, mime: "audio/wav", bytes: bytes.length, duration_ms: seconds * 1000, state: "candidate", media: key };
  };

  const eikona = tasks["fx-eikona"];
  eikona.push({ owner: "eikona", connection: "fx-eikona", project: "rain-reunion", family: "run", ref: "run-2410-active", title: "旧车站 · 重逢镜头关键帧", state: "running", stage: "generating", createdMinutes: 9, updatedMinutes: 0, progress: { kind: "percent", percent: 62 } });
  eikona.push({ owner: "eikona", connection: "fx-eikona", project: "rain-reunion", family: "run", ref: "run-2411-queued", title: "雨夜街景 · 广角候选", state: "queued", stage: "queued", createdMinutes: 3, updatedMinutes: 3 });
  eikona.push({ owner: "eikona", connection: "fx-eikona", project: "rain-reunion", family: "run", ref: "run-2398-review", title: "林晚 · 定妆照候选", state: "waiting_review", stage: "waiting_review", createdMinutes: 52, updatedMinutes: 31, results: [image("lin-wan-a", "林晚 定妆 A.png", 1, 240, 320), image("lin-wan-b", "林晚 定妆 B.png", 4, 240, 320)] });
  eikona.push({ owner: "eikona", connection: "fx-eikona", project: "rain-reunion", family: "run", ref: "run-2395-failed", title: "站台 · 人群背景（高分辨率）", state: "failed", stage: "failed", createdMinutes: 80, updatedMinutes: 74 });
  for (let index = 0; index < 118; index++) {
    const state = index % 13 === 5 ? "failed" : index % 17 === 3 ? "cancelled" : "succeeded";
    const title = `${imageTitles[index % imageTitles.length]} · ${String(index + 1).padStart(3, "0")}`;
    eikona.push({
      owner: "eikona", connection: "fx-eikona", project: "rain-reunion", family: "run", ref: `run-${2300 - index}`,
      title, state, stage: state === "succeeded" ? "completed" : state,
      createdMinutes: 120 + index * 47, updatedMinutes: 110 + index * 47,
      results: state === "succeeded" && index < 24 ? [image(`still-${index}`, `${imageTitles[index % imageTitles.length]}.png`, index)] : [],
    });
  }

  const sonora = tasks["fx-sonora"];
  sonora.push({ owner: "sonora", connection: "fx-sonora", project: "rain-reunion", family: "voice-render-job", ref: "sonora://voice-render-job/vr-88", title: "第 03 场 · 对白合成", state: "running", stage: "running", createdMinutes: 6, updatedMinutes: 1, progress: { kind: "count", completed: 7, total: 12 } });
  sonora.push({ owner: "sonora", connection: "fx-sonora", project: "rain-reunion", family: "music-job", ref: "sonora://music-job/mj-21", title: "片尾环境音乐 · 长版", state: "partial", stage: "completed", createdMinutes: 140, updatedMinutes: 120, coverage: "partial", results: [audio("ending-loop", "片尾环境音乐.wav", 2, 330)] });
  audioTitles.forEach((title, index) => sonora.push({
    owner: "sonora", connection: "fx-sonora", project: "rain-reunion", family: index % 2 ? "music-job" : "voice-render-job", ref: `sonora://job/hist-${index}`,
    title, state: index === 4 ? "failed" : "succeeded", stage: index === 4 ? "failed" : "completed", createdMinutes: 200 + index * 95, updatedMinutes: 190 + index * 95,
    results: index === 4 ? [] : [audio(`voice-${index}`, `${title}.wav`, 1 + (index % 2), 220 + index * 40)],
  }));

  tasks["fx-sonora-locked"].push({ owner: "sonora", connection: "fx-sonora-locked", project: "rain-reunion-archive", family: "audio-job", ref: "sonora://audio-job/archive-7", title: "归档配音 · 第 07 场", state: "succeeded", stage: "completed", createdMinutes: 600, updatedMinutes: 580, results: [audio("archive-7", "归档配音.wav", 1, 262)] });

  const scaena = tasks["fx-scaena"];
  scaena.push({
    owner: "scaena", connection: "fx-scaena", project: "rain-reunion", family: "delegation", ref: "deleg-0412", title: "旧车站 · 重逢镜头视频", state: "unknown", stage: "unknown", createdMinutes: 46, updatedMinutes: 40, episode: "ep-01",
    recovery: { state: "submission_unknown", native_state: "connection_lost_after_submit", submission_ref: "vt_9f31c2a7", binding_id: "seedance-720p-16x9", error_code: null, blocker: "提交后连接中断，owner 无法确认 Provider 是否已受理", safe_to_resubmit: false, review_status: null, export_status: null },
  });
  scaena.push({
    owner: "scaena", connection: "fx-scaena", project: "rain-reunion", family: "delegation", ref: "deleg-0409", title: "雨巷 · 推镜头", state: "waiting_review", stage: "waiting_review", createdMinutes: 300, updatedMinutes: 260, episode: "ep-01",
    results: videoBytes ? [(() => { media.set("alley-push", { mime: "video/mp4", bytes: videoBytes }); return { ref: "asset:alley-push", name: "雨巷推镜头.mp4", mime: "video/mp4", bytes: videoBytes.length, width: 320, height: 180, duration_ms: 2000, state: "candidate", media: "alley-push" }; })()] : [{ ref: "asset:alley-push", name: "雨巷推镜头.mp4", mime: "video/mp4", bytes: 0, width: 320, height: 180, duration_ms: 2000, state: "candidate", media: "missing" }],
    recovery: { state: "generated", native_state: "succeeded", submission_ref: "vt_7a01bb3e", binding_id: "seedance-720p-16x9", safe_to_resubmit: false, review_status: "pending_review", export_status: "not_exported" },
  });
  scaena.push({
    owner: "scaena", connection: "fx-scaena", project: "rain-reunion", family: "video-task", ref: "vt-0398", title: "天台 · 黄昏延时", state: "failed", stage: "failed", createdMinutes: 720, updatedMinutes: 700, episode: "ep-02",
    recovery: { state: "rejected_no_generation", native_state: "InvalidApiKey", submission_ref: "vt_5521aa0c", binding_id: "seedance-1080p-9x16", error_code: "InvalidApiKey", blocker: "Provider 凭据无效，未产生生成", safe_to_resubmit: false },
  });

  tasks["fx-eikona-coast"].push(
    { owner: "eikona", connection: "fx-eikona-coast", project: "coast-letters", family: "run", ref: "run-c-12", title: "海岸来信 · 封面候选", state: "succeeded", stage: "completed", createdMinutes: 400, updatedMinutes: 390, results: [image("coast-cover", "海岸来信 封面.png", 3)] },
    { owner: "eikona", connection: "fx-eikona-coast", project: "coast-letters", family: "run", ref: "run-c-13", title: "灯塔 · 夜景", state: "running", stage: "generating", createdMinutes: 12, updatedMinutes: 2, progress: { kind: "percent", percent: 28 } },
  );
  tasks["fx-sonora-coast"].push({ owner: "sonora", connection: "fx-sonora-coast", project: "coast-letters", family: "voice-render-job", ref: "sonora://voice-render-job/coast-1", title: "海岸来信 · 旁白", state: "succeeded", stage: "completed", createdMinutes: 500, updatedMinutes: 480, results: [audio("coast-narration", "海岸来信 旁白.wav", 2, 196)] });

  const events = (spec: TaskSpec) => {
    const stages = spec.state === "queued" ? ["accepted", "queued"] : spec.state === "running" ? ["accepted", "queued", "validating", "submitting", "generating"] : ["accepted", "queued", "validating", "submitting", "generating", "downloading", spec.stage];
    const span = Math.max(1, spec.createdMinutes - spec.updatedMinutes);
    return stages.map((stage, index) => ({
      id: `${spec.ref}-e${index}`,
      occurred_at: minutes(spec.createdMinutes - (span * index) / Math.max(1, stages.length - 1)),
      stage,
      state: index === stages.length - 1 ? spec.state : "running",
      sequence: index,
      kind: stage === "validating" ? "prompt_validate" : stage === "submitting" ? "submit" : stage === "generating" ? "provider_running" : stage === "downloading" ? "artifact_collect" : stage === "completed" || stage === "succeeded" ? "artifact_ready" : "unknown",
      summary: stage === "validating" ? "已完成提示词结构校验" : stage === "submitting" ? "已提交 owner 执行" : undefined,
      prompt_capture: stage === "validating" ? { state: "captured", source: "task", capture_ref: `capture-${spec.ref}`, task_ref: spec.ref, version: "prompt-v1", digest: "a".repeat(64), length: 128, locale: "zh-CN", summary: "脱敏业务提示词摘要", readable: true, observed_at: minutes(spec.updatedMinutes) } : undefined,
    })).reverse();
  };
  return { tasks, events, media };
}

// --- Request projections ---

export interface RequestRow { id: string; owner: "aigora" | Owner; data: Record<string, unknown>; createdMinutes: number }

export function buildRequests(scenario: Scenario, tenant: string, project: string): RequestRow[] {
  if (scenario === "empty") return [];
  const rows: RequestRow[] = [];
  const owners: Owner[] = ["eikona", "sonora", "scaena"];
  const titles: Record<Owner, string[]> = {
    eikona: ["生成：旧车站氛围参考", "生成：林晚定妆照", "变体：雨巷远景", "放大：海报主视觉"],
    sonora: ["合成：第 01 场对白", "生成：片尾环境音乐", "合成：开场旁白"],
    scaena: ["委托：重逢镜头视频", "委托：雨巷推镜头", "对账：天台延时"],
  };
  let n = 0;
  for (const owner of owners) {
    for (let index = 0; index < 11; index++) {
      const createdMinutes = 15 + n * 37 + index * 13;
      const state = index % 9 === 4 ? "failed" : index % 11 === 7 ? "unknown" : index === 0 ? "running" : "succeeded";
      const id = `${owner}-req-${1000 + n}`;
      rows.push({
        id, owner, createdMinutes,
        data: {
          id, tenant, project,
          title: titles[owner][index % titles[owner].length],
          kind: owner === "scaena" ? "operation" : "generation",
          state, native_state: state,
          actor: index % 3 ? "lin.zhou" : "chen.xu", actor_type: "human",
          created_at: minutes(createdMinutes),
          duration_ms: state === "running" ? null : 4200 + index * 917,
          model: owner === "eikona" ? "gpt-image-2.5" : owner === "sonora" ? "openai-tts" : "seedance-2.5",
          parent_ref: null,
          attempts: [{ ref: `${id}-a1`, state: state === "failed" ? "failed" : state, started_at: minutes(createdMinutes), completed_at: state === "running" ? undefined : minutes(createdMinutes - 1) }, ...(index % 5 === 2 ? [{ ref: `${id}-a0`, state: "failed", started_at: minutes(createdMinutes + 2), completed_at: minutes(createdMinutes + 1) }] : [])],
          output_refs: state === "succeeded" ? [`${owner}://output/${id}`] : [],
          attachments: index % 4 === 1 ? [{ ref: `${id}-ref`, name: "参考图.png", mime: "image/png", bytes: 182_400, source: "reference", state: "complete", downloadable: false, width: 1024, height: 640 }] : index % 4 === 3 ? [{ ref: `${id}-txt`, name: "需求说明.txt", mime: "text/plain", bytes: 268, source: "upload", state: "complete", downloadable: false }] : [],
          input: owner === "sonora" ? "not_recorded" : "complete",
          output: "not_recorded",
          submitted: owner === "sonora" ? { voice: "alloy", language: "zh-CN", format: "wav" } : { model: owner === "eikona" ? "gpt-image-2.5" : "seedance-2.5", size: owner === "eikona" ? "1024x640" : "720p", count: 2 },
          effective: owner === "sonora" ? { voice: "alloy", language: "zh-CN" } : { model: owner === "eikona" ? "gpt-image-2.5" : "seedance-2.5", quality: "standard" },
          coverage: { state: owner === "sonora" && index % 3 === 0 ? "partial" : "complete", observed_at: minutes(0), ...(owner === "sonora" && index % 3 === 0 ? { reason: "仅当前执行者的音频作业" } : {}) },
          task_ref: `${owner}-task-${id}`,
          trace_ref: `trace-${owner}-${id}`,
          prompt_capture: { state: owner === "sonora" ? "not_recorded" : "captured", source: "request", capture_ref: `capture-${id}`, request_ref: id, trace_ref: `trace-${owner}-${id}`, version: "prompt-v1", digest: "b".repeat(64), length: 186, locale: "zh-CN", summary: "脱敏业务提示词摘要", readable: owner !== "sonora", observed_at: minutes(0), ...(owner === "sonora" ? { reason: "owner 未采集输入正文" } : {}) },
          process: { schema_version: "yeisme.process_observation.v1", state: state === "running" ? "active" : state === "failed" ? "blocked" : "complete", freshness: "fresh", coverage: owner === "sonora" && index % 3 === 0 ? "partial" : "complete", observed_at: minutes(0), request_ref: id, trace_ref: `trace-${owner}-${id}`, prompt_capture: { state: owner === "sonora" ? "not_recorded" : "captured", source: "request", capture_ref: `capture-${id}`, request_ref: id, trace_ref: `trace-${owner}-${id}`, version: "prompt-v1", digest: "b".repeat(64), length: 186, locale: "zh-CN", summary: "脱敏业务提示词摘要", readable: owner !== "sonora", observed_at: minutes(0), ...(owner === "sonora" ? { reason: "owner 未采集输入正文" } : {}) }, checkpoints: [
            { id: `${id}-received`, sequence: 0, occurred_at: minutes(createdMinutes), kind: "request_received", stage: "received", state: "running", summary: "请求已进入观察范围" },
            { id: `${id}-capture`, sequence: 1, occurred_at: minutes(createdMinutes - 1), kind: "prompt_capture", stage: "prompt_capture", state: owner === "sonora" ? "not_recorded" : "captured", summary: owner === "sonora" ? "来源未记录提示词正文" : "已采集脱敏提示词元数据", prompt_capture: { state: owner === "sonora" ? "not_recorded" : "captured", source: "request", capture_ref: `capture-${id}`, request_ref: id, trace_ref: `trace-${owner}-${id}`, version: "prompt-v1", digest: "b".repeat(64), length: 186, locale: "zh-CN", summary: "脱敏业务提示词摘要", readable: owner !== "sonora", observed_at: minutes(createdMinutes - 1) } },
            { id: `${id}-submit`, sequence: 2, occurred_at: minutes(createdMinutes - 2), kind: "submit", stage: "submit", state: state === "running" ? "running" : "succeeded", summary: "已提交 owner 执行" },
            ...(state === "succeeded" ? [{ id: `${id}-ready`, sequence: 3, occurred_at: minutes(createdMinutes - 3), kind: "artifact_ready", stage: "artifact_ready", state: "succeeded", summary: "产物已回收并可预览" }] : []),
          ], resume_cursor: `resume-${id}`, gap: false },
        },
      });
      n++;
    }
  }
  for (let index = 0; index < 8; index++) {
    const createdMinutes = 8 + index * 61;
    rows.push({
      id: `gw-${7000 + index}`,
      owner: "aigora",
      createdMinutes,
      data: {
        request_ref: `gw-${7000 + index}`,
        request: { capability: index % 2 ? "chat.completions" : "images.generate", outcome: index === 3 ? "failure" : "success", observed_at: minutes(createdMinutes), duration_ms: 900 + index * 211, requested_model: index % 2 ? "gpt-5.1" : "gpt-image-2.5" },
        attribution: { actor_ref: "chen.xu" },
        routing_selection: { requested_model: index % 2 ? "gpt-5.1" : "gpt-image-2.5" },
        executions: { attempts: [{ attempt_ref: `gw-${7000 + index}-a1`, provider_outcome: index === 3 ? "failure" : "success" }] },
        watermark: minutes(0),
      },
    });
  }
  return rows;
}

export function usageSeed(scenario: Scenario, project: string, seed: number) {
  if (scenario === "empty") return [];
  const owners = [
    { owner: "eikona" as const, modality: "image" as const, model: "openai/gpt-image-2.5-sunburst", unit: "images" },
    { owner: "scaena" as const, modality: "video" as const, model: "seedance25-ark-text-1080p", unit: "seconds" },
    { owner: "sonora" as const, modality: "audio" as const, model: "sonora/voice/openai-tts", unit: "characters" },
  ];
  return Array.from({ length: seed }, (_, index) => {
    const pick = owners[index % 3];
    const costState = index % 9 === 4 ? "unknown" : index % 7 === 3 ? "estimated" : "confirmed";
    const amount = pick.owner === "scaena" ? 1.2 + (index % 5) * 0.65 : pick.owner === "eikona" ? 0.08 + (index % 6) * 0.14 : 0.02 + (index % 4) * 0.05;
    return {
      source_ref: `${pick.owner}-receipt-${project}-${index}`,
      trace_ref: `trace-${index.toString(16).padStart(6, "0")}`,
      owner: pick.owner,
      model_ref: pick.model,
      modality: pick.modality,
      quantity: costState === "unknown" && index % 2 ? null : pick.owner === "sonora" ? 180 + index * 23 : pick.owner === "scaena" ? 5 : 1 + (index % 4),
      unit: pick.unit,
      upstream_cost: costState === "unknown" ? null : Number(amount.toFixed(2)),
      currency: index % 11 === 6 ? "USD" : "CNY",
      cost_state: costState,
      status: index % 13 === 7 ? "failed" : costState === "unknown" ? "unknown" : "succeeded",
      project_ref: project,
      created_at: new Date(now - (index * 0.47 + (index % 3) * 0.13) * 86400_000).toISOString(),
    };
  });
}
