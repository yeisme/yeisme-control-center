# 设计与实施边界

## 现状与目标

控制中心是正式的 TypeScript React/Vite/Bun 客户端；`server/` 是同源、固定 owner allowlist 的只读聚合层。当前代码已覆盖 v18.1 live workspace、请求投影、任务观测、服务 runtime、能力和用量等局部路径。本变更的目标是让这些路径共享一份可验证的 read model 和阶段任务，而不是再建一个第二 UI 或第二后端。

```mermaid
flowchart TD
  Browser[React App Shell] --> Client[src/shared/api/control-center-client.ts]
  Client --> Routes[/api/control-center/v1]
  Routes --> Session[auth + scope + CSRF + epoch]
  Session --> Services[server/service-directory.ts]
  Session --> Tasks[server/task-connections.ts]
  Session --> Requests[server/owners.ts]
  Session --> Providers[server/provider-live.ts\n只读目录与独立 gate]
  Services --> OwnerA[Aigora]
  Tasks --> OwnerS[Scaena]
  Tasks --> OwnerE[Eikona]
  Tasks --> OwnerN[Sonora]
  Requests --> Owners[固定 owner read adapters]
```

## 共享合同

### 读取上下文

每次读取都绑定：

```text
ScopeContext = {
  scope_id,
  tenant,
  project,
  actor,
  identity: issuer + "|" + subject,
  epoch
}
```

`scope_id` 只能来自服务端 session；owner binding 还要再次校验 tenant/project/actor/audience。范围切换、注销、权限变化或身份变化增加 epoch，旧请求的响应必须丢弃。

### 统一状态

所有聚合结果使用同一套 `Coverage`：`complete`、`partial`、`unknown`、`not_recorded`、`forbidden`、`unavailable`、`needs_contract`、`expired`、`integrity_failed`。缺失的进度、大小、耗时、金额和正文用 `null`，不能从终态或空数组推断。

### API 路由

| 路由 | 后端 owner | 前端使用 | 关键验收 |
|---|---|---|---|
| `/auth/methods`、`/session`、`/auth/logout` | `auth.ts` | 登录、范围选择、注销 | 无 token 进入浏览器；scope 不能由客户端自报 |
| `/services`、`/connections` | `service-directory.ts`、`task-connections.ts` | 服务与连接状态卡 | transport/auth/contract/content 分开显示 |
| `/capabilities`、`/usage` | `provider-live.ts` | 能力、用量页面 | readiness/submit gate/cost state 保留未知 |
| `/tasks?mode=active|history`、`/tasks/{key}`、`/tasks/{key}/events` | `task-connections.ts` | 任务列表、详情、事件 | active 不被历史时间窗过滤；保留 cursor/revision |
| `/tasks/{key}/artifacts/{ref}/access` | `media.ts` + `task-connections.ts` | 预览/下载 | CSRF、逐结果授权、短期句柄、无永久 URL |
| `/requests`、`/requests/summary`、`/requests/{owner}/{id}` | `owners.ts` | 请求列表、汇总、详情 | 列表与 summary 分离；owner coverage 独立 |
| `/requests/{owner}/{id}/content:read` | `owners.ts` | 按需正文/输入读取 | purpose + 审计先行；审计失败不读取 |
| `/organization` | `owners.ts` | 团队摘要 | 只显示 owner 提供的成员/角色/binding |

错误至少保持 `401 login_required`、`403 forbidden`、`404 not_found`、`409 cursor_or_revision_conflict`、`422 invalid_or_needs_contract`、`503 source_unavailable`；前端按 code 映射状态，不依据文案猜测。

## 后端设计

- `server/app.ts` 只负责路由、origin、session、scope、CSRF、分页签名和统一错误映射；不把 owner 业务规则写进 handler。
- `server/owners.ts` 只调用固定 owner origin/path，限制重定向、超时、响应大小和 audience；不做任意代理。
- `server/task-connections.ts` 只消费 owner/application service 的 observation 合同；不 shell out、不读 owner 私有数据库、不在本地创建第二任务调度器。
- 内容和媒体访问先校验当前 scope、purpose、owner grant 和审计结果，再生成短期 handle；未知、拒绝、未记录和过期保持不同状态。
- 连接能力可短暂缓存脱敏事实；撤权、scope 变化和失败不得被成功缓存遮蔽。所有浏览器响应 `no-store`，日志与证据不得包含正文、token、Authorization、Provider payload 或私有参数。

## 后端架构与持久化设计（B0–B5 实施细化）

### 分层与模块结构

