# Yeisme 控制中心：最新工具目录 v1

## Why

各 owner 已经上线新的工具：
- Eikona：Kie/OpenRouter 原生图像渠道、upscale。
- Scaena：Kie/OpenRouter 原生视频渠道和 latest_policy。
- Sonora：音乐全链路动作和 readiness 矩阵。

这些 owner 都提供了只读发现面，但控制中心的“模型与工具”页面只有每个 owner 一张卡：
- `tools/list` 读到后被丢弃；
- AI 创作读取的 `<owner>://creative-input/contract` 资源没有任何 owner 实现，所以真实环境下模式、参考角色和时间线字段为空。

## What Changes

- 新增 `yeisme.tool_catalog.v1` 只读投影和 `GET /api/control-center/v1/tool-catalog`。投影包含服务器、MCP 工具（分页、注解、输入摘要与 digest）、owner 动作（风险等级、可用性、确认/幂等要求）、模型（只透传 owner 声明的 status）、渠道（`channel.summary.v1`）、覆盖状态和近 7 天变化。
- 每个 owner 的发现结果有以下保障：
  - 并行执行，单 owner 超时 8 秒；
  - 60 秒缓存，强制刷新每 15 秒最多一次；
  - 失败时回退到上次成功结果并标为 stale；
  - `/capabilities` 与 `/tool-catalog` 共用同一次发现。
- AI 创作的能力合同改为从真实发现结果推导：Scaena 用 binding task_mode，Eikona 用 generate/edit/upscale 动作，Sonora 用 voice.audition。音乐等多步受控流程只进目录，不进入 AI 创作。
- 新增本地变化账本 `tool_catalog_entries` / `tool_catalog_baselines`。只保存条目 id、digest 和时间戳。首次完整读取某类条目时只建立基线。
- “模型与工具”页面重做为五个页签：概览、模型、渠道、工具与动作、动态。条目在 Inspector 中查看，唯一的跳转是“在 AI 创作中预检”。
- 命令面板可以搜索已缓存目录中的模型、工具和动作。

## Owner Boundary

- 控制中心只读取 owner 的只读发现面（`initialize`、`tools/list`、`resources/read`，以及既有的只读诊断调用），不调用任何目录条目。
- Aigora model-directory、MCP Gateway `/v1/tools` 和 Auctra Pi runtime 在获得只读合同前保持 `needs_contract`。
- owner 未声明模型 status 时显示“状态未声明”，不推断为最新。
