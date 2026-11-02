## Context
React/Vite/Bun + 同源聚合；现有个人身份与 OIDC 保持兼容。三服务元数据与内容权限独立。

## Goals / Non-Goals
完成总览、服务、原任务和现存结果调查路径。无真实生成、取消、重试、远程 Shell 或通用运维后端。

## Decisions
GET /connections 增加 runtime；GET /services?observe=1 显式请求观测，普通目录读取不调用上游。保留 service_directory.v1 旧字段，runtime 为可选增量。每个固定连接合并在途探测、缓存15秒，只缓存脱敏能力事实；撤权绕过成功缓存，清除成功时间和能力。结果内容支持只能表示合同声明，打开时仍逐结果校验。
总览合并活动与历史，任一分支拒绝授权时移除该来源记录；部分失败不报告完整可用。页面使用同一 fetch 合同及 ConnectionCards；返回筛选只存会话内存，不持久化任务正文。

## Risks / Trade-offs
历史分页仍有100页显式上限。统计标记当前授权批次。现有主 bundle 约722kB告警保留。Scaena gateway 的新增 scoped-key 认证需匹配 reader membership；候选不得在未知活跃任务时切换。

## Verification
- local: temp/integration-test-runs/daily-local-gates-2026-10-09T16-04-13-595Z
- browser: temp/integration-test-runs/daily-frontend-2026-10-09T16-05-59-343Z
- component: temp/integration-test-runs/task-visibility-2026-10-09T15-52-45-070Z
- owners: temp/integration-test-runs/task-processes-2026-10-09T15-54-39-896Z
- candidate: temp/integration-test-runs/intranet-candidate-2026-10-09T16-06-12-394Z
- compatibility: temp/integration-test-runs/scaena-upgrade-preflight-20261009T160205Z
- deployment: pending
原有演示验收首轮53项中52项通过，首项导航超时；无代码变更的单项重验通过，失败证据保留。正式 owner 读取未验收。
