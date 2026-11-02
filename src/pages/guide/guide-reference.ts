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

export interface ControlCenterStep {
  title: string;
  body: string;
  commands: GuideCommand[];
}

/**
 * Connecting a tool to the control center: a read-only observer credential issued by the tool, then one connection
 * line in the control center's own config. The flags are the owners' own (eikona service access-key issue,
 * sonora serve) and the control center's personal-config script.
 */
export const controlCenterSteps: ControlCenterStep[] = [
  {
    title: "在工具那边签发只读观察凭据",
    body: "观察凭据只能读任务、进度和结果清单，不能生成、修改或取消，而且必须绑定一个项目。要在控制中心里预览结果，另外给它内容权限。",
    commands: [
      { command: "eikona service access-key issue --name control-center --role reader --project <project-id> --purpose personal-observer-v1 --key-file <key-dir>/eikona-observer.key", note: "Eikona：再加 --purpose personal-observer-content-v1 才能预览结果" },
      { command: "sonora serve --mcp-observer-token-file <token-file> --mcp-observer-project <project-ref>", note: "Sonora：追加到服务现有的 serve 参数后；观察令牌和执行令牌分开，--mcp-observer-content 另开预览" },
    ],
  },
  {
    title: "在控制中心登记连接",
    body: "凭据文件必须是 0600；配置里只记文件位置，不记内容。",
    commands: [
      { command: "bun scripts/personal-config.ts connect <config-file> eikona-main eikona https://<owner-host>/mcp <project-id> <key-dir>/eikona-observer.key", note: "加 --content 允许预览结果；私网 http 地址要加 --private-http" },
    ],
  },
  {
    title: "重启后核对",
    body: "重启控制中心，「服务」页的这条连接显示“任务观测”和可读状态，任务出现在「任务」页和工作台。被拒时页面会写明是授权、合同还是网络的问题。",
    commands: [],
  },
];

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

export interface ConnectedTool {
  id: "anatomia" | "drivebridge" | "gateway";
  name: string;
  /** How the control center reads it: like a task owner, or as runs of an open tool. */
  kind: "任务观测" | "运行投影";
  /** What shows up in the control center once connected. */
  sees: string;
  steps: GuideCommand[];
  /** Replacing the credential before it runs out, or once the tool refuses it; the anchor is `guide-renew-<id>`. */
  renew: GuideCommand[];
}

/**
 * Tools beyond the creative ones that the control center can read. Commands follow each owner's docs
 * (Anatomia's control-center observation contract, DriveBridge's agents CLI, MCP Gateway's tokens CLI) and the
 * control center's personal-config script; addresses, projects and files stay placeholders.
 */
