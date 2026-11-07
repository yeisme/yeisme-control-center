## ADDED Requirements

### Requirement: 授权提示词库
系统 SHALL 分开提供项目范围的提示词元数据与创作者正文，并保留原内容权限。

#### Scenario: 无正文权限浏览目录
- **WHEN** 项目成员列出素材
- **THEN** 返回元数据及明确的可读状态，不返回正文和 Provider 参数

#### Scenario: 读取指定版本
- **WHEN** 获得授权的成员打开版本
- **THEN** owner 先持久记录访问审计，再返回该版本正文

### Requirement: 不可变历史与版本素材
系统 SHALL 保留任务输入，素材编辑创建版本并拒绝冲突。

#### Scenario: 重复创建
- **WHEN** 同一成员用相同原操作键与输入重复提交
- **THEN** 返回原结果，不创建第二条记录或调用 Provider

#### Scenario: 过期版本
- **WHEN** 编辑指定了过期的 expected_version
- **THEN** 拒绝更新，已有内容保持完整

#### Scenario: 保存结果未知
- **WHEN** 保存响应中断
- **THEN** 查询原操作回执，不发起新键写入

### Requirement: 历史整理与分类
系统 SHALL 支持任务历史、手工素材、基础分类、标签与项目范围的整理。

#### Scenario: 私有历史
- **WHEN** 索引已有私有内容
- **THEN** 保留原权限，其他项目成员不会因此获得正文权限

#### Scenario: 原文缺失
- **WHEN** 历史输入没有留存或不可读取
- **THEN** 保留缺口，不从日志或 Provider payload 重建原文

#### Scenario: 归档
- **WHEN** 已授权编辑者归档素材
- **THEN** 默认列表隐藏素材，正文和历史版本仍可恢复
