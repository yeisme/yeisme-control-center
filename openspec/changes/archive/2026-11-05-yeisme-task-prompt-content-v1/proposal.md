## Why

任务检查器的「提示词采集」只显示状态、摘要和引用；即使 owner 观察 key 已带正文授权，用户仍看到「Owner 没有授权读取原始提示词」。控制中心需要一个显式的、先审计再读取的原始提示词入口，而不是把正文塞进元数据或回退演示数据。

## What Changes

- 任务检查器在 `prompt_capture.readable=true` 且存在 `capture_ref` 时显示原始提示词读取入口。
- 服务端新增 `POST /tasks/:task_key/prompt:read`，先写控制中心审计，再通过 owner 的 `control_center.tasks.prompt` 动作读取。
- 正文只保留在当前页面内存，不写 localStorage、服务端持久化、日志或证据；关闭检查器即清除。
- 继续要求个人会话、CSRF、连接 `allow_content` 和 owner 的正文授权；缺失时显示明确拒绝，不伪造内容。

## Capabilities

### New Capabilities
- `control-center-task-prompt-content`: 任务检查器的受控原始提示词读取、审计和错误状态。

## Impact

控制中心 server/client/UI 与本变更测试；owner 的提示词正文、授权、审计和任务绑定仍归 Eikona。不调用生成 Provider、不部署、不修改真实凭据。
