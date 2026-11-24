# yeisme-control-center-attention-handoff-v1

控制中心工作队列与跨项目只读交接。工作队列是 scope-bound 派生投影，不拥有任何 owner 的领域真源。

实现入口：`src/shared/work-queue.ts`、`server/work-queue.ts`、`src/pages/home/HomePage.tsx` 和 `src/pages/home/WorkQueueInspector.tsx`。

验证从控制中心子项目运行：

```bash
cd client/yeisme-control-center
bun run typecheck
bun run test -- tests/work-queue.test.ts
```
