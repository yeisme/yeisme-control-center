# Tasks

## 1. 身份与密钥

- [x] 1.1 `server/task-connections.ts`：`taskIdentity`、`taskIdentityOf`、`signTaskIdentity`；`TaskConnections` 可注入签名密钥；游标签名与任务身份分开
- [x] 1.2 迁移 0009：`control_state`、`notification_mute_rules`、`task_notifications.task_identity` 与 `recovered_at`；`taskSigningKey(db)`

## 2. 提醒账本

- [x] 2.1 指纹改用身份；同步时刷新任务键；同一失败版本按处理程度最高的行显示
- [x] 2.2 一次性修复 `rekeyNotifications`（原地、保留 id、事务内标记），启动时执行，失败不阻止启动；副本演练脚本
- [x] 2.3 统一未读口径 `countsAsUnread`；服务端按全部行计数，并返回 `attention`
- [x] 2.4 长期免提醒规则（任务、owner + 错误码），以及列表与撤销接口
- [x] 2.5 已恢复：经 owner 复核后标记，不计数
- [x] 2.6 每行按自己的范围执行操作；请求体上限对齐

## 3. 界面

- [x] 3.1 侧栏徽标、铃铛、提醒页使用同一未读数；弹层与筛选使用同一规则
- [x] 3.2 提醒页：“此任务以后都免提醒”“相同错误码以后都免提醒”、规则列表与撤销、“已恢复”标签、加载更多
- [x] 3.3 任务详情与首页工作队列按身份匹配；已处理的失败版本不再出现在首页

## 4. 验证

- [x] 4.1 单元测试 `tests/reminder-identity.test.ts`（重启、密钥、修复、规则、恢复）与工作队列测试
- [x] 4.2 `verify-server-boot.ts`：真实进程重启后密钥不变，旧重复提醒被修复一次
- [x] 4.3 真实库副本演练：96 行、15 组，未读从 63 降到 13，完整性检查通过
- [x] 4.4 浏览器旅程：确认后侧栏徽标与铃铛同步减少；免提醒规则可创建、可撤销
