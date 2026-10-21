# 验证记录

## 结论

前端合同、App Shell、任务/请求可见性、响应式详情工作区和 fixture 联调已通过。真实 owner 只读证据保留为独立门；Provider live submit、部署和凭据变更不在本变更范围内，继续保持关闭或待授权。

## 已通过

| 阶段 | 命令 | 结果 | 证据 |
|---|---|---|---|
| CONTRACT | `openspec validate yeisme-control-center-frontend-backend-v1 --strict` | passed | 合同矩阵、设计与 spec 有效 |
| FRONTEND | `bun run typecheck` | passed | TypeScript 无错误 |
| FRONTEND | `bun run test` | passed | 22 files / 141 tests |
| FRONTEND | `bun run build` | passed | Vite production build |
| FRONTEND | `bun run test:app` | passed | `temp/integration-test-runs/app-shell-2026-10-17T13-11-50-436Z` |
| FRONTEND | `bash .claude/skills/yeisme-ui-motion-quality/scripts/check_motion_policy.sh src` | passed | 0 warnings |
| FRONTEND | `bun run check:public-surface` | passed | 240 files / 0 findings |
| INTEGRATION | `bun run test:contract-integration` | passed | 20/20；`temp/integration-test-runs/contract-integration-2026-10-17T13-12-03-694Z` |
| INTEGRATION | `bun run test:browser-journey` | passed | 16/16；`temp/integration-test-runs/browser-journey-2026-10-17T13-12-13-700Z` |
| INTEGRATION | `bun run test:owner-live-read` | passed | `temp/integration-test-runs/real-owner-read-2026-10-17T14-10-16-351Z`；Eikona/Scaena/Sonora 连接读取通过，无 Provider 调用、无写操作 |

## 覆盖范围

- 11 个 App Shell 页面、HashRouter、登录、注销和 scope 切换。
- 统一 typed API client、epoch/AbortController、迟到响应丢弃、coverage/read-state 分类。
- 任务列表、活动/历史、详情、事件、unknown 任务仅重新读取原引用。
- 请求列表与 summary 分离、purpose-gated content:read、审计先行。
- 图片/音频/视频结果预览、短期句柄、锁定内容保持不可用。
- 亮色/暗色、390px 移动布局、键盘导航、Sheet focus restoration、reduced-motion。
- fake owner 降级场景：不可用来源保留可见，其他来源继续展示。
- 真实 owner 只读：Eikona、Scaena、Sonora 的 connection/task read boundary；不执行 Provider submit/cancel。

## 未宣称通过的门

- Provider live submit、重试、未知任务重投和取消：disabled by default。
- 真实 owner 的写操作、部署、DNS/IdP、凭据签发或权限升级：未执行。
- Scaena/其他 owner 的真实任务覆盖不足时，UI 保持 `unknown` / `not_recorded`，不以 fixture 补齐。

## 复验

```bash
bun run typecheck
bun run test
bun run build
bun run test:app
bun run test:contract-integration
bun run test:browser-journey
bun run check:public-surface
```

Race 检测不属于本项目默认验收，本次未运行。
