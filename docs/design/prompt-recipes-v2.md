# 提示词配方 v2

## 目标

提示词库负责读取 owner 的原始提示词；配方负责把可复用的创作意图整理成控制中心自己的索引。两者不能互相取代：Eikona 和 Sonora 的正文、版本和授权仍由 owner 保管，Scaena 在没有正文合同前显示 `needs_contract`。

配方页面展示标题、owner、项目、类型、标签、结构化 facets、来源引用、owner 版本、摘要 digest、当前修订和内容状态。列表查询只在当前登录 scope 内执行，分页游标绑定身份、epoch、scope 与筛选条件。

## 生命周期

- `active`：可被查看和尝试复用。
- `archived`：保留所有修订，但不再允许“填入草稿预览”。
- `blocked`：引用或内容状态不满足复用条件。
- `metadata_only`、`not_recorded`、`needs_contract`、`forbidden`、`unavailable`、`stale`、`integrity_failed` 是内容覆盖状态，不推断正文存在。

新建和修订只写 refs、digest、标签、facets、来源 lineage 和审计字段；action receipt 只保存摘要和 digest。正文只有在用户明确读取 owner 正文后进入当前页面内存，不进入 SQLite、回执、日志或测试证据。

## owner 适配矩阵

| owner | 列表/详情 | 正文读取 | 配方复用 |
| --- | --- | --- | --- |
| Eikona | 已有提示词合同 | 审计后读取，要求版本与 digest | 可填入草稿预览，不提交生成 |
| Sonora | 已有提示词合同 | 审计后读取，要求版本与 digest | 可填入草稿预览，不提交生成 |
| Scaena | 本地索引可保留引用 | 合同未发布时 `needs_contract` | 阻断并显示原因 |

## 页面流程

1. 在提示词库打开一条可读取的历史或素材正文。
2. 点击“收录为配方”，控制中心先预览再确认本地 action；仅保存 owner prompt ref、version、digest、project、tags 和 facets。
3. 配方卡片展示 provenance 与 coverage；点击卡片查看修订历史。
4. “填入草稿预览”先调用 use-preview 校验 recipe revision、owner/project binding、owner version、content state 和 source ref；通过后重新审计读取正文并填入现有草稿编辑器。
5. 草稿仍需用户另行预览/保存；配方动作不创建 Provider run，不产生费用。

## 安全边界

当前 scope 必须绑定 recipe 的 owner/project。跨 scope、跨项目、旧修订、无 owner prompt ref、无 owner version 或 digest 不一致均 fail-closed。未知或不可用结果保留原 recipe 引用并要求重新核对，不自动替换 owner、模型或正文。
