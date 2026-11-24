## ADDED Requirements

### Requirement: 区分接口提案和已实现合同
文档 MUST 标明拟议接口；实现 MUST 先冻结现有共享 TypeScript 类型，再由 server、typed client、fixture 与页面复用。

#### Scenario: owner 尚未发布报价
- **WHEN** 文档存在拟议 Scaena quote 字段但 owner 未冻结对应合同
- **THEN** 普通视频提交继续阻断，不能把文档字段作为运行能力

### Requirement: 批次分页与直接定位
批次列表 MUST 提供有界服务端筛选、稳定排序和签名分页；detail MUST 能直接定位当前授权项目的原批次，旧 rows 消费者保持兼容。

#### Scenario: 非首页批次深链
- **WHEN** 用户刷新指向非首页批次的链接
- **THEN** 直接读取该批次详情并保留筛选，无需先全量读取所有批次

#### Scenario: 跨范围重用游标
- **WHEN** cursor 的主体、组织/项目、权限 revision、epoch 或筛选与当前请求不同
- **THEN** 服务端拒绝该 cursor，前端清除旧 cursor 后查询当前范围，旧响应不能写回

#### Scenario: 来源局部失效
- **WHEN** 某个 owner 超时而当前项目存在本地批次
- **THEN** 有界返回授权本地结果和 partial/unknown 覆盖及实际观察时间，不把缺失来源当零或发起新提交

### Requirement: 素材参考不可变且按需授权
参考选择 MUST 使用 owner exact binding ref/revision/digest；目录、预览和输入使用 MUST 分别验证授权，且不得接受任意 URL、本机路径或可变别名作为固定输入。

#### Scenario: 选中但未预览
- **WHEN** 用户只选中一条参考记录
- **THEN** 只保存引用和摘要，不读取完整媒体；显式预览才申请对应短期授权

#### Scenario: 计划后引用被撤权
- **WHEN** Confirm 前 owner 判定绑定不再可用
- **THEN** 拒绝执行并保留旧计划和绑定历史，要求用户明确选择替代版本

### Requirement: 视频计划依赖已知报价与原操作恢复
视频提交 MUST 使用 owner 固定输入/计划及已知同币种且未过期的报价，绑定原幂等键；unknown MUST 仅查询原操作，媒体交付成功 MUST 有可读取验证。

#### Scenario: 报价仅为最大预算
- **WHEN** owner 只返回费用上限或要求接受未知费用
- **THEN** 普通提交被阻断，不构造 estimated cost、不隐式换汇

#### Scenario: 提交回包丢失并重启
- **WHEN** 原操作接收结果未知且控制中心重启
- **THEN** 恢复原批次、reservation、原键和 owner 引用，仅对账，不生成替代提交

#### Scenario: Provider 成功但媒体不可读
- **WHEN** Provider 报告成功但成果授权、下载或播放失败
- **THEN** 分别展示执行与交付状态，不宣称用户视频已成功交付
