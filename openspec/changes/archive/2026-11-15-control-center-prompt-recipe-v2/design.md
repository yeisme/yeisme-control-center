# 设计

## 数据模型

`prompt_recipes` 保存 scope、owner、project、title、kind、tags、notes、source JSON、facets JSON、state、revision、content_state 和审计时间；`prompt_recipe_revisions` 保存每次修订的同一组元数据。没有正文列。

`source` 只接受 `source_kind`、`owner_prompt_ref`、`owner_version`、`source_digest`、`task_ref`、`request_ref`、`batch_ref`、`asset_refs`。facets 采用 `yeisme.prompt_recipe_facets.v1`，字段来源显式标为 `owner`、`user` 或 `derived`。

## API

- `GET /prompt-recipes`：scope 绑定的过滤、收藏夹过滤和签名游标分页，返回 `yeisme.prompt_recipe.page.v1`。
- `GET /prompt-recipes/:recipe_ref`：当前修订详情。
- `GET /prompt-recipes/:recipe_ref/versions`：不可变修订索引。
- `POST /prompt-recipes/:recipe_ref/use-preview`：只接受 `target_owner`、`target_project_ref`、`expected_revision`；返回 owner ref、version、digest 和 blocker。

列表和详情都经 session scope 检查。写 action 在 preview 和 confirm 两次检查 owner/project binding；revision/archive 的条件更新结果为零时返回 conflict，archive 同时写终态 revision。

## 页面

提示词页保留原始 owner 提示词视图，新增配方切换和卡片网格。卡片显示 owner、kind、状态、tags、source ref、owner version、project、revision 和 digest。详情使用现有 InspectorShell，版本以时间线摘要展示。复用动作重新读取正文并将其放入现有 draft，不自动保存。

## 失败状态

`needs_contract`、`forbidden`、`unavailable`、`not_recorded`、`metadata_only`、`stale`、`integrity_failed` 都以明确状态呈现。任何未知动作结果沿用原 preview ref 和 idempotency key，等待 reconcile；不创建替代操作。
