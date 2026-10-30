import type { GuideClient } from "./guide-content";
import { showcaseRecord, type ShowcaseMedia } from "./showcase";

/**
 * Two recorded agent sessions, condensed but not rewritten: user and agent lines are quoted (shortened where marked
 * with …), every call keeps its real action and arguments, and runs of similar calls are folded with their count.
 * Editor's notes correct the record where the agent's own explanation was wrong. Internal channel names are replaced
 * with <placeholders>; nothing else in a call is changed.
 */

export type ReplayStep =
  | { kind: "user"; text: string }
  | { kind: "agent"; text: string }
  | { kind: "call"; tool: string; args: string; result: string; failed?: boolean }
  | { kind: "fold"; count: number; text: string }
  | { kind: "note"; text: string };

export interface AgentReplay {
  client: GuideClient;
  title: string;
  /** Client version and model, as reported by the session itself. */
  runtime: string;
  date: string;
  tool: string;
  setup: string;
  steps: ReplayStep[];
  result: { media: ShowcaseMedia; alt: string; caption: string };
  /** Provider spend, then the agent's own model usage. */
  cost: string[];
}

const eikonaPrompt = "Cinematic 35mm film photograph of a rainy night at an old train station platform. A young woman holds a red oil-paper umbrella, turning back to glance at the camera. Warm yellow platform lamps glow through the rain, …";

