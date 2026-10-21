# 实施任务

- [x] 1.1 固定 `work_queue.v1` 类型、优先级、筛选、统计和 LaunchContext。
- [x] 1.2 实现服务端派生投影、来源 coverage、稳定排序和签名分页。
- [x] 1.3 接入首页工作队列、筛选按钮和 `work_item` Inspector。
- [x] 1.4 接入动作 Preview 展示，不执行 Confirm。
- [x] 1.5 添加工作队列纯函数测试和 Auctra/Muweave 合同缺口测试。
- [x] 2.1 完成本地合同集成、server boot、类型、单元、App 静态门和构建；fixture 浏览器旅程保留环境级失败证据，不将其升级为通过。
- [ ] 2.2 复用现有真实 owner 只读验证，确认 Eikona、Sonora、Scaena 来源状态不被升级。

## 验证命令

```bash
cd client/yeisme-control-center
bun run typecheck
bun run test -- tests/work-queue.test.ts tests/notifications.test.ts tests/auctra-authoring.test.ts
bun run test:contract-integration
bun run test:server-boot
bun run test:browser-journey
bun run test:ci:browser
bun run test:owner-live-read
bun run test
bun run build
bun run test:app
```

所有真实读取、Provider、部署和发布证据分开记录；本变更不运行 race。

本轮证据：server boot 6/6、contract integration 21/21、完整单元 33 files/191 tests、App 静态门 4/4、typecheck 和 build 通过。浏览器旅程在独立端口重跑时大部分场景通过，但登录等待与 `ERR_NETWORK_CHANGED` 仍为环境级失败；CI browser 端口启动也未形成有效证据，因此 2.2 和最终浏览器门保持未完成。

既有真实 owner 只读入口通过：`temp/integration-test-runs/real-owner-read-2026-10-19T17-30-03-781Z`；Eikona/Sonora 有历史任务读取，Scaena 当前无观察任务，Provider submit gate 仍保持 disabled。
