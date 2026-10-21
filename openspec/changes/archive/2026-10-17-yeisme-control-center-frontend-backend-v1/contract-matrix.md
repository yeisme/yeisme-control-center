# 控制中心读取合同矩阵（C1 冻结基线）

本文件冻结 `yeisme-control-center-frontend-backend-v1` 的路由、字段、错误与新增 epoch/审计合同。前端与后端以本矩阵为唯一共享输入；新增字段必须向后兼容（可选增量）。

## 通用信封

- 所有 JSON 响应 `Cache-Control: no-store`。
- 错误响应：`{ "error": "<machine_code>", "class": "<error_class>" }`。
- 错误类映射：401→`login_required`、403→`forbidden`、404→`not_found`、409→`conflict`、400/405/413/422→`invalid`、429→`rate_limited`、410→`expired`、其余 5xx→`unavailable`。
- scope 绑定的 GET 列表/详情响应追加顶层 `epoch`（整数，会话级，见下）。
- 所有 scope 读取必须携带 `?scope=<scope_id>`；scope 只来自服务端 session，伪造返回 `scope_not_found`(404/forbidden)。

## Session 与 epoch

| 路由 | 方法 | 关键字段 | 备注 |
|---|---|---|---|
| `/auth/methods` | GET | personal, username_required, key_required, oidc, mode, owners[] | 无需登录 |
| `/auth/personal` | POST | `{password\|key, username?}` → `{ok}` | 限速、同源校验 |
| `/auth/login` `/auth/callback` | GET | OIDC 跳转 | PKCE + nonce |
| `/auth/logout` | POST | `{ok}` | CSRF |
| `/session` | GET | name, username, role, identity, **epoch**, csrf, scopes[], mode, task_connections | epoch 登录=1，权限配置变化+1 |
| `/admin/personal-users` | GET/POST | users[] / 创建用户 | 仅 admin，CSRF |
| `/admin/personal-users/{u}/revoke` | POST | `{ok}` | 仅 admin，CSRF，审计 |
| `/audit` | GET | rows[]（脱敏审计），before/limit 分页 | 仅 admin |

epoch 语义：注销/权限变化/身份变化后旧 `epoch` 的响应必须被前端丢弃；请求列表 cursor 指纹绑定 epoch，epoch 变化后旧 cursor 返回 409。

## 服务与能力

| 路由 | 方法 | 关键字段 | 验收 |
|---|---|---|---|
| `/services` | GET | services[]（configuration, connections[], **observed_at, coverage**） | freshness 传播；部分失败不掩盖其他来源 |
| `/connections` | GET | connections[]（runtime: transport/authorization/contract/content 分列） | 仅 personal 会话 |
| `/capabilities` | GET | capabilities[]（state, readiness, submit_gate, bindings, diagnostic, observed_at） | readiness/submit gate/cost 未知保持未知 |
| `/usage` | GET | rows[], budget{total,reserved,remaining,per_owner}, coverage | 预算=非终态运行预留和；coverage 如实 partial |

## 任务与媒体

| 路由 | 方法 | 关键字段 | 验收 |
|---|---|---|---|
| `/tasks?mode=active\|history` | GET | rows[], connections[], next_cursors{}, epoch | active 不被历史窗过滤；cursor 签名绑定 scope+mode+epoch |
| `/tasks/resolve` | GET | TaskSnapshot | 四元组定位 |
| `/tasks/{key}` | GET | TaskSnapshot（locator, revision, results, allowed_actions, coverage） | revision 保留 |
| `/tasks/{key}/events` | GET | events[], next_cursor, gap | 事件缺口如实 gap |
| `/tasks/{key}/artifacts/{ref}/access` | POST | `{purpose}` → `{url, mime, expires_at}` | CSRF；审计先行；短期句柄；无永久 URL |
| `/media/{handle}?scope=` | GET/HEAD | 字节流 | 每次传输再授权；审计先行；mime/大小/Range 白名单 |
| `/tasks/{key}/cancel` | POST | `{confirm, expected_revision, idempotency_key}` | 仅 admin；审计；revision/idempotency 冲突 409 |
| `/tasks/{key}/cancel-receipt` | GET | receipt | 幂等回执查询 |

## 请求与内容

| 路由 | 方法 | 关键字段 | 验收 |
|---|---|---|---|
| `/requests` | GET | rows[], coverage[], page_scope, next_cursor, epoch | 列表与 summary 分离；分页不替代汇总 |
| `/requests/summary` | GET | sources[]（summary 含 coverage[]），complete | owner coverage 独立 |
| `/requests/{owner}/{id}` | GET | RequestProjection | owner 原始引用、native_state、覆盖度、缺失=null |
| `/requests/{owner}/{id}/content:read` | POST | `{direction, purpose}` → ContentRead | CSRF；**审计先行，审计失败不读取** |
| `/organization` | GET | tenant, sources[]（members） | 只显示 owner 提供的成员/角色 |

## Provider 运行（既有能力，不做新增 submit gate 变更）

| 路由 | 方法 | 关键字段 | 验收 |
|---|---|---|---|
| `/provider-runs` | POST | ProviderRunRequest → 202 run | 审计；幂等键；预算预留 |
| `/provider-runs/{ref}` | GET | run 投影 | scope 绑定 |
| `/provider-runs/{ref}/events` | GET | SSE | 终态自动关闭 |
| `/provider-runs/{ref}/reconcile` | POST | run | 审计；不自动重投 |

## 覆盖度状态（Coverage.state）

`complete | partial | pending | unknown | not_recorded | forbidden | unavailable | expired | integrity_failed | needs_contract`

缺失的进度、大小、耗时、金额和正文一律 `null`，不得从终态或空数组推断。

## 审计动作（audit_events.action）

`auth.login | auth.logout | admin.user_created | admin.user_revoked | requests.content_read | tasks.artifact_access | media.read | tasks.cancel | provider_runs.create | provider_runs.reconcile`

严格路径（审计写失败 → 503 `audit_unavailable`，不发起 owner 读取）：content:read、artifact access、media.read、cancel、provider create/reconcile、admin 用户写操作。尽力路径：auth.login/auth.logout。

## 合同样例

`tests/fixtures/contract/*.json` 提供成功、部分来源失败、403、409、503 与未知值样例；`tests/contract/contract-samples.test.ts` 用服务端解析器校验样例形状，前端网络层 mock 复用同一批 fixtures。
