import type { GuideCommand, GuideTool } from "./guide-content";

/**
 * Reference material under the guide: one manual per tool, client configuration, and troubleshooting. Commands are
 * copied from each owner's docs, or were run while recording the real samples on 2026-10-29; placeholders use
 * <angle-brackets>, and a shared service's token is only ever named by its environment variable.
 */

export interface ManualTopic {
  title: string;
  body?: string;
  commands?: GuideCommand[];
}

export interface ToolManual {
  id: GuideTool["id"];
  topics: ManualTopic[];
  /** Sections of 真实案例 recorded with this tool. */
  samples: { label: string; target: string }[];
}

export const toolManuals: ToolManual[] = [
  {
    id: "eikona",
    topics: [
      {
        title: "初始化与凭据",
        commands: [
          { command: "eikona init --user", note: "建用户级目录，不写任何 Provider 密钥" },
          { command: "eikona auth set openai --api-key-stdin", note: "从标准输入读密钥，存进用户级凭据库" },
          { command: "eikona auth set <channel> --from-env <ENV_NAME>", note: "CI 里从环境变量读" },
        ],
      },
      {
        title: "生成与改图",
        commands: [
          { command: 'eikona generate --model openai/gpt-image-2.5-sunburst --prompt "clean product photo" --dry-run', note: "先 dry run：写证据、给出预估，不调用 Provider" },
          { command: 'eikona edit --model openai/gpt-image-2.5-sunburst --input input.png --prompt "保持主体身份，改成电影海报光影" --max-cost-usd 1', note: "改图；--mask 可以只改一块区域" },
        ],
        body: "GPT Image 2.5 的尺寸：边长是 16 的倍数，最长边不超过 3840，比例 1:3 到 3:1，总像素 655,360 到 8,294,400。直接写 size（比如 1536x1024）最稳。",
      },
      {
        title: "费用与确认",
        body: "--max-cost-usd 按提交前的预估拦截，不是硬上限；没有价格表的模型要你显式加 --allow-unknown-cost 才会提交。本页样例的预估是 $0.12，实际按用量结算为 $0.005 到 $0.017。",
      },
      {
        title: "输出与读回",
        commands: [
          { command: "eikona artifacts list <run_id> --json", note: "列出这次运行的产物" },
          { command: "eikona watch <run_id> --events", note: "跟着事件看进度" },
          { command: "eikona inspect <run_id>", note: "失败时先看这里的错误，不要凭猜测重试" },
        ],
      },
    ],
    samples: [{ label: "两个模型对比", target: "guide-showcase-models" }, { label: "改图前后", target: "guide-showcase-edit" }, { label: "Claude Code 回放", target: "guide-replay" }],
  },
  {
    id: "sonora",
    topics: [
      {
        title: "初始化与凭据",
        commands: [
          { command: "sonora init --project . --json", note: "在当前目录建项目" },
          { command: `printf '%s' "$SONORA_ELEVENLABS_API_KEY" | sonora provider auth set --provider elevenlabs --api-key-stdin --json`, note: "从标准输入写凭据；其他 Provider 换掉 --provider" },
        ],
      },
      {
        title: "配音与音乐",
        commands: [
          { command: 'sonora tts voices audition --provider boson --voice-model sonora://voice-model/boson/chloe --text "第一场，雨夜。" --max-cost-usd 1 --confirm-external-call --json', note: "试听一句" },
          { command: "sonora music generate --plan <plan-ref> --idempotency-key <stable-key> --approval <approval-ref> --max-cost-usd <cap> --confirm-external-call --confirm-unknown-price --json", note: "音乐要先走 brief、plan 和 approval" },
        ],
        body: "音色引用写 sonora://voice/<provider>/<voice>，模型引用写 sonora://tts-model/<provider>/<model>；旧的 sonora://voice-model/… 仍然兼容。",
      },
      {
        title: "费用与确认",
        body: "真实调用都要 --max-cost-usd 和 --confirm-external-call；价格未知的音乐 Provider 还要 --confirm-unknown-price。音乐审批 15 分钟内有效、只能用一次，generate 的幂等键、项目和纪元必须和审批一致，否则返回 approval_required。",
      },
      {
        title: "输出与读回",
        commands: [
          { command: "sonora assets get <asset-id> --json", note: "读音频资产的元数据" },
          { command: "sonora assets download <artifact-uri> --to ./line.wav", note: "按 24 小时授权下载并校验摘要；远程服务另加 --endpoint" },
          { command: "sonora music job reconcile <music-job-ref> --json", note: "主动拉取音乐任务的终态和候选" },
        ],
      },
    ],
    samples: [{ label: "配音与配乐", target: "guide-showcase-audio" }, { label: "Codex 回放", target: "guide-replay" }],
  },
  {
    id: "scaena",
    topics: [
      {
        title: "初始化与凭据",
        commands: [
          { command: 'scaena init --title "拆解试验" --episodes 1', note: "建一个一集的试验项目" },
          { command: "scaena video auth set --provider minimax_h3 --channel minimax-h3 --api-key-stdin --json", note: "视频 Provider 的密钥，写进用户级配置" },
        ],
      },
      {
        title: "生成视频",
        commands: [
          { command: 'scaena video generate --model wan3.0-video --prompt "cinematic short-drama shot" --dry-run --json', note: "只校验，不提交" },
          { command: 'scaena video generate --model MiniMax-H3 --channel minimax-h3-intl --prompt "<prompt>" --duration 5 --ratio 9:16 --idempotency-key <key> --json', note: "真实提交" },
        ],
        body: "通过 MCP 提交时有两种写法，不能混用：按模型提交就写 model、duration_seconds、resolution 和 ratio，不填 binding_id；按线路提交就只写 binding_id。混在一起会返回 INVALID_ARGUMENT。",
      },
      {
        title: "费用与确认",
        body: "每次提交都要 confirmed=true、max_cost_micro_usd 和 acknowledge_unknown_cost=true。服务端不记录 Provider 的实际费用，只按你给的上限拦截。",
      },
      {
        title: "输出与读回",
        commands: [
          { command: "scaena video task describe --model MiniMax-H3 --task <task-id> --json", note: "查看任务状态" },
          { command: "scaena video task download --model <model> --channel <channel> --task <id> --output <dir>/<slug>.mp4 --json", note: "下载到你指定的位置" },
        ],
        body: "MCP 里先 reconcileVideoProviderTask 拿到资产，再 createArtifactAccessGrant 换下载链接；下载时要带同一个令牌。新资产默认待审阅、不能导出。",
      },
    ],
    samples: [{ label: "文生视频与图生视频", target: "guide-showcase-video" }],
  },
  {
    id: "auctra",
    topics: [
      {
        title: "初始化与运行时",
        commands: [
          { command: "auctra project init <path>", note: "写项目元数据和 .auctra/" },
          { command: "auctra runtime configure pi --binary <absolute-path-to-runtime> --json", note: "Auctra 不保管 Provider 密钥，模型调用交给运行时" },
        ],
      },
      {
        title: "生成候选稿",
        commands: [
          { command: 'auctra candidate generate --work "$work_ref" --unit "$unit_ref" --brief "$brief_ref" --runtime-profile pi --idempotency-key "$generation_key" --json', note: "生成一份候选稿，进入待审阅" },
          { command: 'auctra candidate status "$run_ref" --work "$work_ref" --json', note: "查看生成进度" },
        ],
      },
      {
        title: "费用与确认",
        body: "会调用付费模型的探测要显式设置 AUCTRA_ALLOW_RUNNER_CALL=1；严格的费用上限目前还不支持，先在运行时那一侧控制额度。",
      },
      {
        title: "输出与读回",
        commands: [{ command: "auctra text export <unit-id> --format markdown --to <path>", note: "导出已采纳的正文" }],
        body: "候选稿在你采纳之前不会改动正文；这一轮没有录制 Auctra 的真实样例。",
      },
    ],
    samples: [],
  },
];

