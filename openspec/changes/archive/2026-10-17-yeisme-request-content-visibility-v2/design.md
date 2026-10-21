# 设计与实施边界

## 断链与目标

```mermaid
flowchart TD
  subgraph CC[控制中心同源服务]
    Session[personal/OIDC 会话]
    Owners[server/owners.ts 读取适配]
    Audit[审计先行 audit_events]
    Media[MediaBridge 短期句柄]
  end
  Session -->|scope binding actor/tenant/project| Owners
  Owners -->|1. OIDC 会话委托优先| Eik[Eikona]
  Owners -->|2. 服务凭据 credential_ref| Eik
  Owners -->|2. 服务凭据| Sca[Scaena]
  Owners -->|2. 服务凭据| Son[Sonora]
  Owners -->|2. 服务凭据| Aig[Aigora]
  Audit -->|写失败即 503 不读取| Owners
  Eik -. attachments:read + 附件 content:read .-> Owners
  Media -->|text/* 直接返回<br/>image|audio|video 字节句柄| Browser[RequestDetail 附件区]
```

目标：personal 内网登录即可见请求列表/详情；提示词与响应文本按需读取（audit 先行）；Eikona 上传附件可预览；Scaena/Sonora 合同就绪后零改动点亮。

## 委托通道（服务凭据）

- `config.owners[owner]` 增加可选 `credential_ref: string`（0600 文件引用；读取走既有 `secret()`，权限校验 0600）。
- `owners.ts` 授权头选择：会话 `accessToken + accessAudience.includes(audience)`（OIDC，现状不变）→ 否则 `credential_ref` 服务凭据 `Bearer secret(...)` → 否则 `delegation_unavailable(403)`。
- scope binding 的 tenant/project/actor 照旧随查询参数传递；owner 侧审计 receipt 保留最终行为者；控制中心侧审计先行不变。
- `/services` 与 `/auth/methods` 的 configured 反映 `origin + (credential_ref 或 OIDC 可用)`；前端 delegation 提示仅在完全无凭据时显示。

## 附件正文合同（Eikona 模式，线合同冻结）

- 元数据：`POST {owner requests path}/{id}/attachments:read` body `{direction?, purpose, project_id, tenant_id}` → `{schema_version:"yeisme.request_attachments.v1", attachments:[{ref,direction,job_ref,asset_ref,upload_ref,role,mime,size_bytes,sha256,state}], coverage:{state,observed_at}}`。
- 字节/文本：`POST .../attachments/{ref}/content:read` body 同上 → `{schema_version:"yeisme.request_attachment_content.v1", state, receipt_ref, mime, sha256, data_base64?, text?, truncated}`。
- 控制中心路由：`POST /requests/{owner}/{id}/attachments/{ref}/content:read`，body `{direction?, purpose}`；校验与 content:read 相同（长度、白名单键）；**审计先行**（`requests.attachment_read`）。
- 返回分流：
  - owner 返回 `text` 或 `text/*` mime → 直接 `{state, text(≤64KB), truncated, receipt_ref}`；
  - 图片/音频/视频 → 校验 mime 白名单与 ≤8MB → MediaBridge **bytes handle**（内存句柄 120s、逐次校验会话/scope/epoch 活性、`/media/{handle}` no-store 输出）。
- 降级真实：owner 未实现（404/405/合同不符）→ `needs_contract`；未采集 → `not_recorded`；403 → `forbidden`；不伪造成功。

## 前端

- `control-center-client.ts` 新增 `readRequestAttachment(owner, id, attachmentRef, direction, purpose, csrf, signal)`。
- RequestDetail 附件区：每附件「读取」按钮（复用用途输入与审计提示），文本内联 `<pre>`，图片 `<img>`、音频 `<audio>` 经句柄 URL 预览；状态复用 Coverage 标签。
- 正文与附件字节只存会话内存；范围切换/注销清空（epoch 既有语义）。

## 安全不变量

- 审计先行双向：控制中心 `requests.attachment_read` 写失败 503 且零 owner 调用；owner 侧 receipt 可追溯。
- 所有响应 `no-store`；服务凭据诊断只报来源类型与路径。
- owner 边界沿用：固定 origin、`redirect:"error"`、6s 超时、2MB JSON 上限、附件 8MB 上限、mime 白名单。

## 阶段任务与验证

- CONTRACT：冻结本设计线合同（路由/字段/审计动作/错误类）→ `openspec validate --strict`。
- 后端：委托通道 + attachments adapter + MediaBridge bytes handle + 路由/审计 → `bun run test -- owners-delegation attachments media-bridge server-security audit-first`。
- 前端：client + RequestDetail 附件区 → `bun run typecheck && bun run test`。
- fixtures/联调：fake owner 附件端点 + 服务凭据鉴权；`bun run test:contract-integration` 扩展断言。
- 回归：`bun run test`、`bun run test:server-boot` 不回退。

## 回滚

移除 `credential_ref` 配置即回到纯 OIDC 委托；附件路由为新增增量，关闭即回退；不删任何 owner 数据或审计。
