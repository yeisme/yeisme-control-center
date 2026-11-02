# Tasks

## 1. 账号文件与吊销

- [x] 1.1 `SessionAuth.followConfigFile`：一次 `stat` 比对配置文件，变了只重读 `personal.users` 并一次换入；读不到或不是列表则保持原样；被吊销账号的会话立即结束，活动会话换新 epoch；`/auth/methods`、观察循环每个周期、`list/create/revoke` 都先同步 | evidence: `tests/session-hardening.test.ts` 的 CLI 全流程（add、revoke、enable、rotate 不重启）、只取账号列表并换 epoch、坏文件保持原样；`tests/observation-loop.test.ts` 的“follows accounts that personal-config added or revoked”；修改前 21 项失败，变异检查（去掉 `current()` 的同步、去掉结束会话）各让对应测试失败
- [x] 1.2 吊销只增不减：`revoked` 待存集合随每次写文件与每次重读应用，文件记下吊销后解除 | evidence: 同文件 4 项（后续写入不复活、别人改文件不复活、文件记下后可 enable、别人也吊销后可 enable）；变异检查：写文件不带待存吊销、重读不解除待存各让测试失败
- [x] 1.3 `personal-config user add|revoke|enable|rotate` 的输出带 `restart_required: false`，去掉 `enable` 里“重启后生效”的提示 | evidence: 上述 CLI 全流程测试断言四个命令的输出；`tests/personal-config.test.ts` 既有断言不变
- [x] 1.4 `POST /admin/personal-users/{用户名}/revoke` 可达，集合路径只接 GET/POST，其余路径 404/405 | evidence: `account routes are matched exactly` 4 项（空体与 `{}`、创建形状的体发到吊销地址不建号、集合路径仍可创建且重复得 409、其余路径与 viewer）

## 2. 会话

- [x] 2.1 `SessionStore.touch(id, now)`（每分钟至多写一次）与 `maxEpoch()`；`current()` 调用 `touch`，空闲 30 分钟的语义不变 | evidence: `personal sessions and the clock` 3 项（假时钟：20、35、55 分钟仍 200，31 分钟空闲后 401；一分钟内只写一次；12 小时绝对到期不变）；`tests/db-store.test.ts` 2 项；变异检查去掉 `touch` 让 3 项失败
- [x] 2.2 登录限流只计凭据被拒；`login_busy` 与 `login_rate_limited` 分开，登录页分别说明 | evidence: `the sign-in limit` 3 项（连续 7 次成功不占额度、5 次被拒后 429、重叠的登录得 `login_busy` 且不计数、凭据文件问题不计数）；`tests/login-errors.test.ts` 2 项；变异检查（每次尝试都计数）让限流测试失败
- [x] 2.3 新会话 epoch ＝ max(当前毫秒, 已存最大 epoch + 1)；前端收到 `csrf_denied` 重读 `/session` | evidence: `session epochs`（同一毫秒、bump 之后、清空之后都更高）；`tests/session-recovery.test.ts` 3 项（`csrf_denied` 发信号且请求仍带自己的错误、其他拒绝不发、监听者抛错不影响）；`verify-server-boot` 与 `verify-contract-integration` 的 epoch 断言改成相对值
- [x] 2.4 退出登录等服务端确认，失败时保持登录、提示并可重试 | evidence: `tests/session-recovery.test.ts` 的 `signing out` 4 项；浏览器旅程新增两步：服务端拒绝的退出登录保持登录、提示并可重试；陈旧 CSRF 令牌被拒后重读 `/session`、提示“登录状态已在别处更改”且不报“无权访问”（81/81）

## 3. 输入与动作

- [x] 3.1 `pathParam` 取代 21 处 `decodeURIComponent`；内容读取与集合同步的请求体必须是对象；同名并发创建得 409 | evidence: `bad client input is a 400 and not a 503` 3 项（17 条路径的非法转义、`null`/数组/字符串/数字请求体、并发同名创建一个 201 一个 409）
- [x] 3.2 `admin.user.create` 标为不可用并在预览与确认处拒绝（422 `action_unavailable`） | evidence: `account creation is not offered through actions` 3 项；`tests/action-contract.test.ts` 的预览与确认（含旧预览）都拒绝；`tests/viewer-authz.test.ts` 的 403 次序不变

## 4. 用量与进程

- [x] 4.1 `/usage` 按运行的范围过滤；测试数据让范围的 `project` 与 owner 项目不同 | evidence: `tests/provider-live.test.ts`（范围 `project` 改为 `personal` 后原 4 项先失败，修复后通过；新增两个同名范围互不可见）；`tests/db-store.test.ts`；bun:sqlite 上同一查询跑通
- [x] 4.2 Provider 状态轮询整体包在 try 里；`server/index.ts` 安装 `unhandledRejection` 处理器（只记错误码） | evidence: `tests/provider-live.test.ts` 的账本读失败用例（修复前出现 Unhandled Rejection）；`tests/process-guard.test.ts` 3 项，含真实 Bun 进程：有处理器时存活，没有时退出

## 5. 文档与验收

