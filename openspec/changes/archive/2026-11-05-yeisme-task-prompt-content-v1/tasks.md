# 实施与验收任务

- [x] 1.1 服务端接入 owner 原始提示词动作 | evidence: `server/task-connections.ts` 新增 `promptContent` 与 `control_center.tasks.prompt` 允许动作；`tests/task-connections.test.ts` 43 用例通过，覆盖正文中继与 `allow_content` 拒绝。
- [x] 1.2 增加同源审计路由 | evidence: `server/app.ts` 新增 `POST /tasks/:task_key/prompt:read`，校验个人会话、CSRF、用途和 capture_ref，先写 `tasks.prompt_read` 审计；`server/db/audit.ts` 注册动作；`tests/task-prompt-route.test.ts` 4 用例覆盖成功、CSRF、非法参数和 owner 拒绝。
- [x] 1.3 任务检查器读取入口 | evidence: `src/pages/tasks/TaskDetail.tsx`、`src/components/PromptCaptureReader.tsx`、`src/components/PromptCaptureSummary.tsx`；`bun run typecheck` 通过，`bun run build` 通过。
- [x] 1.4 全量回归与文档 | evidence: `bun run test` 104 文件/979 用例通过；`bun run typecheck`、`bun run build` 通过；本变更 spec 与设计记录；真实 owner 读取、部署和真实授权未执行。
