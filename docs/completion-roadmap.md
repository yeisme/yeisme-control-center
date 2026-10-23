# 控制中心完成方案

核对日期：2026-10-21。依据当前工作树、`openspec list`、`server/app.ts`、共享 DTO、typed client 和页面调用核对；当前工作树含尚未提交的共享项目实现。本文是后续实现方案，本轮仅修改规格、任务和文档，没有新增运行接口、运行真实验收或部署。原有测试数字见 [current-status.md](current-status.md)，不视为本轮重新通过。

## 完成的定义

完成控制中心需要分别满足三层结果：

1. 工程完成：当前 App Shell 的用户路径可运行，客户端和同源服务字段一致，异常与恢复有本地证据，全部必需能力有 owner 和任务。
2. 真实接入完成：按用户、组织、项目授权读取实际 owner，确认空列表、拒绝、过期和来源缺口均如实显示；真实空列表不能证明视频播放或任务详情通过。
3. 交付完成：在具体部署目标认证后验证主要路径和重启恢复；若交付范围包括生成，还需另行授权的图像、视频、音频 canary 与可下载成果证据。

`openspec list` 的复选框只反映任务登记。旧表未对账、复合任务未拆分和外部验收等待不能相加成项目完成率。三层分别报告，付费或授权等待不阻塞独立工程切片结项，但不能因此删除原需求。

## 能力归属

| 必需能力 | 准入 | canonical owner | 控制中心工作 |
| --- | --- | --- | --- |
| App Shell、筛选、Inspector、局部状态、只读聚合 | `fit` | Control Center | 复用现有 React/Vite/Bun、typed client 和同源服务 |
| 组织、团队、项目 grants、文件夹、成果引用、通知阅读状态 | `fit` | Control Center | SQLite/Drizzle、本地权限、CAS、审计与回执 |
| 固定批次与预算观察 | `split-owner` | Control Center 持有编排引用；Eikona/Scaena 持有输入、计划、执行 | 保留原键，预算保留不代表真实费用入账 |
| 图像/视频参考 binding、媒体字节、已知报价 | `split-owner` | Eikona / Scaena | 消费不可变引用和短期授权，补充选择与预览界面 |
| 请求正文、上传清单、附件授权 | `split-owner` | Eikona / Sonora / Scaena / Aigora | 按需读取、用途和审计；缺合同不拼接内容 |
| 收集记录、剧本→分镜、审阅与交付 | `split-owner` | Auctra / Scaena；MuWeave 是消费端 | 收集元数据、流程投影与安全交接；本地收集确认不等于 owner 审阅通过 |
| 工具、模型、渠道、用量事实 | `split-owner` | 对应服务；网关账本归 Aigora | 只读发现和来源覆盖，不合成 ready 或已结算费用 |
| 复制领域状态机、远程 Shell、浏览器 Provider 密钥 | `reject-now` | 应使用既有 owner application contract | 不进入控制中心实现 |

## 现有 14 项变更如何处置

以下计数是补充任务前的快照；新增任务会改变分母。

| 变更 | 原登记 | 核对结论与完成路径 |
| --- | --- | --- |
| `yeisme-shared-projects-media-browser-v1` | 6/9 | 主要本地协作实现已在工作树；4.2 视频固定输入/已知报价、4.3 参考 binding 仍有明确缺口。先冻结 owner 合同，再适配和实现页面；5.3 的组织委托、付费和部署分开验收 |
| `yeisme-control-center-tool-catalog-v1` | Complete | 保留本地完成事实。当前 owner 资源覆盖不足是下一轮 owner 接入工作，完成态不表示 Eikona 已部署所有资源；归档前回归当前 diff |
| `yeisme-control-center-visual-system-v1` | Complete | 保留当前 tokens/原语；新增界面按同一体系验收，无需恢复历史设计 |
| `creative-flow-owner-integration-v2` | 6/7 | 剩余项拆为真实投影读取、目标浏览器旅程和安全证据；episode/ref/digest 缺失继续 `needs_contract` |
| `yeisme-control-center-auctra-authoring-v1` | 7/9 | 当前职责是 body-free collection；补浏览器与真实 collection read。SSE 依赖 Auctra event source，显式同步先保留，未发布不判已支持 |
| `yeisme-control-center-attention-handoff-v1` | 6/7 | 派生队列已实现，剩真实来源覆盖、跨页定位及不可用分支证据；不创建第二任务真源 |
| `yeisme-personal-daily-management-v1` | 4/7 | 5.1 真实三服务、6.1 本地质量、7.1 部署读回拆开。旧记录已有部署成功不自动证明当前候选的认证读取 |
| `yeisme-provider-live-v1` | 11/12 | 剩真实付费 canary。保留预算上限与渠道/模型范围，当前不执行；本地 dry-run 不能替代 |
| `control-center-v10-admincn-migration` | 0/14 | 历史视觉方案，与当前 AGENTS 禁止恢复旧界面冲突。停止沿旧 UI 实施；把服务五维、上下文、未知恢复、响应式等行为逐项映射至当前测试，余项迁移到明确任务后按 supersession 记录处置；不批量勾选或直接无证据归档 |
| `yeisme-core-services-observation-v2` | Complete | 保留当时只读与部署证据；Scaena 当时真实空表不等于其媒体路径已验收 |
| `yeisme-task-visibility-v1` | 0/4 | 代码、测试与旧阶段记录已存在，属于登记与覆盖对账。逐项比对当前 task/read/media/cancel 合同；旧 `test:task-visibility` 已不适配现行 UI，使用当前旅程和合同集成补证 |
| `unify-admincn-six-entry-workspace` | Complete | 历史完成记录，不能据此把现行 12 个导航页改回六入口；归档时保留深链兼容事实 |
| `refine-sidebar-fullscreen-motion` | Complete | 历史完成记录，现行 Inspector、焦点恢复、减少动态效果继续受回归保护 |
| `yeisme-request-visibility-v1` | 4/8 | 元数据、正文与 Eikona 附件已有后续归档实现。对照归档 `yeisme-request-content-visibility-v2` 拆出 Scaena/Sonora 附件缺合同、实际委托与四 owner 回读，不重建第二套读取接口 |