- [x] 5.1 `docs/lan-deployment.md`、`docs/interfaces.md` 写明账号变更无需重启、吊销只增不减、登录限流口径、epoch 与错误映射 | evidence: 两份文档已更新
- [x] 5.2 全部门禁通过 | evidence: `bun run typecheck` 通过；vitest 全量 92 文件 856 项通过（修正前；修正后见 6.8）；`bun run build`；`check:public-surface` 803 个文件 0 个发现；`test:contract-integration` 46/46；`test:server-boot` 9/9；`test:browser-journey` 81/81；`test:public-guide` 13 项

## 6. 安全复查后的修正

- [x] 6.1 配置文件独占锁：`server/config-lock.ts`（`<配置>.lock`，`wx`、0600、pid+时间，等待约 5 秒，过期或持有者已不在则清除），控制中心创建/吊销与 `personal-config` 的每次保存共用；慢工作在取锁前；锁内重读、应用修改与待存吊销、临时文件改名；命令行记下读取时的文件版本，取锁后版本变了就不写并清掉刚做的密钥与摘要 | evidence: `tests/config-lock.test.ts` 12 项（私有锁文件、等待与放弃、持有者已死或超过 30 秒的清除、不删别人的锁、只读目录不报 busy、文件版本、所有者判断）；`tests/account-locking.test.ts` 9 项（复现的竞态：网页吊销后命令行写旧副本被拒且吊销保持；真实命令在等锁期间文件被改，中止并清掉密钥；命令行吊销后服务端写入保留它；写出 0600；`config_busy` 与待存吊销；等得到的锁；崩溃遗留锁；命令行等 5 秒后的中文报错）；去掉版本检查的变异让两项竞态测试失败
- [x] 6.2 每账号上限：闲置会话先清、每账号最多 8 个会话（最早的被结束）、每账号 15 分钟 20 次成功登录（在口令计算与忙标记之前，429 `login_rate_limited`），失败尝试与不存在的名字不占额度 | evidence: `tests/login-limits.test.ts` 7 项（100 个闲置会话不挡管理员登录、普通请求也清闲置、满是在用会话仍 503、超过 8 个会话结束最早的、一个只读账号 100 次登录只成功 20 次且管理员不受影响、预算在忙标记之前检查、失败猜测不占额度也不扩表）；去掉闲置清理、会话淘汰、预算检查各让对应测试失败
- [x] 6.3 不存在的用户名用启动时生成一次的摘要做同样代价的校验，计失败，401，不再因旧版所有者摘要读不到而 503 | evidence: `tests/login-limits.test.ts` 3 项（40 个不存在的名字 5×401 后 429、无 503，与真名错密钥同一个 401 体，旧版所有者自己的摘要读不到仍是 503 且不计数）；改回读旧版摘要的变异让两项失败
- [x] 6.4 读不到账号文件时按文件版本记一次错误代码（无路径），`users: null` 视为空列表；命令行要求运行者就是配置文件所有者并保持 0600 | evidence: `tests/account-rules.test.ts` 的日志用例（invalid_json、users_not_a_list、no_personal_block、EACCES、ENOENT 各记一次且不含路径，`users: null` 视为空列表）；`tests/config-lock.test.ts` 的 `ownerProblem`（假 uid：非所有者报 `other_owner`）；`tests/account-locking.test.ts` 的 0600；真实 `sudo` 场景没有在本机演练（没有 root）
- [x] 6.5 一条“是否启用”规则（`server/personal-users.ts`），用于登录、会话权限、共享项目成员、凭据管理员判断、提醒接收人和命令行；同名多条全部停用并记一次日志；待存吊销在任一同名条目仍启用时不解除 | evidence: `tests/account-rules.test.ts` 11 项（标志值 `true`/缺省才启用，`"false"`、`0`、`null`、`"true"` 都停用；同名全部停用且只记一次不含名字；登录、列表、凭据管理员判断、提醒接收人、共享项目可选成员同一规则；待存吊销在任一同名条目仍启用时不解除；源码守卫）；放宽标志、允许重名、去掉 null 处理的变异各让对应测试失败
- [x] 6.6 被拒 CSRF 令牌：只在页面仍持有该令牌且 10 秒内没有重读过时读一次 `/session`；令牌不同则换会话并提示，相同则停在“服务端拒绝了本页发出的请求”，不再循环 | evidence: `tests/session-recovery.test.ts` 12 项（`staleSignalPlan`、`staleSessionVerdict`、信号带上被拒令牌、代理去掉 Origin 的模拟：一次重读后停在禁止状态）；浏览器旅程新增“同一令牌被拒则读一次会话后停下”一步，并把原“陈旧令牌”一步改成会话读取返回不同令牌（82/82）
- [x] 6.7 `docs/lan-deployment.md` 与 `docs/interfaces.md` 写明锁、每账号上限、所有者规则、启用规则与令牌被拒的处理 | evidence: 文档已更新
- [x] 6.8 全部门禁与 `openspec validate --all --strict` 通过 | evidence: `bun run typecheck` 通过；vitest 全量 96 文件 902 项通过；`bun run build`；`check:public-surface` 803 个文件 0 个发现；`test:contract-integration` 46/46；`test:server-boot` 9/9；`test:browser-journey` 82/82（本机负载很高时偶发 Vite 动态导入失败与 axe 对比度误报，重跑通过）；`test:public-guide` 13 项；`openspec validate --all --strict` 22 项通过
