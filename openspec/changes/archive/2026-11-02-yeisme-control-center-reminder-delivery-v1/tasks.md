# Tasks

## 1. 稍后提醒与重新打开（服务端）

- [x] 1.1 `NotificationStore.snooze()` 与 `snoozeDeadline()`：`until` 必须是带时区的 RFC 3339，在未来且至多 30 天后；只有未读且未恢复的提醒能稍后提醒，状态保持 `unread`，只写 `snoozed_until`；`reopen()` 同时清掉稍后提醒 | evidence: `tests/notifications.test.ts` “snoozing a reminder” 7 项（边界值与 14 种无效输入、到点后重新计数并回到“新失败”、重复观察同一失败不取消稍后提醒而新失败版本不带稍后提醒、已确认/归档/已免提醒/已恢复的拒绝、别的范围与别的人的 404、重新打开清掉归档/确认/免提醒/稍后提醒、`canSnooze`/`canReopen`、三个固定时间在周一/周六/周日各自落在哪一天）
- [x] 1.2 `POST /notifications/:id/snooze`：CSRF、范围与账号的检查同确认/归档（`rowScope`），请求体恰为 `{ until }`，≤ 256 字节；响应 `{ notification, task_state, task_states_changed: 0, owner_writes: 0 }`；`reopen` 路由沿用 | evidence: `tests/notifications.test.ts` “snooze and reopen over http” 3 项（无 CSRF 403、别人的提醒 404、别的范围 404、不存在的 404、GET 405、七种无效请求体与时间的错误码、未读数随稍后提醒下降并在到点后（`vi.useFakeTimers` 只拨 `Date`）回升、归档后稍后提醒 409、重新打开清掉稍后提醒）；合同集成 “reminders: snoozing sets a reminder aside …” 在真实 HTTP 路径上复核（无 CSRF 403、31 天 400、稍后提醒 200 且未读数 −1、再次稍后提醒替换、重新打开回到未读、归档后 409、整个过程 owner 命中数不变）
- [x] 1.3 提醒动作不写审计行：确认、免提醒、归档、重新打开至今都只写提醒账本，没有 `notifications.*` 审计动作，稍后提醒与它们一致（响应带 `owner_writes: 0`、`task_states_changed: 0`） | evidence: 合同集成里该检查断言 `owners.hits()` 前后相同；`docs/interfaces.md` “提醒投递” 写明这一点

## 2. 定期重读（页面）

- [x] 2.1 `src/app/reminder-refresh.ts`：`startRefresh()` 每 60 秒重读一次，页面不在前台时跳过（开了桌面通知则不跳过），回到前台或窗口获得焦点时立即重读并重新计时，上一次没结束不开始下一次，读失败不停；`mergeFirstPage()` 保留用户加载过的更多行；`nextSnoozeEnd()` | evidence: `tests/reminder-refresh.test.ts` 8 项（用手动驱动的页面时钟：每分钟读、隐藏时不读/`whileHidden` 时读/回来立即读且只留一个定时器、重叠不并发、失败后继续与 `stop()` 彻底停下、浏览器时钟只在可见/获得焦点时唤醒并释放监听、两种合并、最近的稍后提醒结束时间）
- [x] 2.2 `NotificationProvider`：用上面的调度重读第一页（`GET /notifications`，不调 owner），版本号丢弃在用户操作之前开始的重读，内容没变时不更新状态，稍后提醒到点时读一次；切换范围不拿旧范围的行做计划 | evidence: 浏览器旅程 “desktop notifications …” 在 Playwright 时钟下把页面拨快 61 秒触发一次重读，新提醒进入铃铛与提醒页；“reminders: a snoozed reminder leaves the count …”

## 3. 桌面通知（页面）

