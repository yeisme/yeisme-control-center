# 实施任务

- [x] 1.1 定义 `src/shared/tool-catalog.ts` 共享合同类型。
- [x] 1.2 实现服务端归一化：schema 摘要与 digest、注解、风险、模型 status、渠道、能力合同推导。
- [x] 1.3 重构 MCP 适配器：分页 `tools/list`、服务信息、调用白名单、401/403 映射为 `forbidden`；删除不存在的 `creative-input/contract` 读取。
- [x] 1.4 实现按 owner 缓存、并发去重、强制刷新限频和 stale 回退；`/capabilities` 共用同一次发现。
- [x] 1.5 新增变化账本表与迁移 `0004`，实现首次读取只建基线和完整读取才记移除。
- [x] 1.6 新增 `GET /tool-catalog` 路由与 typed client，旧服务端返回的路由缺失可识别。
- [x] 2.1 fixture owner 按 URI 返回真实形状的发现文档，`tools/list` 分页，并提供目录修订开关。
- [x] 2.2 重做“模型与工具”页面、Inspector、字段表、AI 创作深链和命令面板目录搜索。
- [x] 3.1 单元测试：归一化、变化账本、发现与路由、视图函数。
- [x] 3.2 合同集成：目录投影、无秘密、变化记录、强制刷新限频、POST 返回 405。
- [x] 3.3 浏览器旅程：五个页签、历史模型默认隐藏、Inspector 不提供调用按钮、预检深链、变化出现。
- [x] 3.4 真实只读复验 `/tool-catalog`，记录覆盖状态和计数，不调用 Provider（Eikona 已部署版本缺少模型/渠道资源，记为 partial）。

## 验证命令

```bash
cd client/yeisme-control-center
bun run typecheck
bun run test
bun run test:contract-integration
bun run test:browser-journey
bun run test:owner-live-read
```
