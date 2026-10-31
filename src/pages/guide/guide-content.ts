import type { CatalogOwner } from "../../shared/tool-catalog";

/**
 * Static guide copy for the CLI and MCP tools. Every command is copied from the owner's own README or
 * command docs; the page never invents live state from it. Placeholders use <angle-brackets> so no
 * internal address, host or token ever lands in this public repository.
 */

export interface GuideCommand {
  command: string;
  note: string;
}

export type ToolStory = "image" | "audio" | "pipeline" | "text";

export interface GuideTool {
  id: "eikona" | "sonora" | "scaena" | "auctra";
  name: string;
  domain: string;
  /** Catalog owner whose live coverage the card shows; the guide copy itself never depends on it. */
  owner: CatalogOwner;
  story: ToolStory;
  outcome: string;
  install: string;
  commands: GuideCommand[];
  mcp: GuideCommand;
  tools: string[];
  /** Read-only commands for step two; nothing here calls a paid provider. */
  check: GuideCommand[];
  /** Bearer-token env var for a shared HTTP /mcp, or null when the owner only serves loopback. */
  sharedEnv: string | null;
  firstPrompt: string;
  gate: string;
  /** Set when the published binary predates the MCP command. */
  mcpNote?: string;
}

export const installCommand = (tool: string) => `curl -fsSL https://raw.githubusercontent.com/yeisme/yeisme-dist/main/install.sh | bash -s -- ${tool}`;
export const pathCommand = 'export PATH="$HOME/.yeisme/bin:$PATH"';

export const guideTools: GuideTool[] = [
  {
    id: "eikona",
    name: "Eikona",
    domain: "图像",
    owner: "eikona",
    story: "image",
    outcome: "生图、改图、审阅和交接，都在一个命令行里完成。",
    install: installCommand("eikona"),
    commands: [
      { command: "eikona doctor --agent", note: "体检环境，不发起生成" },
      { command: "eikona models recommend --agent", note: "按用途推荐模型" },
      { command: 'eikona generate --model openai/gpt-image-2.5-sunburst --prompt "small product photo" --dry-run', note: "只写证据，不调用 Provider" },
    ],
    mcp: { command: "eikona mcp --transport stdio", note: "本机 stdio；先用 eikona mcp doctor 检查" },
    tools: ["eikona.search", "eikona.execute"],
    check: [
      { command: "eikona doctor --agent", note: "体检环境与凭据，不发起生成" },
      { command: "eikona auth set openai --api-key-stdin", note: "从标准输入读密钥，写进用户级凭据库" },
    ],
    sharedEnv: "EIKONA_MCP_TOKEN",
    firstPrompt: "用 Eikona 体检一下，再推荐一个适合产品图的模型，先别生成。",
    gate: "付费生成前要你确认 Provider 和模型，--max-cost-usd 给出费用上限。",
  },
  {
    id: "sonora",
    name: "Sonora",
    domain: "声音",
    owner: "sonora",
    story: "audio",
    outcome: "配音、TTS、字幕和音乐，从计划一路走到交付。",
    install: installCommand("sonora"),
    commands: [
      { command: "sonora doctor --agent", note: "体检环境，不产生费用" },
      { command: "sonora init --project . --agent", note: "在当前目录建项目" },
      { command: "sonora contract show --json", note: "查看动作与参数合同" },
    ],
    mcp: { command: "sonora mcp serve --stdio", note: "本机 stdio；先用 sonora mcp doctor --json 检查" },
    tools: ["sonora.search", "sonora.execute"],
    check: [
      { command: "sonora doctor --agent", note: "体检环境，不产生费用" },
      { command: "sonora contract show --json", note: "看清有哪些动作和参数" },
    ],
    sharedEnv: "SONORA_MCP_TOKEN",
    firstPrompt: "用 Sonora 看看这个项目做配音需要准备哪些参数，只读。",
    gate: "真实调用需要用户级凭据、预算上限和明确确认；音乐生成还要审批引用。",
    mcpNote: "已发布的二进制还没有 mcp 命令，需要用新版源码构建。",
  },
  {
    id: "scaena",
    name: "Scaena",
    domain: "制作编排",
    owner: "scaena",
    story: "pipeline",
    outcome: "剧本拆成分镜和镜头，再把素材、审阅和交付串成一条线。",
    install: installCommand("scaena"),
    commands: [
      { command: "scaena doctor --agent", note: "体检环境" },
      { command: 'scaena init --title "拆解试验" --episodes 1', note: "建一个一集的试验项目" },
      { command: "scaena board --agent", note: "查看制作看板" },
    ],
    mcp: { command: "scaena mcp serve --stdio --local-project ./demo", note: "默认只读；加 --allow-local-writes 才写本地项目" },
    tools: ["scaena.storyboard.source_import", "scaena.storyboard.breakdown_run", "scaena.storyboard.breakdown_status"],
    check: [
      { command: "scaena doctor --agent", note: "体检环境" },
      { command: "scaena mcp inventory --local-project ./demo --json", note: "列出 MCP 会暴露哪些工具" },
    ],
    sharedEnv: "SCAENA_MCP_TOKEN",
    firstPrompt: "用 Scaena 看一下 demo 项目的制作看板，告诉我卡在哪一步。",
    gate: "模型调用要带 --max-cost-usd 和 --confirm；MCP 的写操作需要一次性审批。",
  },
  {
    id: "auctra",
    name: "Auctra",
    domain: "文本",
    owner: "auctra",
    story: "text",
    outcome: "小说、文章和剧本：素材、brief、候选稿、人工审阅、导出。",
    install: installCommand("auctra"),
    commands: [
      { command: "auctra project workspace --json", note: "查看当前工作区" },
      { command: "auctra review list --status pending --json", note: "列出待你审阅的候选稿" },
      { command: "auctra work inspect --file ./chapter.md --json", note: "检查一份已有稿件" },
    ],
    mcp: { command: "auctra mcp --stdio --project <dir>", note: "本机 stdio；先用 auctra mcp doctor --json 检查" },
    tools: ["auctra.search", "auctra.execute"],
    check: [
      { command: "auctra project workspace --json", note: "确认工作区可读" },
      { command: "auctra mcp doctor --json", note: "检查 MCP 的项目和审计是否可写" },
    ],
    sharedEnv: null,
    firstPrompt: "用 Auctra 列出待我审阅的候选稿，按更新时间排。",
    gate: "AI 输出永远是候选稿；采纳只能在 CLI 或服务 API 里做，MCP 不能替你采纳。",
    mcpNote: "已发布的二进制还没有 mcp 命令，需要用新版源码构建。",
  },
];


