# Yeisme 控制中心前后端合同驱动实施

## Why

当前控制中心已经具备 v18.1 live workspace、个人会话、服务/能力/用量读取、请求可见性和任务观测的局部实现，但前端 `src/` 与同源 `server/` 的下一阶段任务仍散落在多个旧变更中。缺少一份按合同、后端、前端、联调分阶段的可执行清单，会让局部测试通过被误读为真实四服务闭环完成。

本变更把控制中心当前需求收敛成一份实现级 spec：先冻结读取合同，再分别完成 server 聚合层和 React 消费层，最后用隔离 fake owner 与真实只读 owner 做最小联调。

## What Changes

- 固定 session/scope、服务连接、能力、用量、任务、请求、内容访问和错误覆盖度的消费合同。
- 为 `server/` 规定固定 owner allowlist、范围复核、游标绑定、CSRF、短期媒体句柄和审计先行的后端行为。
- 为 `src/` 规定统一的 loading/empty/stale/forbidden/unavailable/unknown 状态、scope epoch、迟到响应丢弃和响应式详情工作区行为。
- 增加合同样例、server 测试、前端状态测试、浏览器关键路径和真实 owner 只读证据任务。

## 不做什么

- 不新增 Provider live submit、自动重试、未知任务重投或账本写入。
- 不访问 owner 私有数据库，不复制 owner 状态，不把浏览器变成 owner API 客户端。
- 不用 fixture、fake MCP、健康检查或源码构建替代真实 owner 授权和业务读取。
- 不在本变更中部署、改 DNS/IdP/凭据、创建远程仓库、推送或调用付费 Provider。

## Owned paths

| 阶段 | 允许修改 |
|---|---|
| `CONTRACT` | `openspec/changes/yeisme-control-center-frontend-backend-v1/`、`src/shared/types.ts`、`src/shared/api/control-center-client.ts` 的合同部分、合同样例与验证脚本 |
| `BACKEND` | `server/`、后端测试、后端验证脚本 |
| `FRONTEND` | `src/` 页面、状态组件、数据 hooks、前端测试和浏览器脚本 |
| `INTEGRATION` | `temp/integration-test-runs/` 证据、必要的 `docs/current-status.md` 和本变更验证记录 |

阶段之间以冻结合同为唯一共享输入；不共享未提交的可变生成物。
