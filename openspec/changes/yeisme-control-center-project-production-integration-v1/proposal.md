## Why
共享项目缺少独立 Auctra 来源，制作深链不能恢复项目上下文。真实只读联调脚本存在沿用源数据库风险，Gateway fixture 与真实合同偏离，必须先确保验证安全，再交付可追溯候选。

## What Changes
- fit：控制中心拥有共享项目来源引用、访问解析、前端状态、只读聚合与审核快照。
- split-owner：Auctra/Scaena/Eikona/Gateway 业务、凭据和真实合同仍由各 owner 维护；缺合同明确阻塞。
- reject-now：不恢复 Workbench，不执行生成、取消、审阅写入，不更改 owner 部署或实际授权。
- 强制临时数据库和 observation off，领域写入口 fail closed。
- 独立 project.collection_binding.set，通过 preview/confirm、项目 revision 与审计。
- 修复项目深链、制作数据覆盖、授权缓存与 Gateway 当前合同映射。
- 同一审核快照验收、候选构建及仅控制中心发布；不自动提交或推送。

## Capabilities
### New Capabilities
- `project-production-integration`: 联调隔离、独立来源授权、制作深链与候选来源一致性。
### Modified Capabilities
无；既有接口采用向后兼容新增字段，旧项目默认为未绑定。

## Impact
限本 owner scripts/server/src/tests/docs。Drizzle 新增表，不替换栈；owner 项目只读。不运行 race。真实权限不足如实报告，不将 fixture 验收冒充真实闭环。