- [x] 3.1 `src/app/desktop-notifications.ts`：纯函数 `planDesktopNotifications()`（基线、只在不可见或失焦时弹、在前台看到的算已看到、一条只弹一次、稍后提醒到点再弹一次、一次最多 3 条加一条摘要、内容只有工具名/类别/数量），`desktopSupport()`（不支持、非安全上下文、已拒绝的中文原因），按账号的 `localStorage` 读写（容忍任何存储内容） | evidence: `tests/desktop-notifications.test.ts` 16 项（见各用例名：首次看到某范围只建基线、基线内不弹而新到的弹、离开基线后重新打开又是新的、在前台不弹且算已看到、只弹一次、稍后提醒到点再弹且每次新的稍后提醒各一次、稍后提醒中被取出基线的在到点后弹、一批 6 条是 3 条加摘要且最新的先弹且 6 条都记住、摘要至多点三个名字、内容里没有标题/提示词、超过 300 个编号忘最老的、不改传入的对象、三种不可用原因与可用/已授权、按账号隔离、读回任何存储内容不抛错）
- [x] 3.2 提醒页工具栏的“桌面通知”开关：默认关；只有点开关才调 `Notification.requestPermission()`；不支持/非安全上下文/已拒绝时关着且不可用，旁边用中文写原因；浏览器收回权限后自动关掉并记住；点击通知让页面获得焦点并打开 `#/reminders?focus=<编号>` | evidence: 浏览器旅程 “desktop notifications: permission is asked only by the switch …”（加载页面时 0 次请求、点开关 1 次、开关 `aria-checked`、在前台过一分钟不弹、隐藏后后台一次写入一批新提醒只弹 3 条加一条摘要且摘要说另有几条、再过两分钟不再弹、之后只新增一条提醒恰好多一条通知且 `tag` 就是这条提醒的编号、再过一分钟不重复、在前台到的提醒隐藏后不弹、通知内容里没有任何提醒标题）；无头 Chrome 里权限本来是“已拒绝”，其余各页的 axe 检查里这个关着的开关与原因文字照常通过

## 4. 标签与动作（页面）

- [x] 4.1 `src/notifications.ts`：`reminderKind()` 把提醒分成任务失败/工具运行/凭据/项目协作，`reminderKindLabels`；`reminderGroup()` 把稍后提醒中的行归入“已降噪”；`reminderStateLabel()` | evidence: `tests/reminder-kinds.test.ts` 4 项
- [x] 4.2 提醒页与铃铛：`operation` 显示“工具运行”、`credential` 显示“凭据”，不再叫“项目协作”；只有任务失败显示失败版本（revision、错误码、owner 状态）与“此任务以后都免提醒”“相同错误码以后都免提醒”，其余类别只有“这一条不再提醒”；凭据提醒用凭据状态的标签与原因说明；“稍后提醒：1 小时后 / 明天上午 / 下周一上午”与“重新打开”（已归档的提醒以它为主按钮） | evidence: 浏览器旅程 “reminders: a snoozed reminder leaves the count and comes back, an archived one is reopened, and they say where they came from”（凭据提醒没有版本块、没有两种免提醒、有三个稍后提醒与归档；稍后提醒后页面、侧栏徽标、铃铛同步少 1 并出现在“已降噪”、重新打开后恢复；归档后在“已归档”用“重新打开”按钮放回；工具运行提醒的形状；铃铛里凭据提醒写“· 凭据 · 未读”且没有“项目协作”；axe）
- [x] 4.3 提醒页上方一行后台观察状态 | evidence: `tests/observation-line.test.ts` 5 项（每 10 分钟、上次几分钟前读了几页新增恢复几条、下次、是否接收人；读不成只算处数不含错误码/连接/地址；没跑过、不是接收人、范围没人接收；关着/配置有问题/没在运行；小时与“马上”）；浏览器旅程 “the reminders page says what background observation did, in counts”

## 5. 夹具与旅程

- [x] 5.1 `scripts/fixture-preview.ts`：`FIXTURE_BACKGROUND=on` 开后台观察但只在 `POST /__fixture/observe`（启动时打印的密钥）时跑一个周期，`?skew_days=` 把循环的时钟往前拨，让记录的到期时间走近 | evidence: 旅程用它（只在 `FIXTURE_BACKGROUND=on` 时才有这个路由，密钥不对返回 403；默认夹具与其余检查不变，原有 73 项照常通过）；手工核对：第一个周期对 `fixture-a` 写出 3 条凭据提醒（Gateway 被拒、DriveBridge 7 天内到期、一个未授权连接被拒）、2 条工具运行提醒和任务失败提醒；拨快 2.5 天再跑一个周期，恰好新开 1 条（DriveBridge 进入 1 天内）并恢复 1 条（7 天内那条）
- [x] 5.2 浏览器旅程（`FIXTURE_CREDENTIALS=lifecycle` 加 `FIXTURE_BACKGROUND=on`，一个会记录调用的 `Notification` 替身，Playwright 时钟）：见 3.2、4.2、4.3，另有 “the work queue shows a refused or expiring credential as one renewal item, in place of the blocked service, and links to the renewal steps” | evidence: 见第 6 节旅程结果

