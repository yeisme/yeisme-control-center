# Control Center 糯米技能工作流运营投影

Control Center 只负责跨项目运营可见性，不复制 Eikona、Scaena、Auctra 或 Sonora 的领域状态。

## 首要投影

- owner、project、actor 和授权范围；
- plan、operation、attempt、worker 和 event cursor；
- 成本状态、预算占用和结算状态；
- artifact、digest、grant、review、adoption 和 export；
- blocker、repair action、unknown 和 reconcile；
- 资产替换的影响范围和当前后继关系。

## 不提供的功能

- 不在控制中心选择 Provider 或模型；
- 不直接修改图片 Prompt、视频参数或 ProductionGraph；
- 不把项目 grant 当成 owner scope；
- 不用个人凭据补齐组织委托；
- 不把 fixture、HTTP 200 或 MCP inventory 显示成生产成功。

## 运行状态

控制中心使用公共状态导航，保留 owner `native_state`：

```text
planned | queued | running | waiting_review | partial |
blocked | succeeded | failed | cancelled | unknown
```

`unknown` 的唯一主动作是“查询原操作”。重试按钮只在 owner 明确返回 retryable terminal failure 且有新的计划和幂等键时出现。

## 资产替换视图

替换详情应分为：

1. 原始资产和原始视频；
2. 受影响的使用点；
3. 新候选或派生 operation；
4. preview、confirm、review、adopt 和 export 状态；
5. rollback 与旧版本保留状态。

成功生成不等于采用，采用不等于发布。所有层级必须独立显示。

## 真实入口

Control Center 通过 owner 的 HTTP/SDK/MCP adapter 读取，不通过远程 Shell、浏览器服务密钥或私有目录。无 CLI 的客户端仍可通过 `tools/list`、`inputSchema`、resource 和 operation receipt 完成发现与恢复。
