# 任务可见性实施交接

## 当前结论

这是已实施、经过局部验证的第一批能力，不是整个“三服务闭环＋片场”计划完成。未部署日常服务、未签发真实凭据、未调用付费 provider，未运行 race。既有 OIDC 和 requests 接口继续保留。

## 已实现

- 控制中心个人密码登录、scrypt、服务端随机会话、空闲/绝对过期、改密失效、Origin/Host/CSRF 检查与限流。配置命令只存秘密文件引用。
- 固定 MCP 连接、项目范围、实例定位、协议初始化、序列化请求、超时、响应上限、有界队列、401/403 停止读取。不同实例同名任务不会合并。
- 自动遍历授权任务分页（含空页续读），5 秒列表、2 秒活动详情、隐藏页降频；保留 transient failure 的旧观察，权限失效清理。每周期最多100页，超限明确报错，不谎报完整。
- `TaskSnapshot` 包含原始状态、阶段、真实计数、结果引用、revision 和观察时间。无百分比时显示未知；完成不等于采用。
- Eikona：run 在产物出现前进入可重建目录；授权 observer、阶段和脱敏事件；修复根 worker 执行普通排队任务时丢失项目范围的问题。
- Sonora：读取 audio-job、music-job、tts-result、local-job、voice-render-job、workflow-run。workflow读取其专有表；同步 language render 在 provider 阻塞前登记原任务，并为不同显式提交分配不同身份。
- Scaena：run（包括映射到 canonical run 的 video run）、直接 video-task、delegation 读取；只读 observer scope；Studio 同源剧集 tasks facade。canonical run现读取既有RunOutputRecord的明确结果引用，每个返回run最多100项，不选metadata或旧grant；只丰富返回行，不对所有扫描候选做结果查询。
- 片场：运行胶囊及420px原生dialog面板，按明确剧集引用读取 delegation；打开/关闭不卸载写作编辑器、不触发 reconcile/生成/采用。
- 三服务媒体：Eikona图片、Sonora任务明确audio-asset、Scaena任务明确本域资产。浏览器只看到opaque artifact-N引用；服务端按任务快照逐结果校验preview/download动作和独立内容权限后，才交换同源短时媒体句柄。owner独立内容权限、明确点击获取短时会话句柄、同源流式传输、单Range、HEAD、类型/长度/并发限制；音频/视频使用原生播放器，无自动播放。上游签名URL和凭据不进入浏览器；媒体句柄过期、撤权或上游失败均不自动续期，需用户重新操作。Scaena外部owner引用不代取。

- 系统通知默认关闭，用户点击后才请求浏览器权限；只在当前挂载工作区观察期间生效，无后台推送。通知正文不含任务名、项目或媒体，浏览器API stub验证了意愿门，未做操作系统通知中心实机验收。活动列表消失的已知任务会有界查询原身份，不将消失猜为成功。
- 双向链接：本地配置固定Studio origin，任务返回明确episode ref才出现“返回作品”；Studio构建配置固定控制中心origin/连接。目标重新检查身份与引用，默认新标签保留原草稿，无SSO承诺。
- 有限取消：Eikona未领取queued run、Sonora local-job、Scaena delegation未发送项。须本地allow_cancel和owner独立取消权限，默认关闭。确认时固定revision（后台轮询不得静默替换确认版本）、固定幂等键、原回执查询；网络丢回包刷新后只查询同一回执。requested不是cancelled；requested与unknown均保留原取消身份，禁止自动重发。Eikona文件写入中断可保留unknown，不自动恢复。
- 行动优先总览与授权批次筛选：需要处理的原任务、核心服务和明确作品返回入口；按任务/项目引用、服务实例、状态、任务族及UTC创建日期筛选。只筛选已授权有界数据，不能冒充完整历史查询。

## 尚未完成（保留原计划，不视为删项）