export type GuideClient = "claude" | "codex";
export const guideClients: { id: GuideClient; label: string }[] = [{ id: "claude", label: "Claude Code" }, { id: "codex", label: "Codex" }];

/** Registration lines for one tool and client; the shared HTTP form exists only where the owner documents it. */
export function connectCommands(tool: GuideTool, client: GuideClient): GuideCommand[] {
  const local = { command: `${client} mcp add ${tool.id} -- ${tool.mcp.command}`, note: "本机 stdio：Agent 直接启动工具进程" };
  if (!tool.sharedEnv) return [local];
  // Single quotes keep ${VAR} literal in .mcp.json; Claude Code expands it when it connects.
  if (client === "claude") return [local, { command: `claude mcp add --transport http -s project ${tool.id}-lan http://<lan-host>:<port>/mcp --header 'Authorization: Bearer \${${tool.sharedEnv}}'`, note: "团队共享服务：写进项目的 .mcp.json，令牌在连接时从环境变量展开" }];
  return [local, { command: `codex mcp add ${tool.id}-lan --url http://<lan-host>:<port>/mcp --bearer-token-env-var ${tool.sharedEnv}`, note: "团队共享服务：HTTP /mcp，令牌只从环境变量读" }];
}

export interface MoreTool {
  name: string;
  domain: string;
  command: string;
  note: string;
}

export const moreTools: MoreTool[] = [
  { name: "MCP Gateway", domain: "统一入口", command: "mcp-gateway quickstart", note: "把多个服务收进一个 /mcp；工具默认不放行，按名单逐个开。目前从源码构建。控制中心可以只读它的后端、工具与用量，见「接入」。" },
  { name: "Anatomia", domain: "视频拉片", command: "anatomia-video-mcp", note: "本机 stdio 的 MCP 服务，要和 API、worker 指向同一个数据库与对象目录；拉片和问答只排队，由 worker 执行。控制中心可以观察带项目的分析，见「接入」。" },
  { name: "Pinax", domain: "笔记", command: "pinax mcp serve --vault ./my-notes", note: "本地 Markdown 知识库，默认只读，写入要显式开关。" },
  { name: "DriveBridge", domain: "文件", command: "drivebridge install --client claude-code", note: "网盘文件的上传、下载与稳定引用；尚未发布，先从源码构建。控制中心可以只读它的运行记录，见「接入」。" },
  { name: "gitea-mcp", domain: "代码托管", command: "gitea-mcp -t stdio", note: "仓库、PR 和 CI；默认只读，破坏性操作一律拒绝。" },
];

