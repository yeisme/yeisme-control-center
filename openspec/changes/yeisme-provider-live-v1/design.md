## 边界

- 正式客户端是 `client/yeisme-control-center`；v18 OpenDesign 原型继续作为视觉参考。
- Provider 凭据仅由服务端通过用户级文件引用或运行时环境变量读取，浏览器永不接触明文。
- owner 回执是成本真源；估算、未知和已确认状态分开，未知不补零。
- `owner + source_ref` 去重，MCP、Tool、Model 不重复累计。

## 接口

```text
GET  /api/control-center/v1/capabilities
GET  /api/control-center/v1/usage
POST /api/control-center/v1/provider-runs
GET  /api/control-center/v1/provider-runs/:run_ref
GET  /api/control-center/v1/provider-runs/:run_ref/events
POST /api/control-center/v1/provider-runs/:run_ref/reconcile
```

运行状态为 `accepted`、`queued`、`running`、`succeeded`、`failed`、`unknown`、`reconciling`、`reconciled`。未知状态只能查询原任务，不能自动重新提交。

## 实时实现

Provider adapter 使用 MCP `initialize`、`notifications/initialized` 和 `tools/call`，action manifest 必须显式配置。控制中心向浏览器提供同源 SSE；断线后使用同一个 `run_ref` 轮询。当前 v1 的运行投影驻留服务进程内；服务重启后不伪造结果，必须通过 owner 原始引用重新读取，不创建新 attempt。

## 预算

首轮 canary 的内部上限为 CNY 30，分别为 Eikona 15、Scaena 10、Sonora 5。上限只阻断超额提交，不产生客户账单。
