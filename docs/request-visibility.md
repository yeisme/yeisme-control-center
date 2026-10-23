# 请求信息、工作区与多租户

2026-10-21 对账：正文与 Eikona 附件的后续实现见归档 [request-content-visibility-v2](../openspec/changes/archive/2026-10-17-yeisme-request-content-visibility-v2/design.md)；当前接口边界以 [interfaces.md](interfaces.md) 为准。本轮新增任务只补 owner/任务族覆盖、Scaena/Sonora 附件合同和实际授权证据，旧 4/8 不表示需要重建已有代码。

正式客户端只使用真实模式；不存在独立 demo 入口，普通读取失败绝不切换为样例。

## 布局与交互

正式前端使用 Geist、Lucide 和统一 Workspace 令牌。主区保留可访问 h1，左栏支持收起和手机抽屉；项目、任务、资产、能力、用量与团队页面共享同一套状态组件。视觉规范以 `src/styles/`、`src/app-shell/` 和现有设计说明为准。

右侧默认详情及成员编辑420px、复杂配置560px。固定与展开操作置于更多菜单。桌面满足1280px且主区保留560px时可固定，默认480px、范围400–640px；可展开长内容；小于640px全屏。Sheet 锁背景与焦点，固定模式允许主区操作。改变范围立即销毁旧内容；断点变化保持同一对象与草稿；关闭返回原列表。

## 请求字段字典

| 分区 | 字段 | 来源/缺失规则 |
| --- | --- | --- |
| 身份 | owner、id、tenant、project、actor、actor_type | 采用可信绑定与 owner 原始引用；账号类型未知不推断 |
| 状态 | state、native_state、created_at、duration_ms | 缺失耗时 null；不根据完成状态推断耗时 |
| 关联 | parent_ref、attempts.ref、output_refs | 必须有明确证据；不拼接模拟 attempt ID |
| 输入 | input、submitted、effective | 元数据与正文分开；提交值和生效值分别显示 |
| 附件 | ref、source、upload_ref、name、mime、bytes、sha256 | source=upload/reference/generated；bytes缺失null；不显示本机路径或签名URL |
| 内容 | state、text、truncated、receipt_ref | 按需读取；未授权、不存在、过期、接口不足分别标记 |
| 来源 | coverage.owner/state/observed_at/reason | 每来源独立，不用空数组伪装成功 |

业务正文只存在当前内存工作区，不进入 localStorage、普通导出、服务端缓存或日志。HTML/SVG/Markdown不作为可信代码执行。Aigora归档只提取明确用户/助手业务文本字段，系统、tool和无法识别的载荷不透传。

## 统计口径

- 网关调用、生成任务、业务操作、尝试和产出分别统计，不相加作为总请求量。
- 去重键是 owner+原始引用；跨服务关联不自动去重为同一对象。
- 上传文件按明确 upload_ref 去重；引用资产不计上传字节。任意未知文件大小使字节指标保持未知。
- 成功率=成功/(成功+失败)，未知、运行中、取消分别展示。
- 汇总使用 owner 的全筛选集；列表采用每来源有界批次，明确显示当前批次而非冒充全局分页总数。
- 日期默认请求24h、统计7d，交互查询上限7d。长期聚合须 owner 新合同，不扫描无限历史。
- 所有缺失来源和缺失指标保持可见；不能将 null 转为0。费用按账本与币种分组。

## 多租户与权限

身份键是 issuer+subject，范围绑定由同源服务端配置；姓名/邮箱只作显示。OIDC采用独立 client、PKCE、state、nonce、RS256签名和issuer/audience/expiry检查；会话为HttpOnly/SameSite，服务端保存token，内容POST需CSRF与同源检查。每个owner仍验证其audience、actor和权限。

Scaena保留OrganizationID；Sonora/Eikona当前查询合同以owner project作为权限边界，控制中心显式映射到平台租户。不构造二者尚不存在的跨项目租户全局管理。

平台目录仅列授权范围；成员角色保留 owner 原始角色。当前没有演示模式。Control Center 自有组织、团队、共享项目 grants 与用户管理使用本地具名 action；owner 成员、邀请和配额写入仍须对应领域合同，不能由中央角色直接授予。真实读取未接通时返回缺口。

## 错误与恢复

401登录、403拒绝、404跨范围隐藏、409游标/版本失效、422筛选或内容合同不足、503来源不可用。聚合响应逐来源报告状态。未知请求只查询原对象，不触发生成、取消或重新提交。注销、范围切换与权限变化清空正文，迟到响应受epoch与AbortController双重保护。

## 当前工程边界

本地实现包括客户端、OIDC/个人会话、范围化聚合、三 owner 元数据列表/汇总、Aigora 范围核验与归档适配、按需正文及 Eikona 附件传输。Sonora/Scaena 的业务文本增量与未采集状态仍按各任务族区分，不能把某一族可读扩大为所有输入/输出/附件可读。四服务的当前实际授权读取、Scaena/Sonora 附件和组织成员委托继续逐项验收，证据边界见 [当前状态](current-status.md)。
