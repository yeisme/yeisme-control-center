# 核心三服务接入与发布候选

2026-10-10 已按原会话授权完成正式接入及控制中心发布。Sonora、Eikona 四个项目和 Scaena 共六个连接均为 ready；metadata 与 content 合同均已核验。取消、生成、付费调用及未归属项目迁移保持关闭。

## 已实现
- 服务页核心实例卡、合同与授权事实、最近观察、实例任务跳转；普通目录与探测分别读取。
- 总览合并活动/历史异常，显示最近结果；跨页保留任务筛选和历史模式。
- 共用 AdminCN 令牌、服务卡、状态明细和请求处理；结果仍通过同源媒体句柄读取。
- Scaena 修复 gateway 覆盖 scoped-key 认证的问题；匹配静态 key 保持兼容，observer 不回退成 operator。

## 验收证据
- local: temp/integration-test-runs/daily-local-gates-2026-10-09T16-04-13-595Z
- browser: temp/integration-test-runs/daily-frontend-2026-10-09T16-05-59-343Z
- component: temp/integration-test-runs/task-visibility-2026-10-09T15-52-45-070Z
- owners: temp/integration-test-runs/task-processes-2026-10-09T15-54-39-896Z
- candidate: temp/integration-test-runs/intranet-candidate-2026-10-09T16-06-12-394Z
- compatibility: temp/integration-test-runs/scaena-upgrade-preflight-20261009T160205Z
- deployment: temp/integration-test-runs/control-release-2026-10-10T02-40-16-888Z
- live: temp/integration-test-runs/core-services-live-20261010
- final candidate: temp/integration-test-runs/intranet-candidate-2026-10-10T02-39-13-201Z
- final component: temp/integration-test-runs/task-visibility-2026-10-10T02-40-01-755Z
- additive migration rehearsal: temp/integration-test-runs/scaena-upgrade-preflight-20261010T023524Z
- event candidate: temp/integration-test-runs/intranet-candidate-2026-10-10T13-55-22-371Z
- event compatibility: temp/integration-test-runs/scaena-upgrade-preflight-20261010T135600Z
- event component: temp/integration-test-runs/task-visibility-2026-10-10T13-56-00-765Z
- event deployment: temp/integration-test-runs/control-release-2026-10-10T13-56-56-277Z


普通测试92项、真实模式浏览器10组、隔离组件与三owner独立测试进程通过；不代表正式owner已接入。原演示53项首轮52项通过，首项导航超时后单项重验通过。主bundle约722kB告警尚存。

## 已授权并执行的接入变更
| 服务 | 目标与权限 | 必要动作 | 回退 |
| --- | --- | --- | --- |
| Sonora | 18980，服务身份 lan-media；observer 绑定 canonical workspace sonora://project/sonora-lan-mcp-b4e5272583；cancel关闭 | 已升级 canonical workspace 绑定修复，保留服务身份与现有 drop-in；独立 metadata/content observer 已接入 | 恢复原unit及二进制并重启；控制中心disable该连接；不删除业务数据 |
| Eikona | 18976；已注册proj_7fabcb3b7fd7759b、proj_be5b56cb806729f2、proj_91098d990fbb33c8、proj_c44ca3ad9f605a90 | 切换候选eikona，保留原入口、输出根和路由；签发仅上述项目的metadata/content key；operator展示lane受purpose约束，90天有效，不含生成和cancel | 恢复旧二进制/启动配置，撤销新key并disable新连接；保留原运行证据 |
| Scaena | 18979；project_a379a7140c6f2560067534ec | 已切换修复版本；reader key 使用 personal-observer-v1 与 personal-observer-content-v1；access-key:control-center-observer 的项目成员角色为 viewer；原gateway:operator不变 | 恢复旧二进制/配置，撤销新key并移除新viewer membership，disable连接；新增空表保留，不覆盖运行后业务数据 |

最终 Scaena 副本预演新增 center_delegation_records、center_episode_records、center_receipt_records 三张表；既有表定义与行数不变，完整性检查通过。公共迁移现覆盖 gateway 的 delegation 分页，不再依赖 Studio 启动。Eikona 未归属项目的旧运行不迁移；空项目保持真实空列表。

先保存旧二进制、unit、非秘密配置与数据库一致性备份；核对活跃任务，未排空时不重启。按Sonora→Eikona→Scaena依次验证，任何未知提交只查询原身份；不创建付费样本。签发与membership操作均由owner CLI/API完成，不直接改数据库。控制中心connect只登记credential_ref，结果访问单独启用；取消始终关闭。

候选目录：temp/integration-test-runs/intranet-candidate-2026-10-09T16-06-12-394Z/artifacts；摘要含二进制及控制中心资源SHA-256。正式切换前重新核对基线与摘要，不覆盖变化中的运行快照。

## 可重跑命令
在 client/yeisme-control-center 执行：

```bash
bun scripts/verify-daily-backend.ts --full
bun scripts/verify-daily-frontend.ts
bun scripts/verify-task-visibility.ts
bun scripts/verify-task-processes.ts
bun scripts/prepare-intranet-release.ts
python3 scripts/check-scaena-upgrade.py temp/integration-test-runs/intranet-candidate-2026-10-09T16-06-12-394Z/artifacts/scaena-api
bun scripts/record-core-services.ts
openspec validate yeisme-core-services-observation-v2 --strict
```

生产登录验收需要现有管理员的有效登录；不重置密码、不保存Cookie或通过伪造会话绕过登录。项目AGENTS.md要求新owner凭据、升级/重启及实际授权变更在具体方案准备后确认。

## 正式验收结果与边界

- 完整 active/history 分页各三页，六连接全程 ready；活动任务 0，历史任务 36（Sonora 31、Eikona 5、Scaena 0）。不是全平台总量。
- Eikona image/png 与 Sonora audio/mpeg 通过同源媒体入口返回 206，读取各 1024 字节；浏览器真实图片解码和音频 metadata 加载通过（样本时长 33.551748 秒）。证据不保存内容正文或凭据。
- Scaena reader 读取 200、越项目 403、旧 operator 读取 200。正式项目没有媒体样本，未宣称真实 Scaena 媒体下载已验证。
- 两项 Sonora 历史结果被 owner 拒绝，按原授权边界保留；另一已有结果读取成功，不生成测试内容。
- Playwright 使用系统 Chrome 与独立 NSS 信任库验证正式 HTTPS 登录、服务详情、实例跳转、历史结果及 390px 布局；未禁用证书验证。修复长运行 ID 导致的移动端 grid 最小宽度溢出。
- Eikona/Scaena capabilities 现在按独立内容权限及实际服务装配返回 artifact_access；supported 不代表每个旧结果都能读取。
- Scaena gateway 集成回归覆盖 delegation 终页、旧 key 兼容、越项目拒绝及撤销。最终控制中心候选通过 release-specific 组件验收与静态资源 SHA-256 回读。
- 回退副本位于用户私有状态目录 yeisme-lan/control-center-backup-20261010；不得将数据库备份、observer key 或登录配置纳入仓库。
- 2026-10-10 事件合同候选已发布。Scaena 副本预演无 schema 或行数变化；Eikona、Scaena 与控制中心已切换，Sonora 运行版本无需二进制变更。
- 正式读取保持六连接 ready。现有 Eikona run 返回 26 条事件且 gap=false；现有 Sonora music-job 返回 gap=true/not_recorded。当前历史没有 Scaena run 或 Sonora workflow-run，未创建样本，因此不宣称这两类真实事件已出现。
- 正式 HTTPS 登录与 390px 页面通过，无横向溢出。取消、生成、付费调用和凭据轮换均未执行。