export const callFlow = [
  { title: "列出工具", body: "多数服务只暴露 search 和 execute 两个入口，界面清爽，权限也好审。", code: "tools/list" },
  { title: "先搜动作", body: "用 search 找到准确的动作名和参数结构，不要凭印象猜名字。", code: "eikona.search" },
  { title: "再去执行", body: "execute 带上 idempotency_key；花钱的动作会停下来等你确认。", code: "eikona.execute" },
];

export const tagline = ["终端里", "跑得通的", "命令，", "Agent ", "也能", "照着跑。", "要花钱的", "那一步，", "永远", "先问你。"];

export const faqs: { q: string; a: string }[] = [
  { q: "CLI 和 MCP 该先用哪个？", a: "先用 CLI。体检、凭据和第一次生成在终端里最容易看清；跑通之后再接 MCP，让 Agent 调用同一套能力。" },
  { q: "支持哪些 Agent 客户端？", a: "任何支持 MCP 的客户端。本页给出 Claude Code 和 Codex 的命令；其他客户端按同样的 stdio 命令或 HTTP /mcp 地址填写。" },
  { q: "凭据放在哪里？", a: "放在用户级配置或系统凭据库，比如 eikona auth set openai --api-key-stdin。不要写进项目仓库、配置文件或聊天记录；远程 MCP 的令牌通过环境变量传入。" },
  { q: "生成会花钱吗？谁来确认？", a: "会。Eikona 用 --max-cost-usd 设上限，Scaena 还要 --confirm，Sonora 的音乐生成要审批引用。Agent 走到这一步会停下来等你，不能替你跳过。" },
  { q: "为什么 Agent 里看不到某个动作？", a: "紧凑接口只列 search 和 execute，具体动作要先 search。也可能是已发布的二进制还没有 mcp 命令，用对应工具的 mcp doctor 检查。" },
  { q: "stdio 和 HTTP 怎么选？", a: "只在自己电脑上用就选 stdio，Agent 直接启动本机命令；团队共享或跨机器用 HTTP /mcp，配一个 Bearer 令牌。" },
  { q: "在 Agent 里发起的任务，控制中心看得到吗？", a: "连到控制中心已接入的同一服务和项目时看得到，进度和结果出现在任务中心与资源库。本机 stdio 的记录留在本机工具里。" },
  { q: "控制中心为什么不再提供 AI 创作？", a: "生成要用到凭据、费用确认和审阅，这些都由各工具自己把关。控制中心专心看任务和结果；共享项目的批量生成仍在项目页里。" },
  { q: "页面上的样例是真的吗？花了多少钱？", a: "是 2026-10-29 实际调用生成的。图片每张 $0.005 到 $0.017；两段视频由 Scaena 发起，服务端不记录 Provider 费用，每段请求上限 $2；两句配音在免费额度内，$0；配乐 12 KIE credits。两段 Agent 录制自身的模型费用另算，写在回放末尾。" },
  { q: "样例里的人是真人吗？", a: "不是。画面、视频和声音全部由 AI 生成，人物是虚构的；视频请求里声明了 synthetic_virtual_person。你发布 AI 生成的内容时，也要标明是 AI 生成。" },
  { q: "调用失败了，Agent 会自己重试吗？", a: "不该盲目重试。花钱的调用失败后，先读错误和运行记录。两段回放里，Codex 遇到 402 就停下来问你；Claude Code 换写法之前先做了一次 dry run。" },
  { q: "怎么像回放那样录下一段 Agent 对话？", a: "Claude Code 用 claude -p 加 --output-format stream-json --verbose，Codex 用 codex exec --json；追问分别用 --resume <session-id> 和 codex exec resume <session-id>。完整命令在「配置示例」里。" },
];