export const agentReplays: AgentReplay[] = [
  {
    client: "claude",
    title: "Claude Code 用 Eikona 生成一张图",
    runtime: "Claude Code 2.1.280 · claude-sonnet-5",
    date: showcaseRecord.date,
    tool: "Eikona",
    setup: "无头模式 claude -p，只接 Eikona 一个 MCP 服务，三轮对话，每轮最多 10 步。",
    steps: [
      { kind: "user", text: "用 Eikona 生成一张图：雨夜的旧火车站站台，一位撑红色油纸伞的年轻女子回头望向镜头，站台灯是暖黄色，电影感，35mm 胶片质感，横版 3:2。先别真的生成：做一次 dry run，告诉我会用哪个模型、预计花多少钱，等我确认。" },
      { kind: "call", tool: "eikona.execute", args: '{"action":"models.list","args":{}}', result: "已授权的模型路线和当前默认模型" },
      { kind: "call", tool: "eikona.execute", args: '{"action":"actions.describe","args":{"action":"generate"}}', result: "generate 的参数结构" },
      { kind: "call", tool: "eikona.execute", args: `{"action":"generate","args":{"model_ref":"openai/gpt-image-2.5-sunburst","use_channels":["openai"],"aspect":"3:2","execution_mode":"dry_run","prompt":"${eikonaPrompt}"}}`, result: "预留估算 $0.12329，画布 1254×836；没有调用 Provider" },
      { kind: "agent", text: "Dry run 已完成，没有真正生成图片。模型 openai/gpt-image-2.5-sunburst，预估费用 $0.12329（预留估算值，dry run 不扣费）。是否按这个模型和约 $0.123 的预估花费正式生成？" },
      { kind: "user", text: "确认，就用这个模型，费用上限 0.20 美元，开始生成。完成后告诉我结果和实际花费。" },
      { kind: "call", tool: "eikona.execute", args: '{"action":"generate","args":{"model_ref":"openai/gpt-image-2.5-sunburst","use_channels":["openai"],"aspect":"3:2","prompt":"…"}}', result: "已排队：run …140110" },
      { kind: "fold", count: 7, text: "wait、inspect、status、两次 search 和两次 docs.read：状态是 failed，但没带回失败原因；Agent 从文档里找到验证过的调用方式" },
      { kind: "note", text: "失败原因记在运行记录里：3:2 换算出的 1254×836 不是 16 像素的整数倍，执行前就被拒绝，没有扣费。查询接口没把这条错误交给 Agent，已反馈给 Eikona。" },
      { kind: "call", tool: "eikona.execute", args: '{"action":"generate","args":{"model_ref":"openai/gpt-image-2.5-sunburst","use_channels":["<另一个通道>"],"size":"1536x1024","quality":"medium","provider_options":{"api":"images"},"execution_mode":"dry_run","prompt":"…"}}', result: "预估仍是 $0.1233，在 $0.20 上限内" },
      { kind: "call", tool: "eikona.execute", args: '{"action":"generate","args":{"model_ref":"openai/gpt-image-2.5-sunburst","use_channels":["<另一个通道>"],"size":"1536x1024","quality":"medium","provider_options":{"api":"images"},"execution_mode":"foreground","prompt":"…"}}', result: "成功：1536×1024，实际 $0.01064" },
      { kind: "fold", count: 1, text: "inspect：确认产物。这一轮的步数上限用完，Agent 没来得及汇报" },
      { kind: "user", text: "结果呢？告诉我生成好的图在哪里、实际花了多少钱、第一次为什么没成功。" },
      { kind: "agent", text: "产物引用 eikona://artifact/img_e65d…，尺寸 1536×1024，精确对应 3:2 横版。实际花费 $0.01064，远低于 $0.20 上限；预估是保守上限，实际按真实用量计费。第一次我用的是 openai 通道和默认的后台模式……换成文档里验证过的配置（另一个通道 + 显式 foreground）后就成功了。" },
      { kind: "note", text: "以运行记录为准：真正的原因是画布尺寸，第二次显式写了 size 1536x1024 才通过。Agent 的解释不完全对——遇到失败，先看运行记录里的错误。" },
    ],
    result: {
      media: { kind: "image", src: "guide/showcase/eikona-agent-claude.webp", width: 1440, height: 960, bytes: 92388 },
      alt: "AI 生成：Claude Code 生成的雨夜站台，撑红色油纸伞的女子回头，背景是亮着灯的列车",
      caption: "Claude Code 第二次提交的结果，run …928929",
    },
    cost: ["生成：$0.01064（第一次失败，未扣费）", "Agent 自身：三轮共约 $1.87，按 API 价格计"],
  },
  {
    client: "codex",
    title: "Codex 用 Sonora 给一句台词配音",
    runtime: "Codex CLI 0.165.0 · gpt-6.1-sol",
    date: showcaseRecord.date,
    tool: "Sonora",
    setup: "codex exec，只启用 Sonora 一个 MCP 服务，三轮对话。",
    steps: [
      { kind: "user", text: "用 Sonora 给这句台词配音：「雨停了，末班车还没来。我还是回来了。」要中文女声、语气克制。先告诉我有哪些合适的声音、会不会花钱，等我确认再生成。" },
      { kind: "agent", text: "我先查 Sonora 当前可用的中文女声与计费信息，只做查询，不会生成或消耗配音额度；确认后再生成。" },
      { kind: "fold", count: 30, text: "sonora.search：按声音、模型、Provider 和动作分别搜索" },
      { kind: "call", tool: "sonora.execute", args: '{"action":"tts.models.list","args":{}}', result: "unknown_action：动作名要先 search 或 describe，不能猜", failed: true },
      { kind: "fold", count: 10, text: "又有 2 个调用不成立（1 个动作名猜错、1 个缺参数），然后 describe 了 7 个动作（voice.audition、job.submit、plan.tts_estimate 等），再列出 TTS 执行目标" },
      { kind: "agent", text: "现在还没有生成音频，也没有产生费用。MiniMax、Azure、Qwen 的中文女声都缺 Provider 凭据，无法估价；Fish Audio 已配置、可以执行，zh-hero 声音配 S1 模型标为免费，但目录里没有性别和情绪标签。想控制成本建议选 D（Fish Audio zh-hero + S1）。请回复例如：「选 D，确认生成。」" },
      { kind: "note", text: "省略了 Codex 读取自己本机记忆文件的 2 条 shell 命令。" },
      { kind: "user", text: "选 D，确认生成，费用上限 0.05 美元。生成好后告诉我音频在哪、时长多少、实际花了多少。" },
      { kind: "call", tool: "sonora.execute", args: '{"action":"voice.audition","args":{"provider_id":"fish-audio","voice_model_ref":"sonora://tts-model/fish-audio/s1","max_cost_usd":"0.05","confirm_external_call":true,"text":"雨停了，末班车还没来。我还是回来了。"}}', result: "quota_insufficient：http 402，提交前被拒", failed: true },
      { kind: "agent", text: "生成请求被 Sonora 在提交前以 quota_insufficient（HTTP 402）拒绝，我不会重试以免重复扣费或产生不确定任务。现在读取一次只读诊断。" },
      { kind: "fold", count: 4, text: "doctor.run 和 job.list：凭据已配置，没有创建任何任务" },
      { kind: "agent", text: "生成未完成：Fish Audio 返回 quota_insufficient，没有创建任务，实际费用 $0.00。补充配额后，我可以用相同的台词、声音和 $0.05 上限再提交。" },
      { kind: "note", text: "voice_model_ref 这里填的是模型引用。同一句台词换成声音引用 sonora://voice/fish-audio/zh-hero 就成功了，见下一轮。" },
      { kind: "user", text: "换个方式：直接用声音 sonora://voice/fish-audio/zh-hero 试听这一句，不要单独指定 S1 模型，上限还是 0.05 美元，只调用一次。" },
      { kind: "call", tool: "sonora.execute", args: '{"action":"voice.audition","args":{"provider_id":"fish-audio","voice_model_ref":"sonora://voice/fish-audio/zh-hero","max_cost_usd":"0.05","confirm_external_call":true,"text":"雨停了，末班车还没来。我还是回来了。"}}', result: "已渲染，等待审阅；$0，54 units" },
      { kind: "fold", count: 4, text: "想读出时长：describe 了 asset.get 和 artifact.access，调用 asset.get 报内部错误，再搜 review packet 也没有结果" },
      { kind: "agent", text: "试听已成功生成，并且只调用了一次生成接口。音频资产 sonora://audio-asset/fish-audio-audition-e957…，状态为等待审核，实际费用 $0.00，使用量 54 units；Sonora 返回结果未提供时长。" },
    ],
    result: {
      media: { kind: "audio", src: "guide/showcase/sonora-agent-codex.mp3", seconds: 4.3, bytes: 70216 },
      alt: "AI 合成的中文语音：雨停了，末班车还没来。我还是回来了。",
      caption: "Codex 第三轮生成的试听，4.3 秒",
    },
    cost: ["生成：$0（第一次被拒，未扣费）", "Agent 自身：三轮共约 173 万输入 token（156 万命中缓存）、7 千输出 token"],
  },
];