## 6. 验证

- [x] 6.1 `bun run typecheck` 通过；`bunx vitest run --testTimeout=90000 --hookTimeout=90000 --maxWorkers=4` 88 个文件 811 项通过（含并行车道当时在工作树里的测试）
- [x] 6.2 `CONTRACT_OWNER_PORT=4385 CONTRACT_API_PORT=4388 bun run test:contract-integration` 46/46
- [x] 6.3 `bun run test:server-boot` 9/9（其中一项在真实进程里等第一个周期，凭据提醒由 `server/index.ts` 接上的钩子写出，日志里没有凭据文件路径）
- [x] 6.4 `bun run build`、`bun run check:public-surface`（783 个文件 0 条发现）通过
- [x] 6.5 变异检查：首轮对 24 处规则各去掉一次——凭据提醒不恢复/不重新打开/钩子抛错也恢复；`cached()` 不看通道与拒绝记录/开放工具缓存返回空；`reopen` 不清稍后提醒、稍后提醒无 30 天上限/允许过去的时间/允许任何状态、路由不查 CSRF；工作队列保留重复的 `service_blocked`/到期也替换阻塞项/只读账号也得到凭据项；桌面通知计划里在前台看到的不算已看到/基线不剔除/一批 4 条/稍后提醒到点不再弹/在前台也弹/正文带标题；重读没有并发保护/隐藏时也读/回到前台不立即读/合并丢掉加载过的更多行；稍后提醒中的行不归“已降噪”——每一处都有 1 到 4 项测试变红，恢复后全部通过。评审跟进后再做 18 处单元级与 2 处旅程级，见 7.9
- [x] 6.6 `I1_UI_PORT=4411 I1_API_PORT=4412 I1_OWNER_PORT=4413 bun run test:browser-journey` 79 项全部通过（原有 73 项加本变更 6 项：桌面通知、稍后提醒与重新打开、稍后提醒自己到点、另一个标签页关掉开关、观察状态一行、工作队列凭据项；提醒页在浅色与深色主题下的 axe 检查在“稍后提醒与重新打开”一项里）。运行中偶尔出现“no runtime errors (rich)”一项因开发服务器按需编译页面模块时 `Failed to fetch dynamically imported module`（每次是不同的页面模块，出现在与本变更无关的 rich 场景里）而失败，重跑不复现，不是本变更引入
- [x] 6.7 `openspec validate yeisme-control-center-reminder-delivery-v1 --strict --no-interactive` 通过；`yeisme-control-center-background-observation-v1` 同样通过

## 7. 评审跟进

