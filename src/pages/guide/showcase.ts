/**
 * Real generations recorded for the guide on 2026-10-29: every file under public/guide/showcase/ came out of the
 * call shown next to it. Calls keep their real arguments but drop idempotency keys and identity tags; run refs are
 * shortened and no address, key or path is kept. Costs are what the owner reported, never estimated here.
 */

export type ShowcaseTool = "eikona" | "scaena" | "sonora";

export interface ShowcaseMedia {
  kind: "image" | "video" | "audio";
  /** Relative to the page, so the public guide and the signed-in page both resolve it. */
  src: string;
  poster?: string;
  width?: number;
  height?: number;
  /** Playback length of video and audio. */
  seconds?: number;
  bytes: number;
}

export interface ShowcaseItem {
  id: string;
  tool: ShowcaseTool;
  title: string;
  /** The words sent to the model, verbatim. */
  prompt: string;
  /** The MCP call that produced it. */
  call: string;
  model: string;
  /** As reported by the owner; "未报告" when the provider returns no price. */
  cost: string;
  /** From submission to a finished result. */
  time: string;
  ref: string;
  media: ShowcaseMedia;
  alt: string;
}

export const showcaseRecord = {
  date: "2026-10-29",
  versions: "Eikona dev · Scaena gateway-v1 · Sonora 0.0.0-dev（局域网 MCP 服务）",
  disclosure: "所有画面、视频和声音都由 AI 生成，人物是虚构的，不对应任何真实的人。",
};

const base = "guide/showcase/";
const keyframePrompt = "雨夜的旧火车站站台，一位撑透明伞的年轻女子回头望向镜头，站台灯是暖黄色，远处的铁轨反射霓虹，电影感构图，35mm 胶片质感";
const generateCall = (model: string, size: string) => `eikona.execute {"action":"generate","args":{"model_ref":"${model}","size":"${size}","prompt":"…"}}`;

/** Same prompt, two models, three tries each. */
export const modelComparison: ShowcaseItem[] = [
  ...[
    { n: 1, ref: "100369", time: "38 秒", bytes: 108396 },
    { n: 2, ref: "409833", time: "33 秒", bytes: 140068 },
    { n: 3, ref: "714363", time: "27 秒", bytes: 102338 },
  ].map(({ n, ref, time, bytes }): ShowcaseItem => ({
    id: `eikona-gpt-${n}`,
    tool: "eikona",
    title: `GPT Image 2.5 · 第 ${n} 张`,
    prompt: keyframePrompt,
    call: generateCall("openai/gpt-image-2.5-sunburst", "1536x1024"),
    model: "openai/gpt-image-2.5-sunburst",
    cost: "$0.0050",
    time,
    ref: `run …${ref}`,
    media: { kind: "image", src: `${base}eikona-gpt-${n}.webp`, width: 1440, height: 960, bytes },
    alt: `AI 生成：雨夜的旧站台上，撑透明伞的年轻女子回头看向镜头，暖黄站灯和湿漉漉的铁轨，画面带胶片边框（第 ${n} 张）`,
  })),
  ...[
    { n: 1, ref: "014771", time: "7 秒", bytes: 95972 },
    { n: 2, ref: "318079", time: "44 秒（含排队）", bytes: 117600 },
    { n: 3, ref: "638145", time: "44 秒（含排队）", bytes: 111164 },
  ].map(({ n, ref, time, bytes }): ShowcaseItem => ({
    id: `eikona-grok-${n}`,
    tool: "eikona",
    title: `Grok Imagine · 第 ${n} 张`,
    prompt: keyframePrompt,
    call: generateCall("xai:grok-imagine-image", "1k"),
    model: "xai:grok-imagine-image",
    cost: "未报告",
    time,
    ref: `run …${ref}`,
    media: { kind: "image", src: `${base}eikona-grok-${n}.webp`, width: 1024, height: 1024, bytes },
    alt: `AI 生成：远景的雨夜站台，撑透明伞的女子站在站台边，霓虹倒映在铁轨上（第 ${n} 张）`,
  })),
];

/** One edit of the second GPT image: only the umbrella changes. */
export const editPair: { before: ShowcaseItem; after: ShowcaseItem } = {
  before: modelComparison[1],
  after: {
    id: "eikona-edit",
    tool: "eikona",
    title: "改图：只换掉雨伞",
    prompt: "保留人物、构图和雨夜站台不变，把透明雨伞换成一把红色油纸伞，让红色在冷色调里成为唯一的暖色焦点",
    call: 'eikona.execute {"action":"edit","args":{"model_ref":"openai/gpt-image-2.5-sunburst","operation":"image.edit","references":["eikona://runs/<关键帧 run>/artifacts/artifact_001"],"size":"1536x1024","prompt":"…"}}',
    model: "openai/gpt-image-2.5-sunburst",
    cost: "$0.0173",
    time: "59 秒",
    ref: "run …502787",
    media: { kind: "image", src: `${base}eikona-edit-after.webp`, width: 1440, height: 960, bytes: 131986 },
    alt: "AI 生成：同一个雨夜站台和女子，透明伞换成了红色油纸伞",
  },
};