| 范围 | 具体缺口 | 下一可验收切片 |
| --- | --- | --- |
| CONTRACT | 每个现有MCP生成入口的全量具名覆盖矩阵、attempt/last business progress统一字段尚未冻结 | 在各owner登记完整入口映射，校验未列入口不会被报为完整 |
| BACKEND | 已支持三种有限任务族取消；不支持上游强制停止，Eikona文件存储unknown仍需owner人工恢复 | 补崩溃窗口、撤权及旧worker恢复矩阵；不扩大取消授权 |
| BACKEND | Sonora local-job已消费原有有界事件，其余Sonora族与Scaena事件仍为gap/not_recorded；Eikona已支持有界字节续读，快照早期业务进展事实仍需完善 | 复用原事件存储完善有界恢复游标，不引入推送基础设施 |
| BACKEND | Scaena仅映射canonical run的video run可见；Studio只显示delegation，不宣称涵盖所有shot/owner任务 | 通过明确 refs 扩展 facade，补阶段与结果关系 |
| FRONTEND | 已补行动优先布局与批次筛选；作品影响、shot/owner关联、统计账本仍依赖未完成合同；通知与深链缺真实多端验收 | 不补造业务关系，扩展owner明确投影后验收 |
| INTEGRATION | 三owner独立测试进程、真实持久化、MCP观察、浏览器图片/音频/合成视频、取消回执、控制中心重启及断连隔离已验证；不是发行daemon验收 | 补Sonora/Scaena MCP生成提交、owner执行中重启/真实权限撤销矩阵与Studio联合链路 |
| 日常只读 | 尚未取得/验证observer连接配置及日常版本 | 仅在操作者提供已授权配置后读能力和任务，不升级服务 |

取消只在owner声明、任务族和本地开关均允许时显示可用；其他族保留禁用原因。Sonora的原TTS status和Scaena reconcile可能推进业务，未用于自动轮询。

## 已有证据

- 控制中心组件：`temp/integration-test-runs/task-visibility-2026-10-05T14-56-49-522Z/`（含丢取消回包后的刷新恢复、unknown/requested不重发、批次筛选与行动总览、后台更新期间固定取消确认版本）。真实控制中心服务与浏览器＋fake MCP，登录、空页续读、状态更新、受控图片/音频及Scaena媒体、通知意愿stub、深链重授权、390/768/1440/1920明暗；**不是三owner联调**。
- 隔离系统：`temp/integration-test-runs/task-processes-2026-10-05T14-47-07-623Z/`。三个独立owner测试二进制、真实持久化与HTTP/MCP处理器，fake外部边界阻塞时观察，原身份完成后浏览器读取三来源图片/音频，Scaena预置canonical run投影本地ffmpeg合成视频，覆盖解码、无自动播放、seek、Range/HEAD；三owner取消与原回执、CSRF拒绝通过。控制中心真实进程重启后旧session/task key失效，重新登录可查询同一owner取消回执；临时observer配置失效使旧媒体句柄被拒绝且连接停止读取，Sonora进程断开不遮蔽Scaena。没有测试owner执行中重启，也未改动真实owner权限。Eikona从MCP generate提交；Sonora与Scaena从application入口提交；Scaena使用测试principal认证器，不能替代生产key生命周期验收。fake调用为图像1、配音6行、delegation 1，未调用付费服务。
- 两前端typecheck/build通过；控制中心13文件75测试、Studio10文件55测试通过。构建仍有控制中心大chunk警告；最近九个TS文件LSP的error级检查无已报告错误，但六个结果未确认，不宣称全仓静态clean。
- 片场组件与各owner证据位于各自 `temp/integration-test-runs/`，由本owner runner记录，根不复制其证据。
- 早期截图在响应式导航动画中截取，不构成布局证明；最新脚本等待导航移出后再截图。
- 本轮失败归因：进程测试登录后未等待cookie会话，修正测试就绪等待；浏览器筛选发现select标签不稳定，补精确无障碍名称；跨页hash导航不更新页面，修复LiveApp监听。失败证据保留，不用重跑结果覆盖失败记录。
- 当前源码差异涉及多个既有脏owner且前端大量文件尚未跟踪，git diff --check只是空白检查，不等于全量代码审计；本轮未提交、推送或清理这些修改。

## 重跑

```bash
bun run typecheck
bun run test
bun run build
bun scripts/verify-task-visibility.ts
bun scripts/verify-task-processes.ts
```

这些命令不访问日常实例或付费provider。实际激活步骤见 [个人观测激活](personal-task-observation.md)。