```text
server/
  index.ts             启动：加载配置 → 打开/迁移 SQLite → 启动恢复 → 组装 app
  app.ts               路由 + session/scope/CSRF/origin/epoch/统一错误映射 + 审计接线（薄层）
  contracts.ts         线上合同类型（epoch、错误类、database 配置）
  auth.ts              personal + OIDC 认证，会话由 SessionStore 支撑
  owners.ts            固定 owner 只读适配器（requests/summary/detail/content/organization）
  task-connections.ts  MCP 任务观测连接（分页 cursor、revision、cancel、artifact 授权）
  media.ts             短期媒体句柄桥（句柄内存态；签发/读取写审计）
  provider-live.ts     能力发现/提交/用量（运行、用量、幂等、预算由 RunStore 持久化）
  service-directory.ts 服务目录投影（freshness：observed_at 与 coverage 传播）
  password.ts          scrypt（不变）
  db/
    client.ts          打开数据库：Bun 运行时用 bun:sqlite，Node 用 better-sqlite3；WAL、busy_timeout、0600、启动迁移
    schema.ts          Drizzle 表定义
    migrations/        drizzle-kit 生成的 SQL 迁移
    session-store.ts   会话仓储（Map 兼容 facade，写穿 SQLite）
    run-store.ts       Provider 运行/用量/幂等仓储
    audit.ts           审计先行助手（initiated 写入 → 动作 → outcome 更新）
```

分层：`edge(index/app) → 认证(auth) → 领域服务 → owner 适配(fetch 边界) → db 持久层`。owner 业务规则不进 handler；数据库只存控制中心自身状态，不复制 owner 状态；浏览器仍是唯一网络的客户端。

### 数据库方案（SQLite + Drizzle ORM）

- **驱动**：`drizzle-orm`，双运行时适配收敛在 `db/client.ts`：Bun（生产 `bun server/index.ts`）用 `drizzle-orm/bun-sqlite` + `bun:sqlite`；Node（vitest）用 `drizzle-orm/better-sqlite3`。better-sqlite3 在 Bun 1.3 原生模块会 NAPI panic，因此按运行时静态选择，不做运行期探测。
- **路径**：`config.database.path` 显式配置；缺省取 `<config_file>.sqlite`（配置文件去掉 .json 后缀）；无配置文件时 `:memory:`（仅开发，审计不落盘）。WAL、`busy_timeout=5000`，文件及 WAL/SHM 以 0600 收敛。
- **迁移**：`bun run db:generate`（drizzle-kit generate）产出 `server/db/migrations/`；服务启动时自动应用（按运行时选对应 migrator）。
- **表**：
  - `sessions`：id、issuer、subject、name、csrf、access_token、access_audience(json)、expires、personal、last_seen、credential_version、epoch、created_at。
  - `audit_events`：自增 id、occurred_at、actor(issuer|subject)、session_id、scope_id、action、owner、target_ref、purpose、outcome、error_code、meta（脱敏 json，不含正文/token/Authorization/Provider payload）。
  - `provider_runs`：run_ref 主键、投影字段（output_refs/evidence_refs json、budget_reserved）。
  - `usage_events`：(owner, source_ref) 唯一 + 用量字段。
  - `idempotency_keys`：key 主键 → run_ref。
- **预算预留语义（行为修正）**：reserved = 非终态运行（accepted/queued/running/reconciling/unknown）budget_reserved 之和；终态（succeeded/failed/reconciled）释放。替代内存实现“成功后仍占用直到重启”的行为，避免持久化后预算被永久锁死。
- **重启恢复**：启动时非终态运行标记 `unknown` + error_code `server_restarted`，不自动重试/重投，仅可手动 reconcile；会话经 SQLite 恢复不掉登录；媒体句柄（120s）与连接观测缓存（15s）维持内存态。

### Epoch 语义（B1）

- `Session.epoch` 为持久化整数，登录时为 1；personal 用户/范围等权限配置变化（persistConfig）时全部会话 epoch+1；credential_version 变化仍直接使会话失效。
- `GET /session` 返回 `epoch`；所有 scope 绑定的 GET 列表/详情响应信封追加 `epoch`，供前端丢弃迟到响应。
- 请求列表 cursor 指纹加入 epoch：epoch 变化后旧 cursor 返回 409。
- 前端作用域切换的本地计数由 F 阶段实现，服务端只提供会话级 epoch。

### 审计先行（B2）

