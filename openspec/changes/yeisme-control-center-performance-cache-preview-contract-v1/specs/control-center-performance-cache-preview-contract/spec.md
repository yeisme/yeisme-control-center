# 控制中心性能、缓存与媒体预览合同

> 本规格是 T0 的收敛目标，不是当前 owner 已发布合同。除现有控制中心本地行为外，所有 owner 正向字段、端点、权限和错误码都必须在对应 owner handoff 后确认；未确认时按 `needs_contract` 处理。

## ADDED Requirements

### Requirement: 能力归属与 canonical owner 必须可追溯

控制中心 SHALL 为性能、缓存、媒体预览和合同适配维护能力 ledger。每项 SHALL 标记归属（`fit`、`split-owner`、`blocked` 或 `reject-now`）、canonical owner、当前证据、合同缺口和下一步。Control Center SHALL NOT 把 owner 的任务、原始媒体、权利、费用或内容 revision 声明为本地真源。

#### Scenario: owner 合同尚未发布

- **WHEN** 目录、grant、revision/digest、撤权或权限语义没有经对应 owner 发布/批准的只读合同
- **THEN** 控制中心记录具名 owner 和下一步，状态为 `needs_contract` 或 `blocked_dependency`，不猜测 endpoint、字段、默认权限或成功结果

#### Scenario: 本地 fixture 通过

- **WHEN** fake/local owner 只验证了状态映射、缓存失效或拒绝路径
- **THEN** 只能标记本地合同测试通过，不得将其升级为真实 owner 合同或生产能力

### Requirement: 读模型缓存 SHALL 隔离主体、会话和本地生命周期

控制中心 SHALL 将 `scope_id`、session epoch 和本地 generation 作为读模型缓存的身份边界；业务 key SHALL 在该边界内使用。scope 改变、登出、会话替换、epoch 增长或 generation 替换后，旧条目 SHALL 不得作为新身份的当前数据返回。

#### Scenario: 切换 scope 后命中旧条目

- **WHEN** 用户从 scope A 切换到 scope B，且两者使用相同业务 key
- **THEN** scope A 的条目 SHALL miss 或被清理，不能显示为 scope B 的读结果

#### Scenario: 迟到响应属于旧 generation

- **WHEN** 旧读请求在 logout、epoch 变化或 refresh 后才返回
- **THEN** 该响应 SHALL 被丢弃，不得写入当前缓存或覆盖当前页面

#### Scenario: 读模型处于 stale

- **WHEN** fresh TTL 已过但 stale 窗口仍可展示
- **THEN** 页面 SHALL 保留可识别的 stale/coverage 语义并安排受控重新读取，不得把 stale 当作 owner 最新事实或静默改写 owner 状态

### Requirement: 媒体缓存 SHALL 只保留当前会话内的受控派生物

媒体缓存 SHALL 只保存已授权的 Blob/Object URL 及其最小元数据（MIME、大小、过期时间和本地 identity），不得持久化密码、访问 Key、owner token、原始 owner URL、原始正文或未授权媒体。条目到期、登出、范围/epoch/generation 变化或撤权后 SHALL 清理并 revoke 对应 Object URL。

#### Scenario: grant 已过期

- **WHEN** 媒体条目的短时授权已到期
- **THEN** 缓存 SHALL miss 并清理 Object URL；页面只能在新的明确 preview 意图下重新请求授权，不能继续播放旧句柄

#### Scenario: 旧下载完成

- **WHEN** 下载开始后 scope 或 session epoch 发生变化，旧下载随后返回
- **THEN** 返回值 SHALL 被丢弃，不得加入新 identity 的媒体缓存

#### Scenario: 达到缓存上限

- **WHEN** 媒体条目数量或字节数超过本地上限
- **THEN** SHALL 按已记录的淘汰规则释放条目和 Object URL，不得把上限突破转化为持久化或完整原图 fallback

### Requirement: 媒体预览 SHALL 由明确意图触发并经过安全边界

列表、搜索、排序、hover、后台轮询或缓存预热 SHALL NOT 自动触发媒体 owner 读取。只有用户明确发起 preview/download 后，控制中心才可请求受控 grant；请求 SHALL 绑定当前身份、对象引用和适用的 purpose/revision/digest 条件。浏览器 SHALL NOT 获得 owner 原始 URL、grant token 或秘密。

