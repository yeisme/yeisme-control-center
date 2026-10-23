## ADDED Requirements

### Requirement: 固定计划与费用准入
生成 MUST 固定输入摘要、owner 绑定、费用、目标目录与原幂等键，普通提交 MUST 在未知费用、币种不匹配或预算不足时阻断。

#### Scenario: 提交后断线
- **WHEN** owner 接收结果未知
- **THEN** 保留原批次与原键，重启后只查询原操作，不自动提交第二次

#### Scenario: 部分成功
- **WHEN** 原批次部分成员成功且部分成员失败
- **THEN** 保留成功成果和成员状态，按原任务关系归组

#### Scenario: 视频报价缺合同
- **WHEN** Scaena 没有已知费用的固定输入合同
- **THEN** 视频普通提交阻断，不能把费用上限或虚构换汇当报价

### Requirement: 固定参考选择与授权预览
批次输入 MUST 使用 owner 的 exact binding ref、revision、digest 和受支持 role；项目连接 binding MUST NOT 替代素材 binding，预览 MUST 使用独立短时授权。

#### Scenario: 修改已选参考
- **WHEN** 用户在取得计划后更换引用或其版本
- **THEN** 清除旧计划和动作 Preview，重新取得 owner 固定输入，不修改已提交批次的历史引用

#### Scenario: 预览授权缺失
- **WHEN** owner 未提供参考预览或缩略图合同
- **THEN** 显示 needs_contract，不请求原文件作为缩略图、不接受任意 URL 绕过授权

### Requirement: 视频报价绑定与结果可读取
视频计划 MUST 包含绑定 exact 输入、计划、模型及项目 binding 的 known quote，且 MUST 在 Confirm 再验期限、币种、权利与预算。执行成功和成果可读取 MUST 分开报告。

#### Scenario: 报价在确认前过期
- **WHEN** Confirm 时报价已过期或输入/绑定发生变化
- **THEN** 拒绝执行并要求显式重新 Preview，不换键重发未知原操作

#### Scenario: 视频成功但传输失败
- **WHEN** owner 执行成功但授权媒体下载或播放失败
- **THEN** 保留执行事实并单独标识交付未验，不宣称视频交付闭环
