## ADDED Requirements

### Requirement: Same-origin scoped read model

控制中心 SHALL 通过同源 API 读取固定 owner allowlist 的只读投影；浏览器不得直接访问 owner URL、携带 owner credential 或自报 scope/actor。

#### Scenario: 客户端伪造范围

- **WHEN** 浏览器传入未出现在 session 中的 `scope` 或 actor
- **THEN** server 返回 `scope_not_found`/`forbidden`，不向任何 owner 发起读取

### Requirement: Contract-stable task and request views

任务和请求 SHALL 保留 owner 原始引用、native state、阶段、覆盖度、观察时间和明确的缺失状态；列表分页不能替代全范围汇总。

#### Scenario: 第一页不是全量

- **WHEN** 请求列表只返回当前来源第一页，但 summary 覆盖完整筛选范围
- **THEN** 页面分别标示当前批次与汇总覆盖，不能用第一页数量显示为全量

### Requirement: Epoch-safe frontend state

前端 SHALL 在注销、scope/identity/permission 改变时清空旧详情和正文，并拒绝旧 epoch 的迟到响应。

#### Scenario: 快速切换项目

- **WHEN** 用户在项目 A 详情加载期间切换到项目 B
- **THEN** A 的响应不得渲染到 B，详情回到 loading/empty 状态并按 B 重新读取

### Requirement: Independent content authorization

正文、附件、预览和下载 SHALL 走独立授权、用途和 CSRF 保护；没有 owner 合同或审计结果时显示原因并保持不可用。

#### Scenario: 内容权限被撤回

- **WHEN** owner 返回 `forbidden` 或 `content_not_authorized`
- **THEN** 前端隐藏正文/媒体句柄，保留任务或请求元数据，不重新生成、不重试、不伪造成功

### Requirement: Degraded source truthfulness

当一个来源失败、超时或合同缺失时，系统 SHALL 保留其他授权来源并显示失败来源的状态、观察时间和恢复提示；不得通过 fixture、零值或空成功列表静默回退。

#### Scenario: Scaena unavailable

- **WHEN** Scaena 超时而其他 owner 可读
- **THEN** 其他 owner 正常显示，Scaena 显示 `unavailable`，整体 coverage 为 partial/unavailable
