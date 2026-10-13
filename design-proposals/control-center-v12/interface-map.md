# v12 双主题功能与正式接口映射

核对日期：2026-10-12。证据来自当前本地源码与 owner 文档，不是历史部署记忆。这里的“已实现”只表示源码存在；当前会话权限、远端部署版本、真实 Provider 与数据闭环未在本轮验证。

控制中心 BFF 前缀为 `/api/control-center/v1`。浏览器使用同源会话；领域服务通过服务端固定注册连接读取。原型不调用这些接口，表格用于正式迁移交接。

## 已有接口

| 功能 | 正式接口 | 关键规则 | 源码 |
| --- | --- | --- | --- |
| 当前身份 | `GET /session` | 当前身份与允许范围；不推导 owner 管理权限 | `server/app.ts`、`server/auth.ts` |
| 个人登录 / 退出 | `POST /auth/personal`、`POST /auth/logout` | Origin、CSRF、凭据版本、会话清理 | `server/app.ts` |
| 登录方式 | `GET /auth/methods` | 个人与 OIDC 按实际配置呈现 | `server/app.ts` |
| 服务目录 | `GET /services`、`GET /services?observe=1` | 普通读取不主动观察上游；显式观察分层显示 | `server/service-directory.ts` |
| 连接观察 | `GET /connections` | transport、authorization、contract、content、checked_at 独立 | `src/task-observation.ts` |
| 任务列表 | `GET /tasks?mode=active|history&cursors=…` | rows、connections、next_cursors；当前批次筛选；不拼接假全量统计 | `server/task-connections.ts`、`server/app.ts` |
| 原任务定位 | `GET /tasks/resolve?connection=…&project=…&family=…&ref=…` | 四个明确引用；当前 scope 校验；不创建新尝试 | `server/app.ts` |
| 任务详情 | `GET /tasks/{task_key}` | state/native_state、revision、stage、progress、results、allowed_actions、coverage | `src/task-observation.ts` |
| 事件 | `GET /tasks/{task_key}/events?cursor=…` | 原任务授权；游标与列表游标独立 | `server/app.ts` |
| 取消 | `POST /tasks/{task_key}/cancel` | `confirm=true`、`expected_revision`、`idempotency_key`；管理员、CSRF 与 owner 动作许可 | `server/app.ts` |
| 取消结果恢复 | `GET /tasks/{task_key}/cancel-receipt?idempotency_key=…` | unknown/requested 使用原幂等引用查回执，不重复提交 | `src/task-cancel.ts` |
| 结果访问 | `POST /tasks/{task_key}/artifacts/{ref}/access` | purpose 为 preview/download；任务与内容权限独立 | `server/media.ts` |
| 媒体传输 | `GET/HEAD /media/{handle}?scope=…` | 短时同源句柄；每次重新授权；大小、类型与 Range 受限 | `server/media.ts` |
| 请求历史 | `GET /requests` | owner、时间范围、查询签名与各来源游标；明确 coverage | `server/app.ts`、`server/owners.ts` |
| 统计 | `GET /requests/summary` | 来源、分母与完整性；网关调用不与领域任务相加 | `server/app.ts` |
| 请求详情 | `GET /requests/{owner}/{id}` | Aigora/Scaena/Eikona/Sonora 分别授权与适配 | `server/app.ts` |
| 内容读取 | `POST /requests/{owner}/{id}/content:read` | direction 为 input/output、明确 purpose、CSRF 与 owner 内容授权 | `server/app.ts` |
| 成员投影 | `GET /organization` | owner 原成员、角色、团队和 verified/unlinked；服务失败单独保留 | `server/app.ts` |

## Owner 正式入口

| Owner | 请求投影与已核对文档 | 本版设计约束 |
| --- | --- | --- |
| Scaena | `/api/v1/projects/{project_id}/control-center/requests` 及 summary/detail；`agent/scaena/docs/design/control-center-read-projection.md` | 项目范围必须明确；原任务、审阅与采用分开 |
| Eikona | `/api/v1/control-center/requests` 及 summary/detail；`cli/eikona/docs/interfaces/control-center-read-projection.md` | 原提交与生效输入区分；content:read 独立 purpose；附件内容能力不能推导为 BFF 全部已适配 |
| Sonora | `/api/v1/control-center/requests` 及 summary/detail；`cli/sonora/docs/protocols/control-center-read-projection.md` | 未保存业务正文返回 not_recorded；不重建私有 worker payload；声音用途独立 |
| 控制中心 | `docs/interfaces.md`、`docs/admin-interfaces.md`、`src/task-links.ts` | 同源有界聚合；专业工作台消费固定引用；不复制领域状态 |

## 设计完整、正式接线仍有缺口

| 能力 | 原型呈现 | 正式实现要求 |
| --- | --- | --- |
| 统一配置写入 | 草稿、差异、修订冲突、保留草稿 | 各 owner 具名远程合同、expected_revision、有效值回读 |
| 连接创建、凭据轮换、启停升级 | 原因与归属可见，不提供假成功按钮 | 独立批准 owner 与具体授权，不用远程 Shell 替代 |
| 邀请、角色修改、负责人转移 | 范围与协作意图预览；停在未提交 | 实际可授予角色目录、受约束写接口、幂等回执、最后管理员保护 |
| 资产审阅、采用、交接 | 固定版本、来源、权利、未采用状态 | 各 owner 独立动作合同、授权和正式读回 |
| 项目目录与跨应用返回 | 样例项目绑定、镜头与 revision 返回 | 明确 owner 项目引用、限制目标 origin 与返回路由；不承诺 SSO |
| 全量资产检索、全量导出 | 当前样例筛选与 CSV 导出 | 授权分页或导出合同；不可从一页记录构造全平台统计 |
| 更多生态服务 | 27 项目录和分类、明确 local/design/not-integrated | 各 owner 逐项提供投影并验证；目录不是已接入数量 |

## 迁移验收要点

1. scope/身份变更销毁旧详情、媒体与未完成读取；迟到响应不能回填。
2. unknown、stale、unauthorized、not_supported、not_recorded、not_provided 保持各自含义。
3. 取消超时复用原幂等引用查询；修订冲突重新预览；生成不得因为读取失败而重投。
4. progress=null 不能显示为 0%；费用缺失不能显示为零；不同币种不合计。
5. 新资产版本不能自动改为已采用；历史版本缺字节不能显示当前版本图片。
6. 真实成员角色来自目标 owner；设计协作职责不作为可直接提交的角色 enum。
7. 生产前端迁移仍复用既有 React/Vite/AdminCN/Radix，不直接把静态演示状态接入生产。

## v12 展示增量

- 双主题：仅 CSS 变量和本地 UI 偏好，不新增服务接口。
- 项目列表与专注预览：消费既有样例项目/镜头引用；正式迁入复用范围绑定与受限工作台返回合同。
- 抽屉、全屏预览、技术信息折叠：仅展示状态，权限检查不随视觉主题变化。
- 手机表格：隐藏次要列但不扩大读权限，完整授权字段在详情查看。
