# MCP Skills 与模板体验

## 当前交付

控制中心现在把 MCP 连接分成 transport、protocol、discovery 和 invocation。Gateway 页面显示“工具发现成功 · 调用未验证”，不再把 `tools/list` 成功写成调用或资产生产成功。

能力目录新增 Skills 与模板提示。当前官方模板 owner 合同未在本 checkout 证明已发布，因此 image、video、audio、episode 都显示 `needs_contract`，并明确不能执行生成。

## 安全边界

`src/shared/skill-template-experience.ts` 只接受 ref、version、revision、digest、snapshot 和 blocker。command、script、body、prompt、credential、token、path、url 等字段会被整条拒绝。版本 digest 变化后，已固定选择不会被静默替换，必须重新确认。

## 验证

```bash
bunx vitest run tests/skill-template-experience.test.ts
bun run typecheck
```

## 未完成

远程 GitHub/HTTPS 拉取、Registry catalog adapter、selection 持久化、资产 preflight 的真实 owner 校验和发布验收仍依赖 owner handoff。未接通前不得显示为可执行模板，也不得触发 Provider。
