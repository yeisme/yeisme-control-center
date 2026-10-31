# Yeisme 控制中心：接入 Anatomia 任务观测 v1

## Why

用户要求工作台接入 Anatomia 等常见开放工具（2026-10-30），并决定先改 Anatomia、验完再部署。

- **控制中心**：服务目录把 Anatomia 标为“未接入”；任务连接只认 Eikona、Sonora、Scaena。
- **Anatomia**：已在 `agent/anatomia` 的变更 `anatomia-control-center-task-observation-v1` 里实现只读合同 `yeisme.task_observation.v1`（尚未部署）：
  - `anatomia.execute` 工具，受 `ANATOMIA_TASK_OBSERVATION_ENABLED` 开关控制；
  - `observer.read` / `observer.content` 两个 scope，观察密钥必须绑定项目；
  - 按项目列出拉片（`decompose`）与视频问答（`understand`），只含带项目的分析；
  - 媒体授权 `anatomia.task_artifact_grant.v1`，地址 `/api/v1/control-center/artifact-grants/<32 位十六进制>`，凭 Bearer 访问，120 秒有效；
  - 不支持取消。

## What Changes

- **owner**：`TaskConnection.owner`、`taskOwners`、工作台 owner、显示名都加入 `anatomia`；媒体类型按视频分析归类，结果帧按自身 mime 显示为图片。
- **用词**：任务族 `decompose` → 拉片分析，`understand` → 视频问答。不用“拆解”，那是 Scaena 制作拆解的词。
- **服务目录**：Anatomia 改为“任务观测”，缺口说明写明要签发绑定项目的观察密钥、预览另需 `observer.content`、服务要开启任务观测、只列出带项目的分析、不支持取消。来源覆盖条在配置了 Anatomia 后显示它。
- **媒体授权**：接受 `anatomia.task_artifact_grant.v1`。地址必须同源、路径恰为授权路由、不带 query 与 fragment，过期时间不超过 125 秒；取媒体时带同一个观察凭据。
- **取消**：取消白名单不加 Anatomia，一律返回 `cancel_not_supported`；`personal-config cancel` 也不接受 Anatomia。
- **`personal-config connect`** 接受 `anatomia`，但不为它钉委托读取的默认项目（Anatomia 没有请求投影）。`content` 也接受 `anatomia`。
- **工作台**：走现有通用路径，不写 Anatomia 专用页面。拉片的阶段进度进入“进行中”，授权后关键帧进入“最近结果”，失败或结果未知进入队列。

## Impact

- **服务端**：`server/contracts.ts`、`server/task-connections.ts`（媒体授权分支）。
- **前端**：`src/task-observation.ts`、`src/service-directory.ts`、`src/shared/work-queue.ts`、`src/shared/read-model/tasks.ts`、`src/components/ui/Status.tsx`、`src/components/SourceCoverage.tsx`、`src/pages/tasks/TaskDetail.tsx`。
- **脚本与测试**：`scripts/personal-config.ts`；fixture 新增 `fx-anatomia`（进行中 2/5、成功带 3 帧、结果未知、部分完成）与 `fx-anatomia-denied`（工具层 `FORBIDDEN`）；合同集成新增两项；浏览器旅程新增一项；`tests/task-connections.test.ts`、`tests/personal-config.test.ts`。
- 不部署 Anatomia、不改真实配置；部署与签发真实观察密钥另行确认。
