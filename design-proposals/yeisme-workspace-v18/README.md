# Yeisme Workspace v18.1

Yeisme Workspace v18.1 是当前正式 Control Center 的视觉与交互基线。它把项目、制作单元、AI 创作、任务、资产版本、审阅、交付、模型与工具、用量与成本串成统一工作流。

根入口是唯一客户端页面：`/`。默认读取真实只读数据；owner 服务仍是领域真源。

当前 v18.1 规范与实现共同维护，旧版本原型不再作为运行或构建输入。

## 演示边界

- 真实前端只读取正式 owner 合同。
- Provider submit、任务推进、版本采用和交付发送没有正式合同前保持关闭。
- 用量与成本页面只展示演示用量、可确认上游成本、内部预算观察和未知状态，不接入发票、支付、退款、余额扣减或客户计费。
- MCP 与 Tool 的下游模型成本只在总成本中归因一次，不按页面层级重复累计。
- `design_fixture`、`partial`、`unknown`、`waiting_review` 等状态保留其原始含义。
- 页面中的组织角色是产品体验模型，不等同于正式授权角色。

## 本地运行

### 完整前后端演示

终端一启动内存 API 服务：

```bash
cd /home/yeshugen/workplace/yeisme-agent/client/yeisme-control-center
bun install --frozen-lockfile
bun run build
bun run dev
```

打开 `http://127.0.0.1:4298/`：

```bash
cd /home/yeshugen/workplace/yeisme-agent/client/yeisme-control-center
V18_API_ORIGIN=http://127.0.0.1:4312 bun run dev
```

Vite 端口若被占用会自动选择下一个端口。

## 验证

```bash
bun run test:app
```

验证 Vite 代理路径时，将 `V18_URL` 替换为实际 Vite 地址。

## 本地 API

- `GET /api/control-center/v1/session`
- `GET /api/control-center/v1/capabilities?scope=...`
- `GET /api/control-center/v1/usage?scope=...`
- `GET /api/control-center/v1/tasks?scope=...&mode=active|history`

演示 API 只在显式 demo 配置下开放，服务重启后状态重置。

正式 API 的 `capabilities` 与 `usage` 只读投影用于能力目录、成本趋势、项目归因和用量明细，不代表正式 owner 写入合同。

v18.1 增加项目 URL tab、登录态门控、图像／音频／视频／文本四类创作设置表单，以及授权演示下载。未登录时使用控制中心个人登录合同；下载只返回短时同源演示句柄，不暴露 owner URL 或凭据。

验证证据写入客户端的 `temp/integration-test-runs/design-v18-<run-id>/`。
