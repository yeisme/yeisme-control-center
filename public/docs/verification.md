# 管理台、多用户与请求历史验证记录

- 设计版本：admincn-v5；AdminCN 组件、Lucide 1.24.0、Sales 看板与模态 Sheet。
- 控制中心远端浏览器流程：53/53 通过。
- 远端截图：157 张，覆盖 1440/1280/768/390、明暗主题与服务详情。
- 控制中心证据：temp/integration-test-runs/2026-10-03T11-59-51-456Z/
- 单元测试：36 项（领域、浏览、表单、范围隔离、统计、导出、owner 授权与目录边界）；以独立源码构建的实际结果为准。
- 源码包独立解压：固定依赖安装、类型检查、单元测试、构建均通过。
- 源码构建证据：temp/integration-test-runs/source-admincn-2026-10-03T11-56-56-272Z/
- 前轮片场副本（本轮未重跑）：2 条完整往返流程通过，6 张截图。
- 片场副本证据：temp/integration-test-runs/2026-10-02T13-03-49-436Z/
- 已验证原任务引用、剧本文字、分镜描述和返回位置保持；仅操作临时浏览器中的演示数据。
- 片场主原型：保留独立合并待办；本轮仅更新控制中心。入口源码补丁与截图可独立审阅。
- 验证中真实服务写请求：0。

## 控制中心远端场景

- passed · all ten pages navigate and show scoped content
- passed · three core services expose all five detail views
- passed · unknown result reconciles original identity without duplicate submission
- passed · rights failure cannot retry; paid retry needs explicit acknowledgement
- passed · batch reconcile reports independent successes and failures
- passed · configuration previews then saves and reads back a new revision
- passed · configuration conflict preserves draft and rebases on fresh revision
- passed · configuration save failure keeps draft and effective revision
- passed · onboarding accepts references and remains unverified
- passed · scope and role changes invalidate details, rows and actions
- passed · pending recovery is invalidated when project scope changes
- passed · all failure scenarios render truthful state and permission gates
- passed · costs deduplicate and preserve currency and uncertainty
- passed · search keyboard, dialog escape and focus restoration
- passed · four viewport sizes, both themes, all page layouts and detail drawers
- passed · Finder selection, keyboard, views, sorting and quick look preserve object identity
- passed · Finder asset preview, independent view preferences and filter invalidation
- passed · Finder history restores query and clears on environment or identity changes
- passed · Finder reduced motion and rapid panel and view changes settle cleanly
- passed · Finder normal motion rapid navigation and external diagnostic context stay intact
- passed · Finder long service names and full service directory remain navigable
- passed · Workspace field validation preserves blanks and focuses the first invalid input
- passed · Workspace dirty navigation protects drafts across close, object and page changes
- passed · Workspace Sheet constrains focus, dismisses by overlay and restores scroll
- passed · Workspace drafts and field errors survive desktop, sheet and mobile breakpoints
- passed · Workspace submitting operations can be hidden and resumed without duplicate writes
- passed · Workspace environment changes immediately discard old form data and late submissions
- passed · Workspace onboarding validates fields and preserves draft when moving between steps
- passed · Workspace review forms require a reason and acknowledgement and retain a receipt
- passed · Workspace read states and broken thumbnail previews are truthful
- passed · Admin table filtering, pagination, sorting, columns, saved view and scoped CSV
- passed · Admin record type multi-select and explicit custom date validation
- passed · Admin analytics drilldown matches the source filter and finance hides for reader
- passed · Admin same-name tenants and identities remain isolated across list, details and export
- passed · Admin member role change previews only its owner and produces a stable receipt
- passed · Admin member conflict requires a refreshed revision and a second preview
- passed · Admin member save failure retains input and dirty navigation can be discarded
- passed · Admin invitation uses a bound account combobox and does not claim email delivery
- passed · Admin owner safeguards, team archive and blank quota validation
- passed · Admin history, analytics and member form responsive themes and reduced motion
- passed · Generation library: folder validation, dirty close, nested creation and duplicate names
- passed · Generation library: intersecting filters, removable chips and empty recovery
- passed · Generation library: asset and directory drag, undo and cycle rejection
- passed · Generation library: keyboard move alternative and preserved original identity
- passed · Generation library: detail notes, dirty navigation, source and rights tabs
- passed · Generation library: notification read state and artifact deep link
- passed · Generation library: save failure retains draft and viewer cannot organize
- passed · Generation library: responsive light and dark surfaces preserve usable controls
- passed · Precision sparse queue has one toolbar and no inactive pagination
- passed · Precision scope picker preserves labels, scoped data and trigger focus
- passed · AdminCN overview metrics drill into exactly the displayed fact scope
- passed · AdminCN direct scope navigation clears an open dirty Sheet and obsolete content
- passed · no page exceptions or real service mutation attempts

## 片场原有测试边界

新增上下文单元测试两项通过。原有全量测试在本地副本中 294 项通过，一项独立设计文档测试依赖未复制的 OpenDesign 设计产物与容器路径；原始基线同样失败，未修改无关测试。

原型与工程证据不代表正式服务接线、Provider 调用或生产部署。
