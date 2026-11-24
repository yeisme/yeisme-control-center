# 设计

## 数据流

```text
TaskConnections + NotificationStore + Auctra projection + service observations
                                  ↓
                       WorkQueueProjection
                                  ↓
              GET /api/control-center/v1/work-queue
                                  ↓
             Home work queue + WorkQueueInspector
```

工作队列每次按当前 scope 派生，不写入 owner 数据，也不创建第二任务调度器。失败提醒继续使用现有失败指纹和提醒账本。

## 合同

`GET /api/control-center/v1/work-queue` 支持 `scope`、签名 `cursor`、`limit`、`kind`、`owner` 和 `state`。响应使用 `yeisme.work_queue.v1`、session epoch、来源 coverage、统计和安全引用。

`work_ref` 使用服务端生成的 opaque reference。`safe_links` 只允许控制中心内部目标或受控 `yeisme.control_center.launch_context.v1`，不接受任意 URL、凭据或 Provider payload。

## 排序与状态

排序顺序为风险优先、再按 observed_at 倒序、owner 和 source_ref 稳定排序。blocked/unknown/unavailable/conflict 为 critical；waiting_review/needs_contract 为 high；handoff_ready 为 normal；stale/partial 为 low。

来源缺失保持 `unknown`、`partial`、`stale`、`unavailable` 或 `needs_contract`，不补成成功或零值。Muweave 只生成受控启动上下文，直接读取缺口显示 `needs_contract`。

## 页面

首页继续是唯一全局入口。工作项点击使用 `work_item` 查询参数打开统一 Inspector；任务选择不自动打开媒体。Inspector 显示概览、来源证据、动作 Preview 和交接入口。Preview 只生成规范化摘要、阻断原因和 digest，不执行 Confirm。

## 兼容与安全

- 不改变既有 `/tasks`、`/notifications`、`/actions` 和 Auctra 路由。
- 游标绑定 session、scope、epoch、过滤器和排序版本。
- Scope、session epoch 或权限变化时由现有读取守卫丢弃迟到响应。
- 不把工作项数量解释为业务成功率。
- 不把 fixture 或本地合同证据升级为真实 owner 或 Provider 证据。
