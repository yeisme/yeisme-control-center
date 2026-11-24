# Yeisme Control Center 文档

- [当前实现状态](current-status.md)
- [控制中心完成方案：原变更对账、代码工作包与验收](completion-roadmap.md)
- [前端接口补齐：已实现路由与拟议增量](frontend-api-completion.md)
- [Yeisme Studio v21：列表与查询、全站搜索、网页账号管理、设置与快捷键、大图、右侧面板与动效](design/studio-v21.md)
- [个人 MCP 网关受控管理与跨项目 Agent 监控](mcp-gateway-and-agent-monitoring.md)
- [Yeisme Studio v20：创作台与「图片资产 → 视频漫剧」人机制作线](design/studio-v20.md)
- [C 端体验改造方案 v19：从控制台到创作台](design/c-end-experience-v1.md)
- [公共接口与收尾 OpenSpec](../openspec/changes/yeisme-control-center-completion-v1/design.md)
- [共享项目、成果浏览与固定生成批次](shared-projects-media-browser.md)
- [内网运行与 HTTPS 部署边界](lan-deployment.md)
- [真实读取接入](live-read-integration.md)
- [Provider live 门禁](provider-live.md)
- [糯米技能工作流运营投影](nuomi-skillpack-operations-projection.md)
- [接口与 owner 边界](interfaces.md)
- [剧本到分镜控制中心接入](creative-flow-integration.md)
- [creative-flow owner integration v2](../openspec/changes/creative-flow-owner-integration-v2/README.md)
- [工作队列与跨项目交接 OpenSpec](../openspec/changes/yeisme-control-center-attention-handoff-v1/README.md)
- [前后端合同与阶段任务（已归档）](../openspec/changes/archive/2026-10-17-yeisme-control-center-frontend-backend-v1/design.md)

Yeisme Control Center 是唯一正式前端产品。默认真实只读，读取失败不会静默回退到样例，owner 未提供的字段保持未知。

任务的 owner `state`、`native_state`、revision 和结果保持原样。控制中心另外计算本地新鲜度：活动任务超过 15 分钟没有 owner 更新时间显示 `stale`，超过 2 小时显示 `expired`；缺少时间或本次 owner 读取失败显示 `unknown`。这些字段不会改写 owner 状态，不会自动重试、取消或删除任务。通知中的任务引用使用同一枚签名 `task_key`，点击后进入 `/tasks?task=<签名任务键>`；任务不在首批观察页时，任务页会按原键读取并打开 Inspector。

指南里的控制中心 API 示例先在当前 shell 注入 `YEISME_CONTROL_ORIGIN`，后续命令使用 `"$YEISME_CONTROL_ORIGIN/api/control-center/v1/..."`。公开指南不编译真实地址、凭据或 token。
