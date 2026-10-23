## ADDED Requirements

### Requirement: 分层报告完成状态
控制中心交付 MUST 分开记录工程、真实读取、组织授权、付费与部署证据；任务勾选和历史通过不得代替当前验收。

#### Scenario: 本轮只交付规格
- **WHEN** 本轮方案、接口提案、任务和文档检查通过
- **THEN** 只完成对应 CONTRACT 文档任务，未来接口、代码与真实门仍保持未完成

#### Scenario: 真实来源为空
- **WHEN** Scaena 当前授权范围返回真实空任务集
- **THEN** 可以记录真实列表读取通过，但详情、媒体下载与播放保持未验证

### Requirement: 原能力和任务状态保留
后续方案 MUST 保留用户已要求能力、原完成状态、原证据与 canonical owner；新任务 MUST 通过 CLI 维护并声明单一 PHASE、scope、依赖、验证与失败重检。

#### Scenario: 一项任务同时包含本地与付费
- **WHEN** 本地工程检查通过而真实付费未执行
- **THEN** 分拆后续验收任务并保留原复合任务的未完成状态，不把 dry-run 升级为 canary

### Requirement: 历史方向显式处置
旧 v10 方向 MUST 停止实施旧 UI，并逐项映射有效行为到现行实现或后续任务，未实施项不得伪造完成。

#### Scenario: 旧设计与当前 AGENTS 冲突
- **WHEN** 历史任务要求恢复 AdminCN 或 OpenDesign 同步
- **THEN** 按当前 AGENTS 保留现行壳，并在 supersession 说明中记录原要求、替代证据和剩余缺口

### Requirement: 收尾能力不得转移领域真源
控制中心 MUST 只拥有协作记录、引用和派生投影，参考、费用、领域审阅/交付与原任务权限 MUST 留在对应 owner。

#### Scenario: owner 尚无领域写合同
- **WHEN** 审阅或交付动作没有可用 owner adapter
- **THEN** 保留能力与合同任务，显示 needs_contract，不以本地收集确认替代领域审阅通过