export interface ClientConfig {
  client: "claude" | "codex";
  title: string;
  steps: { title: string; command: string; note: string; block?: boolean; label?: string }[];
}

/** Each line here was run while recording the replays; the shared address and token stay placeholders. */
export const clientConfigs: ClientConfig[] = [
  {
    client: "claude",
    title: "Claude Code",
    steps: [
      { title: "本机 stdio", command: "claude mcp add eikona -- eikona mcp --transport stdio", note: "Agent 直接启动本机的工具进程" },
      { title: "团队共享服务", command: "claude mcp add --transport http -s project eikona-lan http://<lan-host>:<port>/mcp --header 'Authorization: Bearer ${EIKONA_MCP_TOKEN}'", note: "单引号让 ${EIKONA_MCP_TOKEN} 原样写进 .mcp.json，运行时才从环境变量展开" },
      { title: "写出的 .mcp.json", block: true, label: ".mcp.json", command: '{\n  "mcpServers": {\n    "eikona-lan": {\n      "type": "http",\n      "url": "http://<lan-host>:<port>/mcp",\n      "headers": {\n        "Authorization": "Bearer ${EIKONA_MCP_TOKEN}"\n      }\n    }\n  }\n}', note: "文件里只有变量名，可以和项目一起保存" },
      { title: "无头模式录一段对话", command: 'claude -p "用 Eikona 生成一张图……先做一次 dry run，等我确认" --mcp-config .mcp.json --strict-mcp-config --allowedTools mcp__eikona-lan --output-format stream-json --verbose', note: "--strict-mcp-config 只加载这个文件里的服务；回放用的就是这种写法" },
      { title: "接着上一轮追问", command: 'claude -p "确认，费用上限 0.20 美元，开始生成" --resume <session-id> --mcp-config .mcp.json --strict-mcp-config --allowedTools mcp__eikona-lan --output-format stream-json --verbose', note: "session-id 在上一轮输出的第一行里" },
    ],
  },
  {
    client: "codex",
    title: "Codex",
    steps: [
      { title: "本机 stdio", command: "codex mcp add sonora -- sonora mcp serve --stdio", note: "Agent 直接启动本机的工具进程" },
      { title: "团队共享服务", command: "codex mcp add sonora-lan --url http://<lan-host>:<port>/mcp --bearer-token-env-var SONORA_MCP_TOKEN", note: "令牌只从环境变量读" },
      { title: "写出的 config.toml", block: true, label: "config.toml", command: '[mcp_servers.sonora-lan]\nurl = "http://<lan-host>:<port>/mcp"\nbearer_token_env_var = "SONORA_MCP_TOKEN"', note: "在 ~/.codex/config.toml 里，文件里只有变量名" },
      { title: "无头模式录一段对话", command: 'codex exec "用 Sonora 给这句台词配音……先告诉我会不会花钱，等我确认" --json < /dev/null', note: "末尾的 < /dev/null 不能省：否则 codex exec 会一直等标准输入" },
      { title: "接着上一轮追问", command: 'codex exec resume <session-id> "选 D，确认生成，费用上限 0.05 美元" --json < /dev/null', note: "session-id 在输出的 thread.started 事件里" },
    ],
  },
];

