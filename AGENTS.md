# Yeisme 控制中心

独立 React/Vite/Bun 客户端，server/ 为同源只读聚合层。复用 AdminCN/Radix/Lucide；领域请求、内容档案、身份授权、资产及账本归各 owner。默认真实模式，只有明确 mode=demo 或演示构建才加载样例。禁止静默回退演示、浏览器服务密钥、日志/证据正文、远程 Shell、生产写操作和 race。

现行界面为 AdminCN Free 固定 dd1afd2f3a794ea9e746197de314f81d43670ea1 与六入口工作区，以 docs/admincn-v7.md 为准。正式与演示共用展示组件，组织高级能力保留于组织设置；不得恢复重复范围栏与常驻二级导航。请求信息、多租户只读合同及 owner 边界继续沿用。保留其他工作区改动。不得创建远程仓、提交推送、部署真实服务、新增 IdP 注册或更改实际授权。原 OpenDesign 的演示更新按用户明确授权执行，发布前检查活动写入与基线，资源先写、入口最后，逐文件回读。

## 本次内网交付专项准入（2026-10-08）

用户在确认日常管理目标后明确批准继续：允许仅将本控制中心部署到 `10.10.1.101` 的独立 HTTPS 入口，并安全初始化对话指定的 `yeisme` 最高管理员。此专项准入覆盖上文针对本控制中心的历史禁止部署条款，不扩大为所有服务的部署或授权权限。使用独立端口、进程、运行配置与本地 CA，不覆盖现有 443 ingress；只保存密码强哈希，不写入真实明文。CA 信任安装由访问设备操作者决定，不自动改系统信任库。

三服务优先使用已有合法、项目限定的 observer 文件引用；如果没有，先给出具体签发和必要服务调整方案，再请求授权。不得签发新 owner 凭据、升级/重启 owner、复用 Agent 管理 key、付费生成或执行真实取消。未接通不能宣称真实闭环完成。

验证使用 bun run typecheck、bun run test、bun run build、bun run test:ui；运行前检查脚本。证据写 temp/integration-test-runs，正文不写入证据。配置与状态用 scripts/ 下命令生成，普通说明文档可直接维护。

## 本域 Skills

profile：根仓 `.skills/profiles/targets/client/yeisme-control-center.txt`。

- `yeisme-coding-execution-driver`：本地 TypeScript/React/Bun 实现、修复和聚焦验证。
- `yeisme-frontend-design-router`：OpenDesign handoff、页面结构、交互状态和 UI 规格。
- `yeisme-frontend-quality-workflow`：响应式、可访问性、浏览器和视觉质量检查。
- `project-integration-test-evidence`：跨 server/client 或真实 observer 的集成证据。

`.agents/skills/` 与 `.claude/skills/` 是生成运行副本，不手工编辑。变更 profile 后从根仓执行：

```bash
scripts/skills.sh profile show client/yeisme-control-center
scripts/skills.sh profile validate client/yeisme-control-center
scripts/skills.sh sync-target client/yeisme-control-center
scripts/skills.sh validate-subprojects-runtime
```
