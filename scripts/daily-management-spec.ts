import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { serviceDefinitions } from "../src/service-directory";

const root = resolve(import.meta.dirname, "..");
const change = resolve(root, "openspec/changes/yeisme-personal-daily-management-v1");
if (!existsSync(resolve(change, ".openspec.yaml")))
  throw Error("Run openspec new change yeisme-personal-daily-management-v1 first.");
const [command = "generate", task, evidence] = process.argv.slice(2);
const tasks = [
  "CONTRACT：主原型、本地基线与全部现存服务目录；scope=src/service-directory.ts、docs/daily-management-baseline.md；依赖=无；验证=bun scripts/daily-management-spec.ts generate；预期=目录与文档一致，退役项目不登记",
  "CONTRACT：个人身份、目录和交付边界；scope=server/contracts.ts、src/service-directory.ts、此变更；依赖=1.1；验证=openspec validate yeisme-personal-daily-management-v1 --strict；预期=合同完整，无 owner 越权",
  "BACKEND：用户名、角色、受控目录与健康；scope=server/、scripts/personal-config.ts、tests/相关测试；依赖=2.1；验证=bun run test -- tests/personal-auth.test.ts tests/service-directory.test.ts；预期=成功、拒绝及兼容用例通过",
  "FRONTEND：真实登录、全服务目录、设置与工作区；scope=src/相关组件、tests/相关测试；依赖=2.1；验证=bun run typecheck 及隔离浏览器验证；预期=六入口、异常状态和响应式可用",
  "INTEGRATION：核心三服务真实只读；scope=独立运行配置与脱敏证据；依赖=3.1、4.1及合法 observer；验证=受限能力、原任务、原结果读取；预期=三服务分别有真实证据，不付费、不发真实取消",
  "INTEGRATION：最终质量和安全；scope=本项目测试入口；依赖=5.1；验证=bun run typecheck && bun run test && bun run build 及目标浏览器链路；预期=无新增失败，证据六件套齐全，不运行 race",
  "INTEGRATION：10.10.1.101 交付与运行说明；scope=控制中心专属运行环境及docs；依赖=6.1、部署准入与凭据安全初始化；验证=HTTPS、登录、核心读取、重启恢复；预期=实际可访问，停止不影响 owner",
];
const putNew = (file: string, body: string) => {
  if (existsSync(file)) return;
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, body.trim() + "\n", { flag: "wx" });
};
if (command === "generate") {
  putNew(resolve(change, "proposal.md"), `## Why
现有控制中心已具备个人密码和任务观测，但缺少明确用户名、角色及全服务真实接入目录，日常内网授权与部署尚未验收。复用现有项目完成日常管理闭环，不新建第二控制台。

## What Changes
- 在既有 personal 登录增加可选用户名和显式控制中心角色，保持旧密码登录兼容。
- 统一全部现存产品目录与当前范围连接配置，登记、配置、授权与观测分别表达。
- 保持 AdminCN 六入口；不把 Open Design 样例或未接受提案作为真实数据。
- 核心三服务实际读取、TLS 内网入口和账号初始化独立验收。现行部署禁令未解除前不部署。

## Capabilities
### New Capabilities
- personal-daily-management: 具名个人管理身份与安全服务目录。

## Impact
split-owner。控制中心只拥有 UI、身份会话及连接映射；owner 保留领域权限、任务、资产与账本。无关系型存储新增，无迁移、远程 Shell、付费生成、提交推送或 owner 服务升级。`);
  putNew(resolve(change, "design.md"), `## Context
Open Design MCP 已确认主项目 yeisme-service-control-center、index.html、六入口 AdminCN v7 与能力矩阵；后续会话过期不抹除已读取证据。client/yeisme-control-center 为未初始提交的独立 Git 工作区，当前实现必须保留。10.10.1.101 是本机，三个 yeisme-lan owner unit 正在运行，但没有控制中心配置与 observer 授权证明。

## Decisions
- PHASE 分离：CONTRACT 固定协议；BACKEND 和 FRONTEND 独立验收；真实联通进入 INTEGRATION。
- workspace 例外：源码全部未提交，无法在不提交的前提建立等价 worktree。单写入者留当前 checkout，测试使用临时配置、独立端口、进程及证据目录；不切分支、不提交。
- 沿用 React/Vite/Bun、AdminCN、Radix、Lucide、Vitest 和 Playwright，不引入数据库或权限平台。
- personal.username 可选；已配置时 POST /auth/personal 必须提供匹配 username 和 password。旧配置无 username 时仍允许 password-only。role 来自服务端配置，仅 admin/viewer；旧配置与 OIDC 默认为 viewer，不自动提升。
- GET /session 增加 username（可选）与 role。控制中心 admin 仍受 scope_ids、connection_ids 和 owner 凭据限制；不能获得未授权正文或触发缺合同动作。
- GET /auth/methods 增加 username_required，不公开实际账号。登录失败统一 invalid_credentials；已有节流、哈希、过期和 CSRF 保留。
- GET /services?scope=<id> 为已登录、范围绑定的配置目录；schema_version=yeisme.service_directory.v1。只返回静态产品信息及当前 scope 允许的连接 id/label/environment/project、配置开关。禁止 endpoint、credential_ref、秘密、其他范围连接。observation=not_checked，配置不等于上线。
- 动态健康和授权使用现有任务观测返回，不从静态目录猜测；断连、未授权和缺合同分别显示。取消和内容开关只是本地意愿，不增加 owner 权限。重试仍缺稳定合同，不显示可执行。
- GET /health 只证明该进程响应，不探测 owner、不公开用户、路径或秘密；不是三服务 readiness。
- 命名个人用户初始化用现有 personal-config CLI；密码通过交互或标准输入进入强哈希路径。默认拒绝覆盖已有配置；不持久化真实明文。
- 本地目录修正已退役 Yeitra；空目录 mediahub/n8n 不冒充现存产品；个人网关与企业 Aigora 保持独立。

\`\`\`mermaid
flowchart LR
 U[AdminCN 六入口] --> B[同源会话与范围检查]
 B --> D[产品目录及受限配置投影]
 B --> T[现有任务观测与媒体桥]
 T --> O[Scaena Eikona Sonora 公开合同]
 O --> S[owner 状态 权限 资产 回执]
\`\`\`

## UI contract
复用 AppShell、DataTable、AdminPanel、PanelNotice。登录为 username/password 表单，错误清晰、提交期间禁用；服务页以产品类型/搜索/配置状态筛选，详情显示 owner 与接入缺口，不展示假绿灯。账号与设置明确角色和 owner 权限边界。390/768/1440/1920 视口、明暗、键盘/焦点、加载/空/错误均验收；不新增装饰或动画库。

## Rollout and blockers
当前 AGENTS.md 仍禁止真实部署及实际授权变更。先完成本地源代码；部署前必须解除有效冲突，取得合法 observer 和现存可验收任务。现行单元运行不证明 observer 存在。无任务时不自动生成样本；无 TLS 信任时不能把忽略证书错误作为安全交付。指定内网入口不授权修改其他服务或复用 Agent 管理 key。

## Verification
聚焦新增身份/目录测试，再执行最终类型、测试、构建与目标浏览器链路。真实接入六件套保存在 temp/integration-test-runs。失败保留，区分 introduced/pre_existing/concurrent/environment/ambiguous。无 race。

## Rollback
旧 personal 配置与 OIDC 接口兼容；新目录 GET 不修改 owner。停止控制中心不会停止 owner 或删除任务。仅回退此次源码与独立运行配置，不恢复/覆盖无关未提交成果。`);
  putNew(resolve(change, "tasks.md"), `# 日常管理交付\n\n${tasks.map((t,i)=>`- [ ] ${i+1}.1 ${t}；owner=控制中心；lane=串行；失败=保留脱敏证据、归因并重跑聚焦检查`).join("\n")}\n\n使用 bun scripts/daily-management-spec.ts mark <编号> <证据引用> 更新，不手改状态。`);
  putNew(resolve(change, "specs/personal-daily-management/spec.md"), `## ADDED Requirements

### Requirement: Named personal identity
系统 SHALL 从服务端配置核验 personal username/password，并返回可信角色；旧未配置用户名的个人模式保持兼容。

#### Scenario: 已配置用户名
- **WHEN** 密码正确但用户名缺失或不匹配
- **THEN** 返回统一 invalid_credentials，不创建会话

#### Scenario: 角色与 owner 授权
- **WHEN** 控制中心 admin 查询或操作 owner
- **THEN** 仍检查范围、固定连接及 owner 独立权限，不信任客户端 role

### Requirement: Honest scoped service directory
系统 SHALL 区分产品登记、当前范围配置和实际观测，仅返回允许范围内的非秘密连接信息。

#### Scenario: 未配置或未授权
- **WHEN** 某服务缺合同或未登记当前用户连接
- **THEN** 显示准确缺口，不返回其他用户连接，不补造在线状态或样例任务

#### Scenario: 静态目录查询
- **WHEN** 用户读取目录
- **THEN** 不调用上游、不读取秘密、不执行生成或管理动作

### Requirement: Separate live acceptance
系统 SHALL 分别记录源码、隔离测试、真实授权读取与部署证据。

#### Scenario: 缺部署准入或 observer
- **WHEN** 真实验证缺有效权限或部署允许
- **THEN** 停止相关步骤并请求最小授权，不将演示或进程在线标记为全链路通过`);
  const baseline = `# 日常管理基线与能力清单

本文件由 scripts/daily-management-spec.ts 生成，产品目录真源 src/service-directory.ts。基线取证为 2026-10-08 本次本地检查，不代表逐服务线上验收。

## 已确认事实
- Open Design MCP 读取了项目 yeisme-service-control-center 的元数据、index.html、docs/README.md 与 docs/capability-matrix.md。主入口仍是 AdminCN 六入口；后续 MCP 会话过期，未重新生成或修改原型。
- client/yeisme-control-center 已有 React/Vite/Bun 代码、个人登录、有限取消、媒体和任务测试。独立 Git 尚无初始提交，本次保留全部已有文件。
- 本机 qianxi-node 网卡持有 10.10.1.101。yeisme-lan-eikona/scaena/sonora.service 为 active/running；端口分别由已存在单元描述指向 18976/18979/18980。这只证明进程状态。
- 用户级 ~/.config/yeisme-control-center 不存在；没有取得控制中心 observer 授权证明。单元文件未出现 observer 字样，但可能由其他配置提供，不能据此断言服务不支持。
- 443 已被既有 ingress 占用；本次无修改。TLS 连接没有取到证书，不能视为安全入口已可用。
- 本项目 AGENTS.md 仍禁止真实部署、实际授权变更和生产写；待解决准入冲突，不自动覆盖。

## 产品目录

| 项目 | 类型 | owner | 本地适配 | 实例/身份/真实验收 | 缺口 |
| --- | --- | --- | --- | --- | --- |
${serviceDefinitions.map(s=>`| ${s.name} | ${s.kind} | ${s.owner_path} | ${s.integration} | ${['scaena','eikona','sonora'].includes(s.id)?'进程运行；用户授权与真实读取未验收':'未核验'} | ${s.gap} |`).join('\n')}

## 排除与待核验
Yeitra、Radar、旧 Workbench、Ordo 已退役，不恢复；Open Design 遗留 3D 页面不代表 Yeitra 仍可管理。cli/mediahub 与 backend-server/n8n 当前仅有空目录，无 README/应用合同，暂不登记为现存产品。agent/logs、run、temp 及同类目录是运行产物，不是服务。新发现的实际个人服务由同一目录扩展，不另建领域后端。

## 验收对象
核心三服务各需要：固定实例、合法 project-scoped observer、至少一个现存任务及可用结果、明确内容读取权限。缺任何一项不自动创建付费样本或扩大权限。目录覆盖与真实接通分别记录；项目清单不是运行监控结果。
`;
  writeFileSync(resolve(root, "docs/daily-management-baseline.md"), baseline);
  console.log("Generated daily-management contracts and source-derived inventory; runtime unchanged.");
} else if (command === "mark") {
  if (!/^\d+\.1$/.test(task || "") || !evidence || /[\r\n]/.test(evidence))
    throw Error("Usage: mark <task> <single-line evidence reference>");
  const path = resolve(change, "tasks.md");
  const source = readFileSync(path, "utf8");
  const marker = `- [ ] ${task} `;
  if (!source.includes(marker)) throw Error("Pending task not found.");
  writeFileSync(path, source.replace(marker, `- [x] ${task} `) + `\n验证 ${task}：${evidence}\n`);
  console.log("Task evidence recorded.");
} else if (command === "report") {
  const ids = process.argv.slice(3);
  if (ids.length !== 3 || ids.some(id => !/^[a-z0-9T-]+Z$/.test(id)))
    throw new Error("Use report <local-gates-run> <frontend-run> <component-run>.");
  const summaries = ids.map(id => JSON.parse(readFileSync(resolve(root, "temp/integration-test-runs", id, "summary.json"), "utf8")));
  if (summaries.some(s => s.status !== "passed")) throw new Error("A supplied local verification did not pass.");
  const document = `# 日常管理：本地实现与待授权交付

## 当前结论
本地代码与隔离验证通过；真实三服务接入和内网部署尚未完成。没有创建真实管理员、读取或签发 owner 凭据、修改现有服务、部署入口、付费生成、提交推送或运行 race。目标不能标记完成。

## 本次变更
- 具名个人登录、可信 admin/viewer、旧配置兼容、统一登录错误、会话失效与退出；管理员也不能绕过 CSRF、scope 或 owner 权限。
- 26 项现存产品目录、范围化非秘密连接投影、搜索筛选与详情。目录登记、配置、授权和真实观测分开；退役 Yeitra 不恢复。
- 真实模式六入口、个人账号/角色、历史任务结果页、加载与失效状态；手机保留关键接入状态，不用设计样例回退。
- 配置 CLI 增加具名初始化和显式账号迁移；不覆盖已有配置或替换其他用户名。旧未具名配置默认 viewer，需操作者显式设置 admin 才能发起取消，详见 personal-task-observation.md。
- 健康端点只证明控制中心进程存活。有限取消仍需本地意愿与 owner 额外授权，未知回包只查询原回执。

## 验证事实
- 本项目 typecheck、85 项测试及 build 通过；保留已有约 722 kB 主 chunk 警告，没有把警告隐藏为通过。
- 网络合同 mock 下 8 组浏览器检查通过，覆盖 390/768/1440/1920 明暗、六入口、搜索/键盘/详情、错误、资产引用和会话退出。
- 真实控制中心服务加 fake MCP 的 11 组组件检查通过，覆盖受控媒体、取消 revision 冲突、丢回包恢复、目录和账号。不等于三个日常 owner 真实验收。
- 主动 LSP 检查 17 文件：7 确认 clean，5 无法确认，5 含辅助 ast-grep 规则发现；不能宣称静态检查全部 clean。辅助发现主要为既有 URL/JSON 抛错调用和 Error 构造风格，TypeScript 编译检查通过。
- 前端前两次失败是测试将表格行误当按钮、将底部设置误当主导航；选择器修正后通过，失败目录保留。

证据入口：
${ids.map(id => `- temp/integration-test-runs/${id}/summary.json`).join('\n')}

每个目录均保留 command.txt、stdout.log、stderr.log、env.json 与 artifacts/。截图与测试数据均为隔离样例，不是生产内容。

## 阻塞与最小授权
1. client/yeisme-control-center/AGENTS.md 明确禁止部署真实服务、改变实际授权；必须先明确本次仅控制中心内网部署与初始管理员的例外，不能自行删除禁令或扩大为 owner 部署权限。
2. 尚无控制中心专用三服务 observer 配置。需要操作者提供已有合法文件引用、项目范围及内容授权；若尚不存在，签发和 owner 配置调整需要另外明确授权。不能复用当前 Agent 的管理密钥，也不能凭进程 running 推断授权。
3. 443 已被现有 ingress 占用；尚无可验收的控制中心 TLS 信任入口。后续优先使用独立内网端口/入口，不覆盖现有 ingress，不将忽略证书错误当作安全验收。
4. 三服务真实读取需要现存已授权任务和可用结果；没有样本时不自动创建付费任务。

## 本地重验命令
在 client/yeisme-control-center 执行：

\`\`\`bash
bun scripts/verify-daily-backend.ts --full
bun scripts/verify-daily-frontend.ts
bun scripts/verify-task-visibility.ts
openspec validate yeisme-personal-daily-management-v1 --strict
\`\`\`

最后一项组件测试需要先完成 build；full 已包含 build。验证脚本使用独立端口和临时凭据，退出后关闭自有进程，不修改日常服务。当前没有可宣称为交付完成的 10.10.1.101 应用 URL；Open Design URL 仅为设计预览。
`;
  writeFileSync(resolve(root, "docs/daily-management-delivery.md"), document);
  const taskFile = resolve(change, "tasks.md");
  const current = readFileSync(taskFile, "utf8");
  writeFileSync(taskFile, current + `\n阶段记录：INTEGRATION INTEGRATION_PENDING；本地门禁、前端与 fake MCP 组件验证见 docs/daily-management-delivery.md；真实 observer、部署准入与 TLS 尚缺，5.1/6.1/7.1 不标完成。\n`);
  console.log("Local verification report recorded; live integration and deployment remain pending.");
} else throw new Error("Use generate, mark or report.");