export const videos: ShowcaseItem[] = [
  {
    id: "scaena-t2v",
    tool: "scaena",
    title: "文生视频 · 4 秒",
    prompt: "雨夜的旧火车站站台，一位撑红色油纸伞的年轻女子缓缓回头望向镜头，伞面上雨珠滑落，远处列车的车灯慢慢亮起，电影感，35mm 胶片质感，镜头缓慢推近",
    call: 'scaena.execute {"action":"createVideoProviderTask","args":{"path":{"project_id":"<项目>"},"body":{"model":"doubao-seedance-2-5-260628","duration_seconds":4,"resolution":"720p","ratio":"16:9","production_scope":"experiment","confirmed":true,"acknowledge_unknown_cost":true,"max_cost_micro_usd":2000000,"prompt":"…"}}}',
    model: "Seedance 2.5（doubao-seedance-2-5-260628）",
    cost: "未报告（请求上限 $2）",
    time: "3 分钟内",
    ref: "task …a8f887",
    media: { kind: "video", src: `${base}scaena-t2v.mp4`, poster: `${base}scaena-t2v-poster.webp`, width: 1280, height: 720, seconds: 4.1, bytes: 702465 },
    alt: "AI 生成的视频：撑红伞的女子背对镜头站在雨夜站台，随后回头看向镜头，远处列车灯光逐渐靠近",
  },
  {
    id: "scaena-i2v",
    tool: "scaena",
    title: "图生视频 · 5 秒",
    prompt: "撑红色油纸伞的女子站在雨夜的旧站台上，缓缓转身望向镜头，雨丝斜斜飘落，远处列车灯光渐渐亮起，镜头缓慢推近，电影感",
    call: 'scaena.execute {"action":"createVideoProviderTask","args":{"path":{"project_id":"<项目>"},"body":{"model":"MiniMax-H3","duration_seconds":5,"resolution":"768P","ratio":"16:9","reference_upload_ref":"upload:<改图结果>","reference_rights_confirmed":true,"subject_mode":"synthetic_virtual_person","production_scope":"experiment","confirmed":true,"acknowledge_unknown_cost":true,"max_cost_micro_usd":2000000,"prompt":"…"}}}',
    model: "MiniMax-H3",
    cost: "未报告（请求上限 $2）",
    time: "约 5 分钟",
    ref: "task …e61fc9",
    media: { kind: "video", src: `${base}scaena-i2v.mp4`, poster: `${base}scaena-i2v-poster.webp`, width: 1260, height: 720, seconds: 5.2, bytes: 915052 },
    alt: "AI 生成的视频：以改图结果为首帧，撑红色油纸伞的女子在站台上转身，远处列车灯光亮起",
  },
];

export const sounds: ShowcaseItem[] = [
  {
    id: "sonora-tts-zh",
    tool: "sonora",
    title: "中文台词试听",
    prompt: "雨停了，末班车还没来。我还是回来了。",
    call: 'sonora.execute {"action":"voice.audition","args":{"provider_id":"fish-audio","voice_model_ref":"sonora://voice/fish-audio/zh-hero","max_cost_usd":"0.05","confirm_external_call":true,"text":"…"}}',
    model: "Fish Audio · zh-hero",
    cost: "$0（54 units）",
    time: "数秒",
    ref: "audition …f68a1d",
    media: { kind: "audio", src: `${base}sonora-tts-zh.mp3`, seconds: 4.7, bytes: 76067 },
    alt: "AI 合成的中文语音：雨停了，末班车还没来。我还是回来了。",
  },
  {
    id: "sonora-tts-en",
    tool: "sonora",
    title: "英文旁白试听",
    prompt: "The rain stopped. The last train hasn't come. I came back anyway.",
    call: 'sonora.execute {"action":"voice.audition","args":{"provider_id":"fish-audio","voice_model_ref":"sonora://voice/fish-audio/en-narrator","max_cost_usd":"0.05","confirm_external_call":true,"text":"…"}}',
    model: "Fish Audio · en-narrator",
    cost: "$0（65 units）",
    time: "数秒",
    ref: "audition …6492f9",
    media: { kind: "audio", src: `${base}sonora-tts-en.mp3`, seconds: 5.2, bytes: 84844 },
    alt: "AI 合成的英文旁白：The rain stopped. The last train hasn't come. I came back anyway.",
  },
  {
    id: "sonora-music",
    tool: "sonora",
    title: "配乐 · 33 秒器乐",
    prompt: "标题「雨夜站台」；原创器乐，约 30 秒；风格 cinematic、ambient、piano；情绪 melancholy、hopeful",
    call: 'sonora.execute {"action":"music.generate","args":{"plan_ref":"sonora://music-plan/<计划>","approval_ref":"sonora://music-approval/<审批>","project_id":"<项目>","authorization_epoch":"<纪元>","max_cost_usd":"1.00","confirm_external_call":true,"confirm_unknown_price":true}}',
    model: "Suno V6（suno-kie）",
    cost: "12 KIE credits",
    time: "76 秒",
    ref: "job …d85867",
    media: { kind: "audio", src: `${base}sonora-music.mp3`, seconds: 32.8, bytes: 525373 },
    alt: "AI 生成的器乐配乐：钢琴为主的舒缓旋律，情绪克制，结尾渐弱",
  },
];

/** Steps of the music request before generate: nothing here calls the provider. */
export const musicSteps = [
  { action: "music.brief.create", note: "写下用途、时长、风格和情绪" },
  { action: "music.plan.create", note: "选定 suno-kie，带上 Provider 条款版本 terms_revision" },
  { action: "music.approval.issue", note: "把计划、预算上限和身份绑成一次审批，15 分钟内有效、只能用一次" },
  { action: "music.generate", note: "用同一个幂等键提交，明确确认外部调用和未知价格" },
  { action: "music.job.reconcile", note: "主动拉取终态和两个候选" },
];

/** The chain the samples form, in order: each step's output is the next step's input. */
export const showcaseChain: { label: string; item: ShowcaseItem }[] = [
  { label: "关键帧", item: modelComparison[1] },
  { label: "改图", item: editPair.after },
  { label: "图生视频", item: videos[1] },
  { label: "配音", item: sounds[0] },
  { label: "配乐", item: sounds[2] },
];

export const allShowcaseItems: ShowcaseItem[] = [...modelComparison, editPair.after, ...videos, ...sounds];
