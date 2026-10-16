# Yeisme Workspace v18.1

Yeisme Workspace v18.1 是面向内容制作团队的独立本地原型。它把项目、制作单元、AI 创作、任务、资产版本、审阅、交付、模型与工具、用量与成本串成一条可点击的演示旅程。

原型入口是客户端的独立 Vite 页面：`/workspace-v18.html`。正式控制中心、服务目录、v17 原型和 owner 服务均保持不变。

OpenDesign 同步入口为项目 `yeisme-service-control-center` 的根 `index.html`。当前根入口已更新为 v18.1，后续视觉原型优先从该入口读取；历史 v17 文件仍保留在 `design-proposals/control-center-v17/`。

## 演示边界

- 所有提交、任务推进、版本采用和交付清单都只更新浏览器内存状态。
- 不调用 Provider、不上传文件、不写入数据库、不产生真实费用。
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
bun run serve:v18
```

服务监听 `http://127.0.0.1:4313`。直接打开 `http://127.0.0.1:4313/workspace-v18.html`，或在终端二启动 Vite 代理：

```bash
cd /home/yeshugen/workplace/yeisme-agent/client/yeisme-control-center
V18_API_ORIGIN=http://127.0.0.1:4313 bun run dev:v18
```

Vite 端口若被占用会自动选择下一个端口。

## 验证

```bash
V18_URL=http://127.0.0.1:4313/workspace-v18.html bun run test:v18
```

验证 Vite 代理路径时，将 `V18_URL` 替换为实际 Vite 地址。

## 本地 API

- `GET /api/control-center/v1/workspace-v18/state`
- `POST /api/control-center/v1/workspace-v18/tasks`
- `POST /api/control-center/v1/workspace-v18/tasks/:id/advance`
- `POST /api/control-center/v1/workspace-v18/reviews/:assetId/approve`
- `POST /api/control-center/v1/workspace-v18/delivery/generate`

演示 API 只在 `bun run serve:v18` 的 loopback 开关下开放，服务重启后状态重置。

v18.1 的 `state` 额外包含 `capabilityCatalog` 与 `usage` 只读投影。它们用于能力目录、成本趋势、项目归因和用量明细，不代表正式 owner 或费用合同。

v18.1 增加项目 URL tab、登录态门控、图像／音频／视频／文本四类创作设置表单，以及授权演示下载。未登录时使用控制中心个人登录合同；下载只返回短时同源演示句柄，不暴露 owner URL 或凭据。

验证证据写入客户端的 `temp/integration-test-runs/design-v18-<run-id>/`。