- [x] 7.1 桌面通知的“已通知”按事件记，复发的提醒会再弹一次：`noticeMarker()` = 首次出现时间 + 稍后提醒结束时间，账本把已恢复的凭据问题以新的首次出现时间重新打开，所以复发是新事件（用户自己重新打开不是）；一个因没有回答的读数而“恢复后重开”的闪烁在服务端已不可能（见 yeisme-control-center-background-observation-v1 的 5.3） | evidence: `tests/desktop-notifications.test.ts` “notifies a reminder once more when its condition ended and came back as a new incident, and not when nothing changed”（复发弹一次且 `tag` 是同一个编号、再看到不重复、没看到过恢复也照弹、用户重新打开不弹）；`tests/credential-reminders.test.ts` 两个“stays refused through readings that get no answer …”里逐步断言提醒的 `first_seen_at` 与稍后提醒时间不变，也就是 `noticeMarker()` 不变
- [x] 7.2 关掉开关会让同账号的其他标签页停下：每次计划都从存储读开关（`stepDesktop()` 读到关着返回 null，什么也不做不写入），监听 `storage` 事件更新开关与权限，后台读取随之停止 | evidence: `tests/desktop-notifications.test.ts` “a tab's pass over what is stored for the account” 4 项（开关关着时不管有多少新提醒都不弹也不写、首次看到范围只建基线、重置基线、只跟本账号的键）；`tests/reminder-actions.test.ts` 源码守卫（监听 `storage`、计划前重读存储、`if (!step) { setStored(false); return; }`）；浏览器旅程 “desktop notifications: turning the switch off in one tab stops a tab that is out of sight”（后台标签页的开关随另一个标签页关掉而显示关，之后变成未读的提醒不弹；对照：开着时同样的重新打开弹一条）
- [x] 7.3 稍后提醒到点，页面自己走一步：服务端不清 `snoozed_until`，重读回来的行相同，所以分组、各分组数量、首页关注列表按 provider 的 `now` 计算，`now` 在行变化时和每条稍后提醒到点时重新取（`scheduleSnoozeEnd()`），超过计时器上限的稍后提醒分段等待 | evidence: `tests/reminder-refresh.test.ts` “when a snooze ends the page's clock moves on, and the next snooze is waited for” 4 项（等最早的一条并多等一秒再走一步、时钟走过第一条后瞄准第二条、没有稍后提醒或已过期时不排计时器且可取消、30 天的稍后提醒分段等待）；`tests/reminder-actions.test.ts` 源码守卫（提醒页与首页的 memo 依赖 `now`）；浏览器旅程 “reminders: a snooze that ends on its own …”（在一个自己的浏览器上下文里让一条提醒稍后提醒 5 秒，不点不刷新，行离开“已降噪”、两个标签页的数量、侧栏徽标与铃铛都回到原数；检查期间挡掉页面自己的同步，免得它碰巧换掉行；去掉页面时钟的这一步走动该检查变红）
- [x] 7.4 稍后提醒的时间在点选时才算：`snoozeUntil()`，`snoozeActions()` 的 `run` 里重新取时间 | evidence: `tests/reminder-actions.test.ts` “works the end of the snooze out when it is chosen, not when the menu was built”（周一深夜画出菜单、周二早上点：明天上午是周三 09:00，一小时后仍在未来，下周一上午不变）与“sends a time that is still ahead for a menu that was built long before it was used”
- [x] 7.5 每个动作开始时就废掉更早开始的重读：`ChangeClock`、`readUnlessChanged()`，提醒页的动作开始与结束、铃铛的动作开始、`refresh()` 都记一次变更 | evidence: `tests/reminder-refresh.test.ts` “a read that began before a change” 2 项；`tests/reminder-actions.test.ts` 源码守卫（`run` 与 `handle` 在 `await` 之前调 `beginChange()`、`refresh()` 先记变更）
- [x] 7.6 工作队列只在 `service_blocked` 项自己的原因也是凭据问题时才用凭据项替换它 | evidence: `tests/work-queue.test.ts` 改过的替换用例与 “keeps the blocked item whose own reason the credential row does not explain”（owner 拒绝且文件权限不对时两项都在；地址被拒绝的工具与文件权限不对时两项都在；被拒绝后工具暂时读不到时两项都在；凭据读不到且阻塞项就是 `credential_unreadable` 时一项；403 一项）
- [x] 7.7 “已通知”上限（300）不再让旧的未读提醒重弹：页面在前台看到的每一条未读提醒都进基线，超出时先忘不再是未读的 | evidence: `tests/desktop-notifications.test.ts` “counts every unread reminder the page shows as seen, those notified earlier included”、“forgets what is no longer unread before what still is, when it has to forget”、“does not tell an old unread reminder again when its entry has been forgotten, because the page showed it”
- [x] 7.8 权限在浏览器设置里改回“允许”而开关还存着“开”时，下一次计划重置基线，不补发这期间的通知 | evidence: `tests/desktop-notifications.test.ts` “starts the baseline over when asked to, so a permission that came back on its own does not burst”；`tests/reminder-actions.test.ts` 源码守卫（`granted && !wasGranted.current && stored` 置位、`rebase: rebase.current`）；浏览器旅程里“另一个标签页关掉开关”一项在页面重新载入、权限重新授予后经过这一路径
- [x] 7.9 变异检查：单元级 18 处——开放工具的读数说得清时不认 `ok`、钩子的 `unknown` 置空、凭据按最新读数而不是说得清的那次、连接已读过但没有回答时不保留、工作队列无条件替换阻塞项、已通知标记不含首次出现时间、裁剪不先忘不再未读的、在前台只把新的算进基线、`stepDesktop` 不看存储里的开关、不支持重置基线、点选时不重算稍后提醒的时间、长稍后提醒不分段、过期的重读照用、提醒页 memo 不依赖时钟、没有 `storage` 监听、提醒页动作不记变更、`refresh()` 不记变更、铃铛动作不记变更——每一处都有 1 到 4 项测试变红；旅程级 2 处——页面时钟在稍后提醒到点时不走（“自己到点”一项变红）、没有 `storage` 监听（“另一个标签页关掉开关”一项变红），恢复后全部通过
