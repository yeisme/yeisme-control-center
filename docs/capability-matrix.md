# 全生态能力与 owner 矩阵

本表由原型目录生成；所有 UI 状态为设计样例，接入状态不代表实际部署已验证。

| 项目 | 类型 | canonical owner | 管理能力 | 当前接口交接缺口 |
| --- | --- | --- | --- | --- |
| Scaena | 远程服务 | agent/scaena | 生产项目、视频任务、原任务对账、审阅与交付 | 服务配置与团队授权管理需补充公开接口 |
| Eikona | 远程服务 | cli/eikona | 图像任务、视觉资产、审阅与血缘、能力发现 | 统一配置修订与成员权限投影需补充 |
| Sonora | 远程服务 | cli/sonora | 语言计划、渲染任务、音频资产、权利与交接 | 远程配置、使用量及角色投影需补充 |
| Auctra | 远程服务 | cli/auctra | 作品与修订、审阅提案、接受版本、制作交接 | 跨用户管理视图待合同确认 |
| Anatomia | 远程服务 | agent/anatomia | 分析任务、时序证据、审阅快照、来源交接 | 服务配置与运行指标待投影 |
| DriveBridge | 远程服务 | cli/drivebridge | 文件版本、传输队列、容量摘要、受管范围 | 统一授权与传输事件消费待接线 |
| Pinax | 本地工具 | cli/pinax | 库与索引状态、笔记引用、待审写入、知识关系 | 没有确认的远程管理 backing，保留本地消费者入口 |
| Manju | 远程服务 | backend-server/manju | 项目知识检索、证据读取、范围隔离 | 主体资产与冻结资料包仍需对应 owner 合同 |
| Capsa | 远程服务 | backend-server/capsa | 同步摘要、设备状态、冲突引用 | 控制中心只读摘要尚需适配 |
| Aigora | 远程服务 | apigateway/aigora | 网关观测、模型路由、MCP 注册、访问治理 | 企业身份与团队治理；详细操作进入现有控制台 |
| credentialctl | 本地工具 | cli/credentialctl | 来源状态、安全引用、就绪检查 | 不通过控制中心解析或展示秘密 |
| Template Registry | 远程服务 | backend-server/template-registry | 模板目录、固定版本、发行状态、审计引用 | 目录与版本消费待 typed adapter |
| Quaestor | 本地工具 | cli/quaestor | 研究项目、证据状态、实验记录 | 远程管理接口未确认 |
| Digital Human | 远程服务 | agent/digital-human | 会话状态、同意状态、预算摘要 | 当前部署与公开管理合同需要 owner 验证 |
| Runtime Plane | 本地工具 | backend-server/client-runtime | 运行时发现、能力就绪、受控执行引用 | 实验性本机 broker，不作为默认远程执行入口 |
| Firecrawl | 远程服务 | backend-server/firecrawl | 采集任务、来源引用、限流摘要 | 统一使用量与审计投影待接线 |
| Gitea MCP | 远程服务 | mcp/gitea-mcp | 工具发现、仓库引用、任务关联 | 写操作继续使用原权限与批准合同 |
| Blender MCP | 本地工具 | mcp/blender-mcp | 连接状态、能力发现、场景操作引用 | 无远程宿主即不可执行；不创建第二场景真源 |
| Yeitra | 专业工作台 | client/yeitra | 导演工作台、固定场景交接 | 正式三维状态归 Yeitra；此入口为原型 |
| LayerLab | 专业工作台 | OpenDesign / LayerLab | 图层工作台、资产引用 | 仅确认设计原型入口 |
| SoloCut | 专业工作台 | OpenDesign / SoloCut | 剪辑工作台、交付引用 | 仅确认设计原型入口 |
| Yeisme Dist | 本地工具 | cli/yeisme-dist | 版本目录、发行证据 | 控制中心不触发真实发行 |
| 漫剧榜单 | 本地工具 | tools/manju-hotlist | 榜单快照、历史比较、安全导出 | 本地工具；来源持续性状态独立核验 |
| 个人 MCP Gateway | 远程服务 | mcp/gateway | 工具目录、客户端授权、调用记录 | 独立维护的个人网关；控制中心读取合同待接入 |
| Server Quality Assessor | 本地工具 | cli/server-quality-assessor | 诊断报告、质量证据 | 仅展示已有报告，不发起压力测试 |

## 支撑内容与库

`.skills/yeisme`、`shared/promptrepo`、`shared/agent-skills-runtime`、`data/yeisme-notes` 与 `data/yeisme-prompt-templates` 作为技能、SDK 或内容库归各自维护方。相关版本与来源通过 Template Registry、Pinax、Runtime Plane 或既有仓库合同查看，不为这些库虚构常驻服务或健康检查。

历史 Workbench、Radar、Ordo 不恢复。个人 MCP Gateway 与 Aigora 企业网关独立维护，不共享凭据或运行状态。
