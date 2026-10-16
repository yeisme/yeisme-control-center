# Yeisme Control Center

Yeisme Control Center 是正式 TypeScript React 前端：默认读取真实授权范围、owner 任务、资产、能力和用量。当前阶段优先真实只读，未接入正式 owner 写合同的动作保持关闭。

领域状态仍由 Eikona、Scaena、Sonora 和其他 owner 持有。owner 未提供项目进度、制作单元、审阅或交付合同的字段保持未知，不使用 fixture 补齐。

## 常用命令

```bash
bun install --frozen-lockfile
bun run typecheck
bun run test
bun run build
bun run preview:real
bun run test:app
bun run test:owner-live-read
bun run check:public-surface
```

`test:app` 验证正式 App Shell、HashRouter、真实入口和无 demo API 请求；真实只读预览使用 `bun run test:preview:real`。

前端沿用既有原型的视觉方向，不再依赖 OpenDesign。视觉审计使用项目级 Taste 快照与 `better-ui`，页面实现位于 `src/`，以正式 API 和统一 App Shell 为准。技能 profile 校验和同步：

```bash
scripts/skills.sh profile validate client/yeisme-control-center
scripts/skills.sh sync-target client/yeisme-control-center
```

默认开发入口：

```bash
bun run dev
```

真实开发预览使用临时配置读取当前 owner 连接，退出后自动清理临时密码和配置：

```bash
export YEISME_PREVIEW_PASSWORD='仅用于本次预览的临时密码'
bun run preview:real
```

受控局域网联调：

```bash
YEISME_PREVIEW_BIND=0.0.0.0 YEISME_PREVIEW_UI_HOST=0.0.0.0 bun run preview:real
```

## 运行边界

- live 默认只读，不存在 demo 回退。
- 前端只调用正式 session、services、connections、capabilities、usage、tasks 和 artifact 接口。
- Provider live、项目创建、团队邀请、审阅写入和交付发送仍是独立授权合同。
- 不提交真实内网地址、凭据、Provider payload 或任务正文。
- 不运行 race。

部署与接入说明见 [docs/lan-deployment.md](docs/lan-deployment.md)，当前状态见 [docs/current-status.md](docs/current-status.md)。