#### Scenario: 用户只打开任务列表

- **WHEN** 页面仅读取任务/结果列表且用户没有点击 preview/download
- **THEN** 控制中心 SHALL 只展示 owner 已提供的安全摘要或缩略图状态，不请求新的媒体授权，不触发 Provider

#### Scenario: 授权后使用同源代理

- **WHEN** 明确 preview 意图通过当前会话和权限校验
- **THEN** 媒体 SHALL 通过控制中心受控句柄/同源代理传输，服务端 SHALL 保持 `no-store`、过期重验和审计边界；Range 与 Blob 回退不得绕过这些检查

#### Scenario: 原始媒体不可用

- **WHEN** owner 返回 forbidden、expired、unavailable 或合同缺口
- **THEN** 页面 SHALL 显示对应可解释状态，不得以 owner 原始 URL、完整原图或演示媒体替代

### Requirement: 合同适配 SHALL 版本化、状态保真并 fail closed

Control Center 的 projection/adapter SHALL 使用可识别的版本；允许 additive 安全字段，但不得删除或重命名既有安全字段、改变 owner `state`/`native_state` 语义，或从更新时间、文件存在或 URL 推导 revision、digest、权利或成功。缺少必需字段、类型不符、未知权限状态或合同未登记时 SHALL 返回 `needs_contract`，不保存该不可信结果、不执行写动作。

#### Scenario: owner 返回已知状态但缺少 revision

- **WHEN** 当前 adapter 要求 revision 才能安全确认对象一致性，而 owner 响应未提供
- **THEN** 该对象 SHALL 保持 `needs_contract`/`unknown`，不得将更新时间或 URL 当作 revision

#### Scenario: owner 返回新增可忽略元数据

- **WHEN** owner 在已批准版本中增加不影响旧语义的元数据
- **THEN** 旧客户端 SHALL 继续按已有字段工作，新客户端可在 adapter 明确支持后消费；不应因可忽略字段缺失而伪造内容

#### Scenario: revision 或 digest 不一致

- **WHEN** expected revision/digest 与 owner 返回值不一致
- **THEN** 控制中心 SHALL 丢弃当前预览/读结果或标记冲突并要求重新读取，不得显示为当前授权内容

### Requirement: 性能目标 SHALL 可测、脱敏且不伪造 owner SLA

控制中心 SHALL 只对本地可控制边界建立性能基线，包括缓存命中/未命中、在途去重、授权等待、代理首字节、传输字节和合同阻断；指标 SHALL 不包含正文、Cookie、token、原始媒体、owner URL 或秘密。未经过对应 owner 合同和只读验证，控制中心 SHALL NOT 宣称 owner 延迟、吞吐或可用性目标。

#### Scenario: owner 暂时不可用

- **WHEN** 本地请求等待或 owner 来源不可用
- **THEN** 控制中心 SHALL 保留 `unavailable`/`stale`/`needs_contract` 的事实和脱敏指标，不通过演示数据补齐性能结果

### Requirement: 新路径 SHALL 可回滚且不改变 owner 数据

未来实现 SHALL 提供关闭新 cache/preview adapter 的 feature gate 或等价路径。回滚 SHALL 只清理新 generation/schema 标识的内存条目和 Object URL，并回到既有安全只读路径；不得删除 owner 数据、改变权限、撤销凭据或重放未知操作。本 T0 SHALL NOT 引入数据库迁移或持久化媒体缓存。

#### Scenario: 新 adapter 发现合同回归

- **WHEN** owner 合同版本失效、digest 不一致或撤权语义无法验证
- **THEN** 新 adapter SHALL 被禁用或返回 `needs_contract`，旧安全读取仍遵守 no-store/授权重验，且不对 owner 发起未知写操作

#### Scenario: T0 文档校验通过

- **WHEN** proposal、design、tasks 和 spec 通过 OpenSpec strict 校验
- **THEN** 只能关闭本轮文档合同任务；代码实现、owner 合同、真实读取、性能验收、部署和 Provider 能力 SHALL 保持未完成
