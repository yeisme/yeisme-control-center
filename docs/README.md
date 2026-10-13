# Yeisme 控制中心交接

## Agent Skills

本项目使用根 profile `.skills/profiles/targets/client/yeisme-control-center.txt`；触发边界见项目根目录 `AGENTS.md` 的“本域 Skills”。运行副本由根仓 `scripts/skills.sh` 生成，不在项目内手改。

当前视觉与组件规范：**admincn-v7 · AdminCN 原版统一与六入口精简**。

- [内网访问、证书信任、运行命令与三服务接入方案](lan-deployment.md)
- [日常管理：本地验证、部署结果与下一步](daily-management-delivery.md)
- [现存产品与真实接入基线](daily-management-baseline.md)
- [具名个人账号与独立激活](personal-task-observation.md)
- [界面、组件、路由与验收规范](admincn-v7.md)
- [v10 行动优先、运行证据与恢复规格](control-center-v10-readiness.md)
- [侧栏、全屏详情与类别图标](sidebar-motion.md)
- [本轮验证记录](verification-v7.md)
- [请求字段、内容读取与统计口径](request-visibility.md)
- [四服务能力与证据矩阵](source-capability-matrix.md)
- [全生态能力归属](capability-matrix.md)
- [OIDC与只读接入](live-read-integration.md)
- [片场独立交接待办](frame-integration-handoff.md)

正式客户端默认真实模式；OpenDesign明确为设计演示。读取失败不能回退到样例。六入口基线位于 `openspec/changes/unify-admincn-six-entry-workspace/`，v10 行动、证据与迁移规格位于 `openspec/changes/control-center-v10-admincn-migration/`，原请求信息与 owner 接入变更继续保留。

历史材料保留用于追溯：[AdminCN v5](http://10.10.1.101:7456/api/projects/yeisme-service-control-center/raw/docs/admincn-design.md)、[右侧工作区](http://10.10.1.101:7456/api/projects/yeisme-service-control-center/raw/docs/right-workspace.md)、[早期视觉](http://10.10.1.101:7456/api/projects/yeisme-service-control-center/raw/docs/precision-design.md)。界面冲突以v7为准，领域合同与恢复规则继续沿用。

```sh
bun install --frozen-lockfile
bun run typecheck
bun run test
bun run build
bun run build:demo
bun run dev
```

源文件、来源许可、接口规格与测试脚本随源码包提供；截图对照与历史视觉说明在线保留，不重复装入当前源码包。真实请求正文与本地秘密配置不进入源码包或公开预览。
