## Why

当前控制中心的 14 项活动变更混合了历史界面迁移、本地实现、owner 合同等待与真实交付门，任务数字无法说明还需写什么代码。共享项目、成果浏览和生成批次已部分实现，但前端仍缺批次分页/详情、参考绑定选择与视频已知费用合同，旧接口文档还把现行服务描述为未实现。

用户本轮选择先交付方案、接口设计、Spec 任务和文档。需要补齐后续实现路径，保留原始验收和能力要求，而非批量勾选或恢复旧 AdminCN/OpenDesign 页面。

## What Changes

- 建立当前代码→原变更→缺口→验收层的完成方案和能力归属表。
- 设计前端需要的批次分页/detail、参考 binding 目录/access、Scaena 固定输入/已知报价增量；已实现与拟议接口明确分开。
- 为原有未完成变更补充单阶段任务，既有代码、完成状态和历史证据不被重写。
- 新增公共分页与收尾治理任务；专业功能继续在原变更执行，避免双重任务真源。
- 修正文档入口、过时的 Auctra authoring 说明与当前页面数量，记录 supersession 和归档条件。

## Capabilities

### New Capabilities
- `control-center-completion`: 分层完成、能力保留、历史变更处置和本轮文档验收。
- `frontend-api-completion`: 批次分页/detail 与共享 DTO、参考 binding、视频 quote 的增量合同要求。

### Modified Capabilities

本轮不修改主规格或运行合同；后续实现将按任务先冻结共享 TypeScript 合同，再更新消费者、服务端和主规格。

## Impact

`fit`：Control Center 的分页、投影、协作和文档；`split-owner`：参考、报价、请求内容、收集与交接分别由 Eikona/Scaena/Sonora/Aigora/Auctra 的公开合同支持；`reject-now`：客户端接管领域任务、秘密或媒体真源。

本轮写入仅在本项目 `docs/**` 与 `openspec/**`，任务通过根仓既有 `scripts/openspec-tasks.py` 维护。没有业务代码修改、实际迁移、Provider 调用、真实授权变更、发布或部署；相关能力与后续任务完整保留。
