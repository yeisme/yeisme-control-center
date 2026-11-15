## Why
MCP任务缺少持续可见的执行进展和产物入口，需要个人内网控制台和片场共享授权事实。

## What Changes
- 任务接受后可发现；阶段、计数、时间和数据新鲜度分开。
- 个人会话与owner连接分离；结果读取独立授权，取消明确确认。
- 不自动恢复执行、重试或付费，不部署、不改真实凭据、不运行race。

## Capabilities
### New Capabilities
- task-observation: 有界授权任务观测及恢复定位。

## Impact
跨项目合同只改自己的合同和源码。split-owner；原任务、权限、账本仍归领域owner。
