## Context

用户确认完整素材库、自动基础分类加手动标签、跟随项目共享、全部可读取历史自动索引。统一提示词入口、范围化 owner 查询、正文详情、素材编辑与收藏夹；只持有引用和整理元数据。

## Decisions

- `PromptSummary` 仅携带 opaque ID、owner、project、标题、类型、来源、版本、digest、标签、归档状态、时间和内容可读性；列表不携带正文、路径、凭据或 Provider 参数。
- 独立 `content:read` 执行 owner 权限检查与先行持久审计，之后读取指定版本。内容响应 no-store；客户端切换范围或关闭详情即清除正文。
- 素材编辑创建版本；任务历史正文不接受改写。归档只改变素材可见状态，保留版本。个人旧历史仍保留原权限，新素材按所属项目共享。
- 创建/修订冻结幂等键与请求 digest；冲突不覆盖。原操作 receipt 查询没有写副作用，不重发生成或素材创建。
- 控制中心复用 action preview/confirm/receipt，正文只存活于短期编辑内存，持久化 action 只保存 digest 与引用。收藏夹只持有 owner/project/prompt 引用。
- 新 Go 数据使用 GORM；Eikona 复用既有 canonical prompt documents 与派生索引。迁移为 additive，旧接口保持可用。

## Workspace and Verification

当前工作区串行编辑，保留任务开始前的未提交修改。测试只使用临时数据库、隔离端口和合成业务文本，不运行 race，不调用真实 Provider。各 owner 使用现有 Go testing 或 Vitest；控制中心的 `bun run test:prompt-library` 连接三个真实 owner handler、临时数据库和浏览器，证据分别记录在各 owner 的 `temp/integration-test-runs/`。

## Rollout

先通过 scoped tests、接口合同、构建和隔离系统流程。日常实例升级与授权变更需具体部署授权；本地证据不代表已部署、OIDC 委托或真实历史数据验收。

## Historical Limits

历史索引只读取有明确 owner/project/actor 关系的业务档案。不存在的原文不可恢复；digest-only、内部指令和权限不明内容不得通过收藏库绕过限制。旧任务的有效业务输入不冒充原始提交字节。
