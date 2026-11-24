# 漫剧模板只读消费者规格

## ADDED Requirements

### Requirement: 控制中心只消费公共 body-free 模板目录投影

控制中心 MUST 只通过 owner 公开的只读合同消费模板目录 projection，不得读取模板正文、prompt、artifact bytes、`.template-registry`、Scaena DB 或 Provider payload。每个 projection MUST 原样携带 `template_ref`、`schema`、`version`、`revision`、`digest`、`snapshot`、`maturity`、`compatibility`、`rights`、`status`、`stale`、`blockers` 和 `next_action`；缺失的 owner 字段 MUST 保持未知或 `needs_contract`，不得由客户端推导。

#### Scenario: 目录项目只包含安全元数据

- **Given** 公共目录返回一个可消费模板项目
- **When** 控制中心读取并投影它
- **Then** 响应只有引用、版本化元数据、兼容性、权利和诊断字段，不包含正文、prompt 或 artifact bytes
- **And** 页面可以展示或复制 owner ref/只读 plan，但不保存正文或 owner 状态

#### Scenario: owner 合同字段不足

- **Given** owner 没有发布 maturity、rights、digest 或 snapshot 的稳定字段
- **When** 控制中心消费目录
- **Then** 该项目显示 `needs_contract` 或未知状态
- **And** 控制中心不复制 registry/profile/cache/search/resolve/validator/digest/stale/TTL/preview renderer 实现

### Requirement: 首批做剧 template cells 必须逐项固定 maturity

控制中心 MUST 展示首批三个 cell，并为每个 cell 固定唯一 maturity：`drama-30-60s-experiment` 为 `exploratory`；`drama-single-scene-conflict` 与 `drama-character-consistency-demo` 均为 `needs_contract`，除非 owner 公共合同已提供可证明的 body-free maturity projection。`needs_contract` cell 不得实现、展示为可用、复制可执行 plan 或被标记为 `preview`、`candidate`、`canonical` 或 `production`。

#### Scenario: 展示三个实验 cell

- **Given** 公共目录返回首批 cell 的安全 ref 和元数据
- **When** 用户打开做剧实验页面
- **Then** 页面显示三个 cell 的 ref、schema/version/revision/digest/snapshot、maturity、compatibility、rights、status/stale、blockers 和 next_action
- **And** 30–60 秒漫剧实验唯一显示 `exploratory`，且仅允许 preview/plan；另外两个 cell 唯一显示 `needs_contract`，不得显示为可用

#### Scenario: cell 未被 owner 发布或缺少可证明 projection

- **Given** 公共目录没有返回某个首批 cell，或没有返回该 cell 的稳定 body-free maturity
- **When** 用户打开做剧实验页面
- **Then** 页面显示 `needs_contract`（或 owner 明确的 unavailable/forbidden 诊断）
- **And** 控制中心不得内置正文、伪造目录项、补推 maturity 或自动换用另一个模板

### Requirement: slot override 必须有限且 fail-closed

控制中心 MUST 仅接受 owner projection 声明的有限 slot override，并绑定单一 `template_ref`、schema、revision、digest 和 snapshot。未知 slot、未声明值类型、任意 selector 拼接和失配 MUST fail closed。`needs_contract` cell 不得接受 override 或形成 plan。控制中心 MUST NOT 进行 cell、角色、版本或 Provider binding 的笛卡尔组合。

#### Scenario: 合法有限 override

- **Given** owner 明确声明一个 cell 的有限 slot、类型、数量和长度
- **When** 用户提供符合声明的 override
- **Then** 控制中心只在内存中形成待复制的只读 plan
- **And** 不保存 override，不读取正文，不触发 Provider 或 durable write

#### Scenario: 未知 slot 或多 cell 组合

- **Given** 用户提交未知 slot、任意 selector 或多个 cell 的组合
- **When** 控制中心准备 plan
- **Then** 请求被拒绝并显示 blocker/next_action
- **And** 不自动换版本、不重试正文读取、不生成笛卡尔组合

### Requirement: 只读消费必须没有 Provider 和持久化副作用

目录 list、inspect、resolve、validate、preview 的 Control Center 消费 MUST 保持 `provider_calls=0` 和 `durable_writes=0`，不得触发付费、生成、accept、export 或 publish。Control Center 只展示和复制安全 refs/plan，不保存正文、prompt、artifact bytes 或 owner 状态。

#### Scenario: 复制只读 plan

- **Given** 一个 status 可用且 rights/compatibility 合格的实验 cell
- **When** 用户复制 ref 或只读 plan
- **Then** 复制内容仅包含 owner ref 和版本化元数据
- **And** provider_calls 为 0、durable_writes 为 0，未产生付费、生成、accept、export 或 publish

### Requirement: owner 不可用时必须安全降级

控制中心 MUST 分别安全处理 registry unavailable、permission denied、stale、cursor conflict、schema mismatch 和 body forbidden。失败结果 MUST 保留安全诊断和 `next_action`，不得伪装为空目录、可用、最新或 production-ready；body forbidden MUST 不通过客户端重试正文读取绕过。

#### Scenario: registry unavailable 或 permission denied

- **Given** registry 返回 unavailable 或 permission denied
- **When** 控制中心读取目录
- **Then** 页面显示 unavailable 或 forbidden 及安全 next_action
- **And** 不泄露私有目录细节，不调用备用私有路径，不写入本地 owner 状态

#### Scenario: stale 或 cursor conflict

- **Given** owner 返回 stale 或 cursor conflict
- **When** 控制中心投影目录页
- **Then** 页面显示 stale 或 blocked，并保留 snapshot/revision/digest（若 owner 提供）
- **And** 不静默回到第一页、不丢弃冲突、不把旧结果标记为最新

#### Scenario: schema mismatch 或 body forbidden

- **Given** owner 返回 schema mismatch 或 body forbidden
- **When** 用户查看 cell 或复制 ref
- **Then** 页面阻止可执行 plan，并显示兼容性/正文禁止原因
- **And** 仍可在 owner 允许时复制安全 ref/元数据，不读取正文或 bytes

### Requirement: Control Center 沿用既有只读 API 适配路径

控制中心 MUST 复用既有同源 API client 的 prefix、GET read pattern、scope/epoch/error mapping 和现有 adapter；若必须扩展路由，MUST 先由 owner contract 任务确认扩展点，不得发明第二套 endpoint 或直接连接 Registry、Promptrepo cache、Scaena DB。

#### Scenario: 既有 adapter 可承载 projection

- **Given** 当前 Control Center 已有可以承载公开目录 projection 的 read adapter
- **When** 实施本 change 的 adapter 任务
- **Then** 只增加 typed DTO/read-model 与页面投影
- **And** 不新增平行 endpoint、缓存实现或 owner 状态存储

#### Scenario: 既有 adapter 不足

- **Given** 当前 API 适配路径无法表示 cursor、snapshot、digest 或安全错误
- **When** 进入实现前的 contract review
- **Then** 任务记录需要的最小 owner-approved 扩展点和 blocker
- **And** 本项目不通过猜测 URL 或复制 owner 逻辑推进实现