- 严格路径：`content:read`、artifact access（含媒体句柄签发）、media.read、cancel、provider submit/reconcile、admin 用户创建/撤销——调用 owner 前先写 `initiated` 审计行；**审计写失败返回 503 audit_unavailable，不发起 owner 读取**；动作完成后更新 outcome（succeeded/denied/failed/unavailable）。进程中断时行停留在 `initiated`，如实可查。
- 尽力路径（不阻断业务）：auth.login/auth.logout 失败与成功事件。
- `GET /audit`（仅 admin）：按 id 倒序分页（before 游标），固定字段投影 + 脱敏 meta；不提供写操作。
- 审计表 append-only：无 DELETE 路径；未经授权请求（401/403 阶段）不写审计。

### 统一错误类（B1）

错误响应保持 `{error: code}` 并新增 `class` 字段，按状态映射：401→login_required、403→forbidden、404→not_found、409→conflict、400/405/413/422→invalid、429→rate_limited、410→expired、其余 5xx→unavailable。前端可按 class 映射状态，不依文案猜测。

### 凭据与令牌落盘边界

- SQLite 文件以 0600 存于用户级目录，与既有 password_hash_ref/credential_ref 同一保护级别；audit_events 只存脱敏元数据。
- OIDC 会话的 access token 随会话行落盘，但只存在 0600 文件且时长受上游 exp 与本地 30 分钟上限约束；personal 会话不含任何 token。若未来要求更高，可在持久化层加密 accessToken 列，当前按本地单用户威胁模型接受。

### 后端验证脚本

- `bun run test:contract-integration`：隔离 fake owner 的 API 级全链路（登录→范围→服务→任务→媒体→请求→审计→epoch），证据写入 `temp/integration-test-runs/contract-integration-*`。
- `bun run test:server-boot`：真实 `bun server/index.ts` 子进程验证 bun:sqlite 生产路径（迁移、0600、审计落盘、会话重启存活、非终态运行恢复为 unknown），证据写入 `temp/integration-test-runs/server-boot-*`。

## 前端设计

- `src/shared/api/control-center-client.ts` 是唯一网络入口；禁止页面直接 `fetch` owner URL，禁止使用 `any` 隐藏合同缺口。
- App Shell 保持现有 HashRouter 和统一导航；scope、身份、连接、任务、请求和能力页面复用同一状态组件。
- 每一页至少覆盖 `loading`、`ready`、`empty`、`stale`、`forbidden`、`unavailable`、`unknown`；部分来源显示可读 coverage 和 observed_at。
- 详情工作区使用现有桌面固定/移动 Sheet 规则；范围变化清空正文，响应式断点变化保留同一合法对象和草稿，迟到响应按 epoch 丢弃。
- 任务 unknown 只能查询原 task_ref/revision；不渲染“已成功”，不自动重试或重新生成。预览/下载按钮只由后端 `allowed_actions` 和 content capability 同时启用。

## 阶段门禁

### CONTRACT

冻结路由、字段、状态、错误、游标、授权、短期句柄和兼容策略；生成合同样例/验证入口。未完成前不进入前后端实现。

### BACKEND

在隔离端口和临时配置中完成 server 适配与权限测试。后端阶段不启动前端、不做截图、不触碰真实 Provider submit。

### FRONTEND

在网络层 mock 下完成 typed client、页面状态、详情工作区和关键路径测试。前端阶段不因真实 owner 未启动而失败，也不修改 server。

### INTEGRATION

先用 fake owner 验证登录→范围→列表→详情→内容授权→结果入口，再运行 `bun run test:owner-live-read` 做真实只读回读。任何 owner 未配置、授权未委托或任务为空都如实标记 `INTEGRATION_PENDING`/`not_recorded`。

## 运行与证据

本项目聚焦命令：

```bash
bun run typecheck
bun run test
bun run build
bun run test:app
bun run test:owner-live-read
```

跨端运行写入 `temp/integration-test-runs/<run-id>/` 的 `summary.json`、`command.txt`、`stdout.log`、`stderr.log`、`env.json` 和 `artifacts/`；失败保留原始退出码。真实 owner 读取不保存 token、Cookie、正文或 Provider 原始载荷。race 不属于本变更。

## 回滚

回滚只关闭新增 read route、恢复旧静态构建或移除新 adapter 配置；不删除任务、结果、账本、凭据和 owner 数据。持久化回滚 = 移除 `config.database.path` 使服务回到内存态；SQLite 文件（含审计）原地保留不删。合同新增字段采用向后兼容的可选增量，冲突时优先保留旧路由并将新字段标记为 `needs_contract`。
