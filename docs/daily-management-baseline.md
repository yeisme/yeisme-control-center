# 日常管理基线与能力清单

本文件由 scripts/daily-management-spec.ts 生成，产品目录真源 src/service-directory.ts。基线取证为 2026-10-08 本次本地检查，不代表逐服务线上验收。

## 已确认事实
- Open Design MCP 读取了项目 yeisme-service-control-center 的元数据、index.html、docs/README.md 与 docs/capability-matrix.md。主入口仍是 AdminCN 六入口；后续 MCP 会话过期，未重新生成或修改原型。
- client/yeisme-control-center 已有 React/Vite/Bun 代码、个人登录、有限取消、媒体和任务测试。独立 Git 尚无初始提交，本次保留全部已有文件。
- 本机 qianxi-node 网卡持有 10.10.1.101。yeisme-lan-eikona/scaena/sonora.service 为 active/running；端口分别由已存在单元描述指向 18976/18979/18980。这只证明进程状态。
- 用户级 ~/.config/yeisme-control-center 不存在；没有取得控制中心 observer 授权证明。单元文件未出现 observer 字样，但可能由其他配置提供，不能据此断言服务不支持。
- 443 已被既有 ingress 占用；本次无修改。TLS 连接没有取到证书，不能视为安全入口已可用。
- 本项目 AGENTS.md 仍禁止真实部署、实际授权变更和生产写；待解决准入冲突，不自动覆盖。

## 产品目录

| 项目 | 类型 | owner | 本地适配 | 实例/身份/真实验收 | 缺口 |
| --- | --- | --- | --- | --- | --- |
| Scaena | service | agent/scaena | task_observation | 进程运行；用户授权与真实读取未验收 | 需独立项目观测授权；媒体与有限取消另外授权。 |
| Eikona | service | cli/eikona | task_observation | 进程运行；用户授权与真实读取未验收 | 需独立项目观测授权；媒体与有限取消另外授权。 |
| Sonora | service | cli/sonora | task_observation | 进程运行；用户授权与真实读取未验收 | 需独立项目观测授权；媒体与有限取消另外授权。 |
| 个人 MCP Gateway | service | mcp/gateway | not_integrated | 未核验 | 尚无控制中心适配；不复用 Agent 管理凭据。 |
| Aigora | service | apigateway/aigora | request_projection | 未核验 | 需独立 OIDC 用户委托；不与个人网关合并权限。 |
| DriveBridge | service | cli/drivebridge | not_integrated | 未核验 | 控制中心传输、容量和授权投影尚未接入。 |
| Auctra | service | cli/auctra | not_integrated | 未核验 | 控制中心管理读取合同待核验；不复制正文。 |
| Anatomia | service | agent/anatomia | not_integrated | 未核验 | 任务和诊断投影尚未接入。 |
| Pinax | local_tool | cli/pinax | not_integrated | 未核验 | 远程管理 backing 未确认；不读取私有 vault。 |
| Capsa | service | backend-server/capsa | not_integrated | 未核验 | 只读摘要待适配；不解密用户内容。 |
| Manju | service | backend-server/manju | not_integrated | 未核验 | 当前部署及公开观测合同待核验。 |
| Template Registry | service | backend-server/template-registry | not_integrated | 未核验 | 版本目录投影待 typed adapter。 |
| Quaestor | local_tool | cli/quaestor | not_integrated | 未核验 | 远程管理合同未确认。 |
| Digital Human / OpenTalking | service | agent/digital-human | not_integrated | 未核验 | 现行 OpenTalking 与旧目录描述不同；须按当前公开合同接入。 |
| Open Design | service | OpenDesign MCP | not_integrated | 未核验 | 设计读取已用于本次交接，浏览器用户接入未配置。 |
| 片场 | workspace | client/scaena-studio | not_integrated | 未核验 | 需固定 Studio origin 与明确作品引用；不承诺跨应用 SSO。 |
| SoloCut | design | OpenDesign / solocut-agent-editor | not_integrated | 未核验 | 当前仅确认设计原型，不是已部署业务应用。 |
| LayerLab | design | OpenDesign / layerlab-agent-design-studio | not_integrated | 未核验 | 当前仅确认设计原型，不是已部署业务应用。 |
| Firecrawl | service | backend-server/firecrawl | not_integrated | 未核验 | 任务、限流与审计投影尚未接入。 |
| Gitea MCP | service | mcp/gitea-mcp | not_integrated | 未核验 | 仅作工程关联；写操作保留原批准合同。 |
| Blender MCP | local_tool | mcp/blender-mcp | not_integrated | 未核验 | 宿主与观测合同未接入，不建立远程 Shell。 |
| credentialctl | local_tool | cli/credentialctl | not_integrated | 未核验 | 只展示安全状态，不展示或复制秘密。 |
| Runtime Plane | local_tool | backend-server/client-runtime | not_integrated | 未核验 | 实验性工具，不作为默认远程执行入口。 |
| 漫剧榜单 | local_tool | tools/manju-hotlist | not_integrated | 未核验 | 本地工具，不新增常驻服务、不恢复 Radar。 |
| Server Quality Assessor | local_tool | cli/server-quality-assessor | not_integrated | 未核验 | 报告读取尚未适配，不自动发起压力测试。 |
| Yeisme Dist | local_tool | cli/yeisme-dist | not_integrated | 未核验 | 版本目录待适配，不触发真实发布或升级。 |

## 排除与待核验
Yeitra、Radar、旧 Workbench、Ordo 已退役，不恢复；Open Design 遗留 3D 页面不代表 Yeitra 仍可管理。cli/mediahub 与 backend-server/n8n 当前仅有空目录，无 README/应用合同，暂不登记为现存产品。agent/logs、run、temp 及同类目录是运行产物，不是服务。新发现的实际个人服务由同一目录扩展，不另建领域后端。

## 验收对象
核心三服务各需要：固定实例、合法 project-scoped observer、至少一个现存任务及可用结果、明确内容读取权限。缺任何一项不自动创建付费样本或扩大权限。目录覆盖与真实接通分别记录；项目清单不是运行监控结果。
