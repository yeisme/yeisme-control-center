# v18 展示数据合同

原型只定义前端展示模型和本地演示 API，不替代 owner 真源。

前端通过同源 `/api/control-center/v1/workspace-v18/*` 读取和更新内存状态。演示 API 不访问 Provider、不写数据库，也不返回真实费用、发票、支付或授权事实。

## v18.1 能力和用量投影

`capabilityCatalog` 用于展示模型、MCP Server 和 Tool 的登记、配置、授权、可调用与最近观察状态。目录登记不等于可调用。

`usage` 使用来源唯一事件、Trace 和 `sourceRef` 关联项目、成员、模型、MCP、Tool、计量单位、上游成本和成本状态。`confirmed`、`estimated`、`pending`、`unknown` 保持分开；缺失成本不补零。MCP 下游模型成本只进入总成本一次。

本投影没有发票号、付款状态、余额、退款或客户收费字段。预算只用于内部可视化和预警，不阻止调用。

## 生命周期

```text
CreationTask.status
  queued → running → succeeded → waiting_review

AssetVersion.state
  candidate → adopted

ReviewDecision.state
  pending → approved | changes_requested

DeliveryPackage.state
  missing → ready → included
```

项目详情 tab 使用 URL 查询参数 `project` 与 `tab`，有效 tab 为 `overview`、`units`、`assets`、`tasks`、`review`、`delivery`。

`AssetVersion.contentState`、`downloadable` 和 `downloadReason` 独立表达内容字节和下载权限。下载演示句柄短时有效，不会改变采用状态或交付状态。

## 来源与完整性

每个任务包含 `source: design_fixture` 和 `completeness`。`unknown` 只表示当前结果无法确认；它不会被自动转成失败，也不会触发重试。

## 正式接线缺口

正式实现仍需要 owner 提供授权、幂等提交、结果读取、审阅写入、采用版本回读、交付包创建和用量合同。v18 不模拟这些写入的成功回执。
