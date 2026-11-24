# Yeisme 控制中心：工作队列与跨项目交接

## Why

控制中心已经具备任务观测、失败提醒、服务目录、Auctra 投影和统一动作 Preview，但工作台仍按页面分散展示。用户需要先看到“现在需要处理什么”，再沿原引用查看证据、权限、新鲜度和安全下一步。

## What Changes

- 新增 `yeisme.work_queue.v1` 派生只读投影。
- 首页升级为统一工作队列，不新增第二个全局入口。
- 复用 `NotificationStore`，不新增工作项真源。
- 统一展示任务失败、未知、待审阅、交接、服务阻塞和合同缺口。
- 通过安全 `LaunchContext` 连接 Auctra、Scaena 和 Muweave；Muweave 直接读取暂保留为 `needs_contract`。
- 工作项动作只提供现有安全 Preview，不扩展 Provider 生成、自动重试、远程 Shell 或账本写入。

## Owner Boundary

控制中心只拥有跨项目投影、筛选、证据显示、Preview 和受控返回路由。Auctra、Eikona、Sonora、Scaena 和 Muweave 继续拥有各自的领域状态、内容、Provider、账本、权限和持久化。
