# 控制中心后续 Review 记录（2026-10-28）

## Review 输入与边界

- 目标项目：`client/yeisme-control-center`
- Review 工具：本机 `ocr`（OpenCodeReview v1.13.3）与 `grok`。
- Grok 模型：`grok-4.7` / 本地构建默认 `grok-4.7-build-fast`。
- Review 范围：生产提示词与中间检查点观察、共享项目筛选与项目引用复制、新增使用指南和音频播放器；保留工作树中的其他既有 dirty 改动，不将其混入本轮修复。
- 禁止项：不运行 race，不执行真实 Provider 生成、真实付费、部署或凭据变更。

## OCR CLI 证据

`ocr review` 全仓 diff 预览识别 45 个待审源码文件；实际调用因本地总 token budget 在 dispatch 前耗尽而失败，未产生有效 finding。原始运行结果保存在：

- `temp/ocr-reviews/control-center-grok47.json`：第一次全仓运行，`status=failed`，因预算未产生 finding。
- `docs/reviews/control-center-grok47-rerun.json`：第二次聚焦运行的持久化裁剪 artifact，`status=partial`，`llm.model=grok-4.7-build-fast`，34 条 finding，26 个文件因总预算耗尽未派发；包含原始 finding、建议代码、行号、严重级别、工具调用摘要和覆盖/失败清单。
- `docs/reviews/control-center-grok47-preview.txt`：同一当前 dirty diff 的可复核 OCR 选中文件预览与命令输出；用于明确审查覆盖边界。
- `docs/reviews/review-input-sha256.txt`：上述审查输入 artifact 的 SHA-256。
- `docs/reviews/verification-2026-10-28.log`：实际执行命令及完整 stdout/stderr；末尾 `verification_exit=0`。
- 运行命令使用本地 `ocr review`，provider 为 `cpa`，model 为 `grok-4.7-build-fast`，聚焦本轮相关调用链；未执行 race、部署或真实 Provider 写入。

第一次 artifact 的 `status=failed`、`comments=[]`、`failed` 列表均明确标记为 `classification=budget`；第二次 artifact 为有效但部分完成的 Grok 4.7 输入，不能把未派发文件当作通过或否定性 review 结论。

另外存在旧的 `temp/ocr-reviews/folder-cover-cf1aaee.json`，它属于此前其他目标的 review，不作为本轮控制中心结论。

## Grok 4.7 独立审查结论

Grok 4.7 以只读方式审查了本轮相关调用链，提出的高/中优先发现及本轮处置如下：

| 发现 | 处置 | 依据 |
|---|---|---|
| 共享项目隐藏筛选未传给服务端，隐藏项目会被默认过滤掉 | 已修复 | `SharedProjects.tsx` 将 `hidden` 传入 `api.sharedProjects`，并纳入 `useScopedRead` key；服务端既有 `hidden=1` 合同继续生效 |
| 角色/owner/隐藏筛选后空状态使用未过滤行数 | 已修复 | 列表先计算 `rows`，空状态按实际筛选结果、隐藏状态和搜索状态显示 |
| `ProcessTimeline` 将 `events=[]` 当作“已收到观察” | 已修复 | `hasObservation` 仅依据 `observation`；空事件页无 observation 时保留“尚未返回中间检查点” |
| 过程缺口提示与空状态段落重复 | 已修复 | 保留一条可见的观察缺口提示，移除重复 `observed-empty` 段落；SSR 回归测试已更新 |
| 批量生产只展示第一项 `prompt_capture` | 已修复 | 固定计划与已保存批次逐项渲染 `item.prompt_capture`；草稿状态不再保留过时单项观察 |
| 生成项增删、输入修改、owner/模式切换后的旧观察残留 | 已修复 | 共用 `resetDraftState()`，覆盖上述路径 |
| Clipboard legacy fallback 未聚焦/选择不稳 | 已修复 | fallback 控件使用视口内 1px 控件、`focus()`、`setSelectionRange()`；失败仍回到手动复制 UI |
| 指南命令复制失败没有反馈/手动回退 | 已修复 | `CommandLine` 增加失败状态、辅助标签和手动选择输入框 |
| 指南 client picker 改变后 URL 不同步 | 已修复 | `chooseClient` 同步 `client` query 参数 |
| 指南按工具 deep-link 滚动只在 mount 执行且不尊重 reduced motion | 已修复 | effect 依赖 `requested.id`，并按 `prefers-reduced-motion` 选择滚动行为 |

## Grok finding closure matrix

第二次 artifact 是部分完成审查：34 条 finding 已逐项核对；其余 26 个文件未派发，不能视为通过。以下矩阵覆盖所有已返回 finding：

