# 历史 v10 方向与现行任务的关系

2026-10-21：本变更的原视觉方向已被现行 `AGENTS.md`、App Shell、visual-system 和 shared-projects 方案替代，停止依照原任务恢复 AdminCN/v10/OpenDesign 或 demo 构建。历史任务与未完成状态保留；以下为行为迁移计划，不是验收通过记录。

| 原任务 | 保留的行为 / 处置 | 现行目标与补证 |
| --- | --- | --- |
| 1.1 | 旧原型读取仅保留历史，不作为当前实现前置 | 当前 `src/app-shell`、导航与实际页面；completion 5.1 审核历史 delta |
| 1.2 | 保留状态与组件语义 | visual-system、work-queue、shared-projects 的原语与五态覆盖 |
| 1.3 | 保留证据分层 | `docs/current-status.md`、`docs/completion-roadmap.md` |
| 2.1 | 行动项、服务摘要与项目入口仍需易达 | 当前首页 + attention-handoff；目标浏览器首屏补证，不能仅据页面存在关闭 |
| 2.2 | 服务五维状态与禁用原因 | core-services-observation + 当前 Services；部分来源降级旅程 |
| 2.3 | 原项目/请求/任务/资产稳定定位 | task/request visibility、shared-projects 和 completion A1 detail 深链 |
| 2.4 | unknown 只查询原操作、范围切换丢弃迟到响应 | task-cancel、generation-batches、action contract 与当前浏览器旅程 |
| 2.5 | 来源、固定版本、用途/权利和交接 | shared-projects 4.3、creative-flow；未发布权利合同继续缺口 |
| 3.1 | 响应式、主题、键盘、焦点与减少动态效果 | 用现行 tokens；completion 3.2 的 390/768/1440/1920，加 1280 固定 Inspector；旧间距基线不再覆盖现行设计 |
| 3.2 | 合成状态只用于隔离测试与脱敏证据 | 既有 fake owners/fixtures 和 integration evidence 六件套；应用无 fixture 回退 |
| 3.3 | 类型、测试、生产构建和当前旅程 | `bun run typecheck`、`bun run test`、`bun run build`、当前 contract/browser runner；已不存在的 `build:demo` 不执行 |
| 4.1 | 真实三 owner 范围化只读 | daily 5.1、attention 2.2、completion 4.1；无任务不能证明媒体路径 |
| 4.2 | 更新实际文档索引与证据边界 | 当前 `docs/README.md`、interfaces、current-status；不存在的旧版本文档不重建 |
| 4.3 | 本地可构建交付与实际回读 | completion 3.2、daily 7.1/8.1；不执行 OpenDesign 文件同步；本地、部署与真实读取分开 |

后续通过本变更新增 5.1 核实每项测试/证据或接续任务，再由 completion 5.1/5.2 处理归档。不得把 supersession 当作 14 项全部实现；归档前逐条审查 delta，避免将被替代界面要求合入主规格。
