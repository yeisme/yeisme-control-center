# 控制中心 v10：行动优先与运行证据

v10 是基于 OpenDesign 项目 `yeisme-service-control-center` 当前原型的规格交接，不替代正式客户端的 `admincn-v7`。OpenDesign 设计演示只证明合成数据下的布局和交互方向；它不能证明 owner 合同、浏览器授权、真实任务状态或生产部署。

## 本轮补齐的产品行为

- 总览先显示现在需要处理的事项，再显示 Scaena、Eikona、Sonora 的核心服务摘要和当前作品。
- 服务状态拆成连接、授权、业务就绪、管理能力、观察证据五个维度；`configured`、缓存成功或单一绿色状态都不能推导全链路可用。
- 项目、请求、任务、尝试、网关调用和资产引用使用稳定的非敏感定位串联，返回动作恢复原项目/镜头，不重复提交。
- 未知回包只查询原操作；`stale`、`unauthorized`、`not_supported` 和 `not_provided` 保持不同含义。
- 390px 使用全屏详情，键盘焦点、Escape 和减少动态效果作为一等状态验收。

## 设计交接

OpenDesign v10 预览：`http://127.0.0.1:7456/api/projects/yeisme-service-control-center/raw/design-proposals/control-center-v10/index.html`（当前 daemon 会话有效）。原型同时提供 `README.md`、`brand-spec.md`、`migration-map.md`、`verification.md`、静态检查脚本和 `resources/`，把设计交接拆成可量测的迁移清单。

读取和回读记录写入 `temp/integration-test-runs/`；若 OpenDesign daemon 重启，应重新读取项目元数据和文件，不复用旧 preview URL。原始 `index.html` 仍是 AdminCN v7 入口，v10 作为独立提案，不覆盖正式入口。v10 的设计令牌来自 OpenDesign 项目元数据，正式实现必须映射到本地 AdminCN 令牌，不直接切换项目设计系统。

## 证据分层

| 层 | 可证明什么 | 不能证明什么 |
| --- | --- | --- |
| OpenDesign 原型 | 合成数据下的布局、交互和状态文案 | owner 授权、真实任务、生产可用 |
| 本地客户端 | 组件、路由、fixture、浏览器行为 | 真实 owner 回执、部署和付费能力 |
| owner 合同 | 字段、权限、动作和恢复语义 | 控制中心当前身份已接通 |
| 真实集成 | 当前身份、观察时间和往返结果 | 自动获得其它环境或生产权限 |

## 验证命令

```sh
cd client/yeisme-control-center
openspec validate control-center-v10-admincn-migration --strict
bun run typecheck
bun run test
bun run build
bun run build:demo
```

OpenDesign 原型自身的静态交接检查（在已下载或挂载原型文件的目录执行）为：

```sh
node design-proposals/control-center-v10/verify-static.mjs
node design-proposals/control-center-v10/verify-contrast.mjs
node design-proposals/control-center-v10/record-verification.mjs
```

当前已读到的 v10 设计基线包括：桌面五个间距角色 `32 / 32 / 20 / 24 / 36`、手机 `16 / 20 / 16 / 16 / 44`，以及 `unknown / stale / unauthorized / not_supported` 的显式待决项。它们是迁移和验收输入，不是正式客户端已经全部采用的事实。

目标浏览器脚本沿用项目已有入口；执行前检查脚本范围并使用独立 `CONTROL_CENTER_URL`。不运行 race，不把真实正文、token、provider payload 或完整推理写入证据。

## 与现有文档的关系

- `admincn-v7.md` 仍是正式客户端的视觉与组件约束。
- `control-center-v8-proposal.md` 保留六入口和 owner 边界；v10 细化行动、证据与恢复状态。
- `openspec/changes/control-center-v10-admincn-migration/` 是本轮可执行规格和任务来源。
