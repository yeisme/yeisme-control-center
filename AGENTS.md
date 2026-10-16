# Yeisme 控制中心

独立 TypeScript React/Vite/Bun 客户端，server/ 为同源只读聚合层。领域请求、内容档案、身份授权、资产及账本归各 owner。应用只使用真实正式接口，不保留 demo 模式或 fixture 回退。禁止静默回退演示、浏览器服务密钥、日志/证据正文、远程 Shell、生产写操作和 race。

现行界面为 Yeisme Control Center，根入口使用 HashRouter 和统一 App Shell，默认真实只读。项目、任务、资产、能力和用量边界继续由 owner 合同决定。不得恢复旧 AdminCN/v17 页面或历史设计入口。保留其他工作区改动。不得创建远程仓、提交推送、部署真实服务、新增 IdP 注册或更改实际授权。

## 本次内网交付专项准入（2026-10-08）

用户在确认日常管理目标后明确批准继续：允许仅将本控制中心部署到 `configured internal origin` 的独立 HTTPS 入口，并安全初始化对话指定的 `yeisme` 最高管理员。此专项准入覆盖上文针对本控制中心的历史禁止部署条款，不扩大为所有服务的部署或授权权限。使用独立端口、进程、运行配置与本地 CA，不覆盖现有 443 ingress；只保存密码强哈希，不写入真实明文。CA 信任安装由访问设备操作者决定，不自动改系统信任库。

三服务优先使用已有合法、项目限定的 observer 文件引用；如果没有，先给出具体签发和必要服务调整方案，再请求授权。不得签发新 owner 凭据、升级/重启 owner、复用 Agent 管理 key、付费生成或执行真实取消。未接通不能宣称真实闭环完成。

验证使用 bun run typecheck、bun run test、bun run build、bun run test:app；运行前检查脚本。证据写 temp/integration-test-runs，正文不写入证据。配置与状态用 scripts/ 下命令生成，普通说明文档可直接维护。

## 本域 Skills

profile：根仓 `.skills/profiles/targets/client/yeisme-control-center.txt`。

- `yeisme-coding-execution-driver`：本地 TypeScript/React/Bun 实现、修复和聚焦验证。
- `yeisme-frontend-design-router`：页面结构、交互状态和 UI 规格路由；本项目不再使用 OpenDesign。
- `yeisme-frontend-quality-workflow`：响应式、可访问性、浏览器和视觉质量检查。
- `project-integration-test-evidence`：跨 server/client 或真实 observer 的集成证据。

Taste 只作为 v18.1 的视觉审计层使用，项目自己的 tokens、状态合同和操作台密度优先。当前目标 profile 同步 `taste-skill`、`better-ui`、`web-design-guidelines` 和 `yeisme-ui-motion-quality`；更新技能后使用：

```bash
scripts/skills.sh profile validate client/yeisme-control-center
scripts/skills.sh sync-target client/yeisme-control-center
```

`.agents/skills/` 与 `.claude/skills/` 是生成运行副本，不手工编辑。变更 profile 后从根仓执行：

```bash
scripts/skills.sh profile show client/yeisme-control-center
scripts/skills.sh profile validate client/yeisme-control-center
scripts/skills.sh sync-target client/yeisme-control-center
scripts/skills.sh validate-subprojects-runtime
```
