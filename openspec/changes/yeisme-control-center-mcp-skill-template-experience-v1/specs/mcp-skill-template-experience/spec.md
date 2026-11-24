## ADDED Requirements

### Requirement: MCP 连接状态分离
系统 SHALL 分别展示 transport、protocol、discovery 和 invocation 状态，不得把工具发现成功写成调用成功或领域任务成功。

#### Scenario: tools/list 成功但未验证调用
- **WHEN** Gateway initialize 与 tools/list 成功且尚未执行只读 validate
- **THEN** 状态为 discovery_ready，并提示调用尚未验证

### Requirement: Skill 与模板安全投影
系统 SHALL 只接受 body-free 的 Skill/模板 metadata，并拒绝命令、凭据、路径、任意 URL、正文和 Provider payload。

#### Scenario: manifest 含可执行字段
- **WHEN** 远程 manifest 返回 command、script、body 或 credential 字段
- **THEN** 归一化失败且不保存、不执行该内容

### Requirement: 推荐后固定版本
系统 SHALL 在资产生产前推荐匹配的 Skill 与模板，并在用户确认前保持未固定；确认后绑定 ref、version、revision 和 digest。

#### Scenario: 已固定模板出现更新
- **WHEN** 源检查发现新 digest
- **THEN** 原选择保持有效，新版本只作为 update_available 并要求重新 preview/confirm

### Requirement: owner 合同缺失时 fail closed
系统 SHALL 在模板 Registry、Skill 源或 owner validate 合同不可用时返回 needs_contract，不得使用本地示例冒充可执行模板。

#### Scenario: Registry 路由未发布
- **WHEN** 模板目录读取没有已批准 owner contract
- **THEN** UI 显示 needs_contract 与下一步，且不触发 Provider 或远程代码