## 实施顺序与代码范围

任务状态真源是对应 `openspec/changes/*/tasks.md`。新增 [completion 变更](../openspec/changes/yeisme-control-center-completion-v1/design.md) 只拥有公共接口和收尾治理；专业功能继续由原变更拥有，引用既有任务不建立第二份完成状态。

| 优先级 | 工作包 | 代码位置 / 依赖 | 可观察结果 |
| --- | --- | --- | --- |
| P0 | 规格与状态对账 | `docs/`、本地 OpenSpec；当前阶段 | 每条原需求对应当前实现、缺口或等待项；消除失效文档链接 |
| P1 | 固定批次分页和单项读取 | `src/shared/collaboration.ts` → `server/app.ts`、`server/generation-batches.ts` → typed client、`BatchGeneration.tsx`、`ProjectFiles.tsx` | 筛选在服务端生效，刷新 URL 后仍能定位原批次；大目录不全量轮询 |
| P1 | 参考 binding 选择 | 原 shared-projects 4.3 / 6.4–6.6；Eikona/Scaena 提供可验证来源 | 能选当前项目的确切版本、显式授权预览，计划固定 ref/digest；跨项目与撤权失败 |
| P1 | 视频固定计划和已知报价 | 原 shared-projects 4.2 / 6.1–6.3；Scaena 合同先行 | 已知同币种费用、未过期 quote、固定输入和预算保留通过后才可确认；未知成本继续阻断 |
| P1 | collection / creative flow / queue | 各自原变更；复用 `server/auctra.ts`、`creative-flow.ts`、`work-queue.ts` 及相应页面 | 从队列到流程再到安全交接，引用和 episode 不漂移；collection 显式同步和本地元数据动作可回读 |
| P1 | 请求与附件覆盖 | 原 request-visibility；`server/owners.ts`、`server/app.ts`、RequestDetail | 四来源分别可用/无权/未归档/缺合同；文本与媒体权限分开 |
| P2 | 本地回归 | 现有 Vitest、合同脚本、Playwright；稳定 diff 后一次完整门 | 当前切片通过，失败归类为 introduced/pre_existing/concurrent/environmental/ambiguous |
| P2 | 真实读取 | 现有合法 observer 与组织委托 | 每 owner、每任务族独立证据；Scaena 缺样本记覆盖缺口，不付费造样本 |
| P3 | 付费、正式授权与部署 | 原 Provider / daily-management 任务；每项具体授权 | 实际账户读回、真实成果下载与播放、候选指纹和重启恢复分别验收 |

同一任务只取 `CONTRACT`、`BACKEND`、`FRONTEND`、`INTEGRATION` 之一。先合同，再两端独立验收，再显式联调；当前没有子 agent 授权，默认顺序执行。前端保留当前预览 checkout；后端热加载/迁移验证在隔离 worktree、端口和 disposable DB，保留现有脏改动。

## 场景与验收矩阵

成熟度按当前证据标为“首批支持”或“探索”；只有补齐真实证据后再升级。

