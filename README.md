# Yeisme 控制中心

当前界面：**admincn-v7 · 六入口 AdminCN 工作区**。界面规格见 [设计与组件规范](docs/admincn-v7.md)。
最新侧栏与全屏详情规范见 [侧栏与动效](docs/sidebar-motion.md)。

新增个人任务观测正在实施：[当前实现与未完成项](docs/task-observation-implementation.md)、[个人配置与独立激活](docs/personal-task-observation.md)、[其他工具接入候选](docs/tool-observation-backlog.md)。对应 `openspec/changes/yeisme-task-visibility-v1/`，尚未完成三owner真实进程全链路验收。

日常管理增量已完成本地实现：[交付状态与待授权项](docs/daily-management-delivery.md)、[现存产品与接入基线](docs/daily-management-baseline.md)。包含具名管理员、26 项服务目录与历史结果。控制中心已部署到 **https://10.10.1.101:8443**；账号、证书信任与运行命令见 [内网部署](docs/lan-deployment.md)。三服务真实接入仍待版本合同和独立observer授权。

正式客户端与受控聚合层。演示和真实数据严格分离，领域真源仍由 Aigora、Scaena、Eikona、Sonora 持有。

```bash
bun install --frozen-lockfile
bun run typecheck
bun run test
bun run build
bun run serve
```

默认打开 http://127.0.0.1:4312 ，未配置统一身份时显示登录接入状态。设计演示使用 `http://127.0.0.1:4312/?mode=demo`。开发：`bun run dev`；Vite 4298 将同源 API 转发至4312，登录时需保证配置的origin与实际访问origin一致。

```bash
node scripts/configure-server.mjs
YEISME_CONTROL_CONFIG=.local/server.json bun run serve
bun run build:demo
bun run test:ui
```

配置文件只含非秘密端点、明确身份绑定和secret文件引用；secret文件0600，不提交或输出。未提供默认内网管理Key，不自动注册IdP，不部署owner服务。公开OpenDesign仅发布 `dist-demo`，不能发布真实配置或正文。

文档：[请求与界面规格](docs/request-visibility.md)、[来源能力矩阵](docs/source-capability-matrix.md)、[接入运行说明](docs/live-read-integration.md)。正式OpenSpec：`openspec/changes/yeisme-request-visibility-v1/`。