export interface TroubleRow {
  tool: string;
  symptom: string;
  cause: string;
  fix: string;
  /** Hit for real while recording the samples. */
  seen?: boolean;
}

/** Rows marked `seen` were hit while recording on 2026-10-29; the rest come from the owners' error tables. */
export const troubleshooting: TroubleRow[] = [
  { tool: "Eikona", symptom: "dry run 通过，真正运行却 failed，查询也看不到原因", cause: "比例换算出的尺寸不是 16 的倍数，比如 3:2 算成 1254×836", fix: "直接写 size，比如 1536x1024；用 eikona inspect <run_id> 看错误", seen: true },
  { tool: "Eikona", symptom: "AUTH_ACTION_DENIED", cause: "动作名不对，或这个凭据没有该动作", fix: "不要重复调用；先 search，或读 eikona://docs/mcp-actions 找准确的动作名", seen: true },
  { tool: "Eikona", symptom: "UNKNOWN_COST_REJECTED", cause: "模型没有价格表，无法预估", fix: "确认能接受后，显式加 --allow-unknown-cost" },
  { tool: "Sonora", symptom: "quota_insufficient（HTTP 402）", cause: "Provider 账户额度不足，或请求落到了要付费的模型", fix: "音色写 sonora://voice/<provider>/<voice>，或给 Provider 补额度；不要原样重试", seen: true },
  { tool: "Sonora", symptom: "音乐 approval.issue 返回 rights_blocked", cause: "计划里缺 Provider 的条款版本", fix: "从 music.providers.list 读出 terms_revision，带上它重新 plan.create", seen: true },
  { tool: "Sonora", symptom: "approval_required", cause: "generate 的幂等键、项目或纪元和审批不一致，或审批已过期、已用过", fix: "重新 issue 一次，并用同一组值调用 generate" },
  { tool: "Scaena", symptom: "createVideoProviderTask 返回 INVALID_ARGUMENT", cause: "binding_id 和时长、分辨率、比例混在一起", fix: "按模型提交就别填 binding_id；按线路提交就只填 binding_id", seen: true },
  { tool: "Scaena", symptom: "下载 resource_link 返回 401 AUTH_REQUIRED", cause: "下载链接也要认证", fix: "下载请求带上调用 MCP 时用的同一个令牌", seen: true },
  { tool: "Codex", symptom: "codex exec 一直不动，提示 Reading additional input from stdin", cause: "在等标准输入", fix: "命令末尾加 < /dev/null", seen: true },
  { tool: "Claude Code", symptom: "无头模式跑去调别的工具或技能", cause: "用户级技能和内置工具也在场", fix: '加 --strict-mcp-config 和 --allowedTools mcp__<服务名>；只想用 MCP 时再加 --tools ""', seen: true },
  { tool: "通用", symptom: "unknown_action：Agent 说找不到动作", cause: "动作名是猜的", fix: "先 <tool>.search，再 actions.describe，照着返回的参数结构调用", seen: true },
  { tool: "通用", symptom: "Agent 里看不到工具", cause: "二进制太旧没有 mcp 命令，或服务没连上", fix: "<tool> mcp doctor；再用 claude mcp list 或 codex mcp list 看连接状态" },
];
