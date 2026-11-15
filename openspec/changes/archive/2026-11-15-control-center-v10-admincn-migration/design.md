# 历史方向提示

本设计保留原始内容用于追溯，当前实施遵循本项目 `AGENTS.md`。2026-10-21 起停止旧 v10 视觉迁移；有效行为要求与接续任务见 [README.md](README.md)，未验收状态保持不变。

## 背景与输入

OpenDesign 项目 `yeisme-service-control-center` 的 v10 提案是视觉和交互输入，不是后端能力证明。正式客户端继续以 AdminCN Free 固定版本 `dd1afd2f3a794ea9e746197de314f81d43670ea1`、Geist、Lucide 和现有六入口为唯一实现约束。控制中心只拥有导航、展示、UI 偏好和有界只读聚合；项目、任务、资产、权限和账本仍由各 owner 持有。

## 目标

1. 1440×900 首屏能看到需要处理的事项、Scaena/Eikona/Sonora 三个核心服务和当前作品上下文。
2. 用户能从一个业务阻塞进入原请求与证据链，并在不重复提交的情况下返回原项目/镜头。
3. 服务页能解释“连接正常但未授权”“任务未知但服务健康”“能力未支持”等不同事实。
4. 390px、键盘、焦点恢复和 `prefers-reduced-motion` 下仍可查看和安全恢复。

## 非目标

- 不把设计原型改成正式生产入口，不以截图或构建结果宣称真实接入。
- 不在控制中心复制 owner 状态机、账本、正文、provider payload 或凭据。
- 不新增通用管理代理、远程 Shell、重启/升级/配置写入或自动重试。

## 设计决策

### 1. 行动优先总览

总览主区顺序固定为 `现在需要处理`、`核心服务`、`当前作品`、`最近活动`；统计与成本放入次级视图。每一条行动项必须包含对象、项目、owner、观察时间、影响、原因/未知边界和一个下一步。优先级只能由业务阻塞、风险和时效解释，不引入不可解释的综合分数。

### 2. 五维服务状态

服务卡和服务详情同时展示：

| 维度 | 允许的状态 | 说明 |
| --- | --- | --- |
| connection | `ok` / `unreachable` / `not_checked` | 协议或端点可达性 |
| authorization | `authorized` / `unauthorized` / `expired` / `unknown` | 当前浏览器身份与范围 |
| business readiness | `ready` / `blocked` / `stale` / `unknown` | owner 暴露的业务依赖与能力 |
| management capability | `readonly` / `controlled` / `unsupported` | 当前身份可执行的动作集合 |
| observation evidence | `fresh` / `stale` / `partial` / `not_recorded` | 来源、观察时间和覆盖范围 |

缺失维度保持缺失；不把 `configured`、缓存成功或 OpenDesign 截图转成健康绿灯。

### 3. 运行上下文与证据链

跨页定位使用非敏感稳定引用：`owner`、`environment`、`project_ref`、`object_ref`、`operation_ref`、`return_to`。不得放 token、签名 URL、正文或私有工具参数。请求详情依次呈现业务操作、领域任务、尝试、网关调用和回执；不存在关联时显示 `not_provided`，禁止按名称、时间或邮箱猜关联。

### 4. 恢复与迟到结果

未知回包只能触发同一 `operation_ref` 的查询。取消、重试、资产采用和配置提交必须显示合同、权限、版本和幂等键要求；未支持动作显示负责 owner。切换范围、退出登录或关闭详情后，迟到响应不得回填已清除的正文或详情。

### 5. 响应式与可访问性

390px 使用全屏详情和字段标签记录排版；不把三栏强行压缩为不可读表格。所有 Sheet/对话框保留触发焦点，Escape 按层级关闭，错误首焦点明确；减少动态效果时移除装饰动画但保留状态变化和进度语义。

## 验证分层

- 设计层：读取 OpenDesign v10 文件、确认合成数据标识、记录预览 URL 和逐文件回读。
- 本地工程层：`bun run typecheck`、`bun run test`、`bun run build`、`bun run build:demo`、目标浏览器脚本。
- 真实接入层：分别记录 owner 合同、当前身份、观察时间和失败恢复；不得用设计或 fixture 证据替代。

不运行 race；不把生产部署、TLS、凭据初始化或真实管理写入纳入本变更完成条件。
