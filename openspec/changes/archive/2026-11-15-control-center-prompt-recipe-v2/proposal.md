# 提示词配方 v2

## Why

提示词库已经能够读取 owner 内容，但缺少一个只保存来源引用和结构化意图的复用层。用户需要在不复制正文、不绕过 owner 授权、不触发 Provider 操作的前提下，收集、检索、查看历史并把已核验正文填入当前草稿。

## What Changes

- 新增 `prompt_recipes` 与不可变 `prompt_recipe_revisions` 本地索引。
- 增加配方列表、详情、版本和 use-preview HTTP 合同。
- 增加 `prompts.recipe.create/revise/archive` 本地 action，使用条件更新和幂等回执。
- 提示词页增加配方卡片、来源 lineage、状态、digest、修订详情和“填入草稿预览”。
- use-preview 只在当前 scope 绑定、owner 版本和正文合同都满足时重新读取正文；不提交 Provider 操作。
- Scaena、无 owner 合同或缺失正文引用保持 `needs_contract`/`blocked`。

## Scope

本变更只属于 `client/yeisme-control-center` 的 server、shared、提示词页、数据库迁移、测试和设计/OpenSpec 文档。owner 正文、Provider、计费、部署和真实授权仍由各 owner 负责。