| 场景 ID / 成熟度 | 用户与工作 | 必需产物 / 检查 | 证据入口 | 交接 |
| --- | --- | --- | --- | --- |
| S1 首批支持 | 管理员创建共享项目、分配团队 | grants、CAS、最后管理员保护、跨组织拒绝 | `tests/collaboration.test.ts`；`bun scripts/verify-collaboration-journey.ts` | 项目稳定 ID 与 owner binding |
| S2 首批支持 | 创作者整理并预览成果 | 文件夹/分页、授权缩略图、选中不加载原媒体、显式播放、撤权清缓存 | `tests/media-bridge.test.ts`、`tests/media-cache.test.ts`；共享项目旅程 | 原 artifact ref；没有媒体复制真源 |
| S3 探索 | 创作者绑定参考图并提交图像批次 | exact ref/digest、已知费用、原键/回执、部分成功、断线恢复 | `tests/generation-batches.test.ts`；扩展现有合同集成和旅程 | Eikona 原 operation/member/result |
| S4 探索 | 创作者提交视频批次 | Scaena 固定输入/quote、授权封面、下载可播放、Range、媒体验证 | 扩展 `tests/generation-batches.test.ts` 与既有旅程；真实付费另验 | Scaena 原任务与已验证 artifact |
| S5 首批支持 | 编辑从收集、剧本到分镜查看阻塞 | collection index、source coverage、episode、revision/digest、安全 LaunchContext | `tests/auctra-authoring.test.ts`、`tests/creative-flow-route.test.ts`、`tests/work-queue-route.test.ts`；扩展旅程 | Auctra / Scaena / MuWeave 具名合同 |
| S6 首批支持 | 操作者排查失败与请求 | 原任务、事件、正文/附件授权、unknown 仅查询原操作 | `tests/request-visibility.test.ts`、`tests/attachments.test.ts`；合同集成 | 原 request/task/receipt |
| S7 探索 | 组织用户在实际环境访问 | 真实 delegation、四 owner 覆盖、认证后页面与重启恢复 | 独立授权后的真实读取和部署验收 | 具体候选版本与脱敏运行证据 |

## 验证与关闭

本轮文档验证：

```bash
cd client/yeisme-control-center
openspec validate --all --strict --no-interactive
git diff --check
```

后续实现期按切片运行已有聚焦测试，例如：

```bash
bun run test -- tests/collaboration.test.ts tests/generation-batches.test.ts
bun run test -- tests/auctra-authoring.test.ts tests/creative-flow-route.test.ts tests/work-queue-route.test.ts
```

稳定后的本地工程验收：

```bash
bun run typecheck
bun run test
bun run build
bun run test:app
bun run test:contract-integration
bun run test:server-boot
bun run test:browser-journey
bun scripts/verify-collaboration-journey.ts
bun run test:ci:browser
bun run check:public-surface
```

最终截图应扩展现有矩阵覆盖 390/768/1280/1440/1920 与明暗主题，1280 检查固定 Inspector 的边界；当前脚本已有的截图不能替代新增视口和场景证据。

上述入口均已存在；新场景需要扩展已有脚本，不声称当前脚本已覆盖拟议新增字段。集成/组件/系统/E2E 每轮必须在 `temp/integration-test-runs/<run-id>/` 保留 `summary.json`、`command.txt`、`stdout.log`、`stderr.log`、`env.json`、`artifacts/`，失败也保留。若既有入口不满足六件套，先补证据 runner 再用于结项。禁止保存正文、真实输入、密钥、Provider payload 或完整推理，不运行 race。

已有真实读取命令 `bun run test:owner-live-read` 只能证明它实际覆盖的路径；collection、组织委托、请求正文或新的视频合同未被脚本覆盖时必须扩展对应验收。真实读取、付费 canary、部署与发布分开推进，本轮不执行这些操作。

工程关闭要求：当前合同和页面一致、必需代码任务已验、文档链接有效、历史任务已映射。真实交付关闭还要求授权/覆盖/付费（若在范围内）/目标部署均有证据。Superseded 变更先说明逐条迁移与未完成项；使用 OpenSpec CLI 归档且检查主规格差异，不以批量勾选清空列表。

## 任务维护入口

旧 task-visibility / daily-management 清单尾部提及的专用生成脚本已不在当前 checkout，不作为执行指令。当前使用根仓既有维护工具；从本项目目录执行：

```bash
python3 ../../scripts/openspec-tasks.py --help
openspec list
```

`init` 仅用于 CLI 新建的变更，`append` 增加任务，`amend` 只改任务说明并保留状态/证据，`set` 在实际验收后推进指定任务。不手写 YAML、复选框状态或旧证据。
