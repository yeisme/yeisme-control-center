## 1. 规格与设计交接

- [ ] 1.1 读取 OpenDesign v10 `design-proposals/control-center-v10/index.html` 及其 `README.md`、`brand-spec.md`、`migration-map.md`、`verification.md`，确认行动总览、五维服务状态、运行上下文和移动详情均有对应界面；记录 preview URL、读取时间和文件回读摘要。
- [ ] 1.2 将 v10 交互状态映射到本地组件清单：action item、service evidence card、project runtime context、request evidence chain、asset handoff、unknown/stale/unauthorized/not_supported。
- [ ] 1.3 在本地文档中标明设计演示、正式客户端、owner 合同和真实集成四层证据，不把 OpenDesign 的 `apple` 元数据改写成客户端设计系统事实。

## 2. 客户端垂直切片

- [ ] 2.1 总览首屏：1440×900 同时可见行动项、Scaena/Eikona/Sonora 五维摘要和当前作品；空、错、过期、未知状态不回退样例。
- [ ] 2.2 服务证据：服务列表和详情能分别显示五维状态、来源、观察时间、覆盖范围和禁用原因；无管理合同的动作保持禁用。
- [ ] 2.3 运行上下文：项目→请求→任务→尝试→网关调用→资产引用保持稳定定位，并支持返回原项目/镜头；不重复提交。
- [ ] 2.4 请求恢复：未知回包只查询原操作；迟到响应、范围切换、退出登录、关闭详情和重试失败均保留安全边界。
- [ ] 2.5 资产与交接：显示来源、版本、权利/用途状态和 owner 交接引用；当前采用版本不被新版本自动替换。

## 3. 响应式与质量门

- [ ] 3.1 覆盖 1440、1280、768、390 四档视口，明暗主题、键盘、Escape、焦点恢复和减少动态效果；间距角色按 v10 `brand-spec.md` 的桌面 32/32/20/24/36 与手机 16/20/16/16/44 基线记录。
- [ ] 3.2 补充合成状态 fixture 与浏览器断言；证据写入 `temp/integration-test-runs/<run-id>/`，正文、token、provider payload 和完整推理不得写入。
- [ ] 3.3 运行 `bun run typecheck && bun run test && bun run build && bun run build:demo`，再运行项目已有 UI/工作区脚本；失败按新增、并发、环境和既有问题归因。

## 4. 真实接入与交付边界

- [ ] 4.1 仅在 owner 提供合法 observer 和公开合同后验证 Scaena、Eikona、Sonora 只读列表/详情/观察证据；不付费、不生成、不取消、不重启。
- [ ] 4.2 更新 `docs/README.md`、`docs/admincn-v7.md`、`docs/control-center-v8-proposal.md` 的版本关系、证据边界和 v10 入口。
- [ ] 4.3 完成本地源码包构建与 OpenDesign 逐文件读回；设计通过、工程通过、真实接入和部署分别报告。

使用 `openspec validate control-center-v10-admincn-migration --strict` 检查本变更；任务状态只通过项目脚本或 OpenSpec 命令推进，不手改生成状态文件。