| # | 文件 | 优先级 | 处置 | 说明 |
|---:|---|---|---|---|
| 1 | `ProcessTimeline.tsx` | M | 已修复 | `expired` / `integrity_failed` 不再显示 checkpoint-gap；有回归测试。 |
| 2 | `TasksPage.tsx` | M | 已修复 | 音频深链交给全局播放器后显式清理 preview 参数。 |
| 3–4 | `AssetsPage.tsx` | H | 已修复 | 共享目录切换清理 owner 筛选；失效 sharedProject 不回退到首个项目并保留空态。 |
| 5 | `AssetsPage.tsx` | H | 已修复 | `AudioPosterPlay` 在当前 track 正在播放时调用 `player.toggle()` 暂停，否则调用 `player.play()`；其余阶段继续使用全局播放器。 |
| 6, 8 | `ProjectFiles.tsx` | H/M | 已修复 | 音频先用 owner `resultAction(..., "preview")` 授权门；选择新成果时先关闭旧 visual preview，授权后交给全局播放器；详情仅为非音频挂载 inline preview，锁定音频显示拒绝原因。 |
| 7 | `asset-view.ts` | M | 已修复 | 日期窗口使用本地日历日期；缺失时间仍不命中。 |
| 9 | `AssetsPage.tsx` | M | 已修复 | Inspector 音频 track 传入 assetHref。 |
| 10 | `catalog-view.ts` | M | 已修复 | guide target 从 `guideTools` 派生并编码 query。 |
| 11 | `Toast.tsx` | M | 已修复 | CopyRef 清理失败状态、捕获 rejection，并支持成功回调清掉手动复制框。 |
| 12–13 | `generation-batches.ts` / `BatchGeneration.tsx` | H | 已修复 | 客户端保存前剔除 prompt_capture；服务端仅使用 owner snapshot/plan 或 prepare 的服务端缓存观察。 |
| 14–17 | boot splash | H/M/L | 已修复 | 深链 reload 强制重载、reduced-motion 停止无限旋转、matchMedia 可选链与 React id 已修复。 |
| 18–22 | `GuidePage.tsx` | H/M | 已修复 | 深链 effect 只依赖初始 `initialTool`，不再因 Picker 的 `requested.id` 变化滚动；复制状态随 command 清理并捕获异常；client 从 query 派生；目录错误回退缓存。 |
| 23 | `GuidePage.tsx` | L/style | 保留 | 复制按钮文案仍为内联表达式，不影响行为；后续 UI quality 可单独整理。 |
| 24–28 | `ProjectsPage.tsx` | H/M | 已修复 | 结果关闭使用 null、owner 深链保留 owner、切项目清理筛选；结果表格会把选中项所在窗口纳入渲染，任务“查看全部”携带当前 `q/state/stage` 筛选；音频结果按钮直接启动全局播放器，视觉结果继续由项目级 `useMediaPreview` 订阅 query。 |
| 29 | `ProjectsPage.tsx` | L/style | 已修复 | kind label 使用完整 `MediaKind` 联合，不再断言 image。 |
| 30–31 | `SharedProjects.tsx` | M | 已修复 | 切组织清理 role/owner；ready 后才判空并区分文案；CopyRef 成功清除手动复制状态。 |
| 32–34 | `audio-player.tsx` | H/M | 已修复 | stale grant 按 load token 丢弃；skip/currentTime 仅在 metadata 就绪时读 audio；下载拒绝空 URL并挂载 anchor 后点击。 |

### 未派发文件与低置信度建议

OCR/Grok artifact 的 `coverage.failed` 中有 26 个文件因预算未派发，不能声称已经审查或通过；它们保留为未审查范围，不从结果推断缺陷。已返回但本轮只保留的低优先级建议：

- `GuidePage.tsx` 的 radiogroup 箭头键导航和复制按钮文案整理：独立无障碍/风格任务。
- 音频真实浏览器下载、跨源签名 URL、媒体低级时序和未知长度流式行为：需要 Playwright/浏览器矩阵和真实句柄，不凭静态推断继续扩大。
- `ProcessTimeline` 历史分页/事件子集语义：等待 owner observation contract 明确分页语义。
- `generation.batch.create` 的跨进程 prompt_capture 绑定：当前 owner 合同不返回该字段，服务端进程缓存只解决本流程；跨进程持久化需要独立合同任务，不能自行伪造 owner 能力。

## 验证结果

在目标子项目目录执行：

```bash
cd client/yeisme-control-center
bun run typecheck
bun run test
bun run build
git diff --check
```

结果：

- `bun run typecheck`：通过。
- `bun run test`：53 个测试文件、363 个测试通过。
- `bun run build`：通过。
- `git diff --check`：目标子项目通过。

可复核日志摘要（完整日志见 `docs/reviews/verification-2026-10-28.log`）：

- `bun run typecheck` → `tsc --noEmit`，通过。
- `bun run test` → `53 passed` 个测试文件、`364 passed` 个测试，通过；新增 deep-link effect 依赖回归测试。
- `bun run build` → `vite build`，`✓ built in 4.56s`。
- `git diff --check` → 无输出，命令组 `verification_exit=0`。

根仓库范围的 `git diff --check` 仍会报告其他项目既有文件的末尾空行；这些路径不属于本轮目标，也未被修改或清理。目标子项目自身检查通过。

## 结论

本轮用户指定的高/中优先 review 修复已完成并通过子项目验证；第二次 OCR/Grok 4.7 聚焦审查 artifact 已随项目持久化，解决了此前“只有叙述、没有可核验输入”的问题。第一次 OCR 运行仍明确记录为预算失败，不能当作通过。低置信度和本轮未扩大处理的建议已明确记录，未静默丢弃或虚构为已修复。