export const connectedTools: ConnectedTool[] = [
  {
    id: "anatomia",
    name: "Anatomia",
    kind: "任务观测",
    sees: "拉片分析和视频问答的进度、阶段，以及拉片得到的关键帧；不能在控制中心取消。",
    steps: [
      { command: "anatomia service key create --db <state-dir>/anatomia.db --key-ref service-key:<org>:control-center --observer-tenant tenant:<tenant> --observer-project project:<name> --observer-content --owner-auth-ref <owner-auth-ref> --evidence evidence:<ref> --out <key-dir>/anatomia-observer.key --json", note: "服务端要开 MCP（ANATOMIA_MCP_STREAMABLE_HTTP_ENABLED=true，控制中心访问用的 Host 要在 _ALLOWED_HOSTS 里）和 ANATOMIA_TASK_OBSERVATION_ENABLED=1；tenant 和 project 要与分析上记录的一致；--out 必须是还不存在的绝对路径；只看进度就去掉 --observer-content" },
      { command: "bun scripts/personal-config.ts connect <config-file> anatomia-main anatomia https://<anatomia-host>/mcp project:<name> <key-dir>/anatomia-observer.key --content", note: "只列出属于这个项目的拉片分析；没有记录项目的分析和视频问答不会出现；私网 http 地址加 --private-http" },
    ],
    renew: [
      { command: "anatomia service key create --db <state-dir>/anatomia.db --key-ref service-key:<org>:control-center-next --observer-tenant tenant:<tenant> --observer-project project:<name> --observer-content --owner-auth-ref <owner-auth-ref> --evidence evidence:<ref> --out <key-dir>/anatomia-observer-next.key --json", note: "参数和第一次一样，只把 --out 换成一个还不存在的新文件；--key-ref 若提示已存在就换个新名字。旧密钥文件先留着，换好并核对之后再删" },
      { command: "bun scripts/personal-config.ts credential <config-file> replace connection:anatomia-main <key-dir>/anatomia-observer-next.key", note: "文件必须是 0600。换上时会清掉旧密钥的到期记录；这把密钥有到期时间就加 --expires-at <RFC3339>，不会过期就加 --expires-at never，两样都不给，「服务」页会写“未记录到期时间”。然后重启控制中心" },
    ],
  },
  {
    id: "drivebridge",
    name: "DriveBridge",
    kind: "运行投影",
    sees: "服务健康、上传下载等运行的进度和失败；看不到文件名、路径和空间容量。",
    steps: [
      { command: "drivebridge-server --config <config-file> --state <state-dir> agents create --name yeisme-control-center --space <space-id> --scopes read --days 30 --out <key-dir>/drivebridge-agent.token --json", note: "令牌最长 30 天，到期前重签；服务运行时这条命令会以 state_in_use 退出，先停服务再签；开了治理的实例要用含签发修复的版本，否则密钥用户的空间会被拒（forbidden）" },
      { command: "bun scripts/personal-config.ts open-tool <config-file> drivebridge https://<drivebridge-host> <key-dir>/drivebridge-agent.token --expires-in 30d", note: "read 权限也能读这个空间的文件，控制中心只调用健康、能力和运行记录三个接口；私网 http 地址加 --private-http。DriveBridge 不会告诉控制中心令牌什么时候到期，所以登记时用 --expires-in 记下（和签发时的 --days 30 对应），到期前「服务」页会提醒" },
    ],
    renew: [
      { command: "systemctl --user stop <drivebridge-unit>", note: "先停服务：服务运行时，下一条签发命令会以 state_in_use 退出。这里以 systemd 用户服务为例，换成你平时管理 DriveBridge 的办法" },
      { command: "drivebridge-server --config <drivebridge-config> --state <state-dir> agents create --name yeisme-control-center --space <space-id> --scopes read --days 30 --out <key-dir>/drivebridge-agent-next.token --json", note: "--config 是 DriveBridge 自己的配置，不是控制中心的。--out 必须是还不存在的新文件，权限 0600；新令牌最长 30 天，到期时间是签发的时刻加 30 天，记下来给最后一步用" },
      { command: "systemctl --user start <drivebridge-unit>", note: "签完马上把服务启动起来；停着的这段时间，文件传输也是停的" },
      { command: "bun scripts/personal-config.ts credential <config-file> replace open_tool:drivebridge <key-dir>/drivebridge-agent-next.token --expires-at <RFC3339>", note: "<RFC3339> 写新令牌的到期时间，例如 2026-12-02T10:00:00+08:00。换上时会清掉旧令牌的到期记录；然后重启控制中心，旧令牌文件核对后再删" },
    ],
  },
  {
    id: "gateway",
    name: "MCP Gateway",
    kind: "运行投影",
    sees: "后端是否就绪、网关列出的工具（进「模型与工具」）、REST 运行和 7 天调用量；不会替你调用任何工具。",
    steps: [
      { command: "mcp-gateway tokens create --tenant <tenant> --workspace <workspace> --scopes mcp:tools:read,mcp:audit:read --ttl 720h --actor-id yeisme-control-center --credential-dir <key-dir> --json", note: "要用管理令牌（MCP_GATEWAY_ADMIN_TOKEN）签发；一定带 --workspace，否则读不到后端、运行和用量；令牌写进 <key-dir>/tokens/<token-id>.token，不打印明文。个人网关没有管理令牌时，改由属主控制台用 token.create 计划签发并确认，只能签普通 scope，读不到用量，服务页显示“未授权”" },
      { command: "bun scripts/personal-config.ts open-tool <config-file> gateway https://<gateway-host> <key-dir>/tokens/<token-id>.token --expires-in 720h", note: "停用：open-tool <config-file> gateway off；改地址或换令牌加 --replace。--expires-in 720h 对应签发时的 --ttl 720h，登记后到期前「服务」页会提醒" },
    ],
    renew: [
      { command: "mcp-gateway tokens create --tenant <tenant> --workspace <workspace> --scopes mcp:tools:read,mcp:audit:read --ttl 720h --actor-id yeisme-control-center --credential-dir <key-dir> --json", note: "参数和第一次一样，用管理令牌（MCP_GATEWAY_ADMIN_TOKEN）再签一枚；新令牌写进 <key-dir>/tokens/ 下的新文件，不会覆盖旧文件。没有管理令牌时，由属主控制台用 token.create 计划签发并确认" },
      { command: "bun scripts/personal-config.ts credential <config-file> replace open_tool:gateway <key-dir>/tokens/<new-token-id>.token --expires-in 720h", note: "换上新文件并记下新的到期时间；旧令牌的到期记录会被清掉。然后重启控制中心，旧令牌文件核对后再删" },
    ],
  },
];

/**
 * Every other credential the control center holds (Eikona, Sonora, Scaena and Auctra connections): issue the same
 * kind of credential again, the way the first connection did, then replace it by slot. The slot ids come from `list`.
 */
export const renewGeneral: GuideCommand[] = [
  { command: "bun scripts/personal-config.ts credential <config-file> list", note: "列出每个凭据的槽位、状态和记录的到期时间；输出里没有文件位置和地址。槽位形如 connection:<连接 id>、open_tool:<工具>、collection:auctra" },
  { command: "bun scripts/personal-config.ts credential <config-file> replace connection:<id> <key-dir>/<new-key-file> --expires-at <RFC3339>", note: "新凭据照第一次接入时的签发命令再签一份（见上面的「接入控制中心」），写进新文件后用这条换上。文件必须是 0600；不给日期，旧的到期记录就清掉" },
  { command: "bun scripts/personal-config.ts credential <config-file> expiry <slot> <RFC3339>", note: "凭据已经在用、只是没记到期时间时，用它补记；填 none 就清除记录。凭据本来就不会过期的（比如 Auctra 的服务密钥）填 never，「服务」页写“不过期”，不再提示没记录" },
];
