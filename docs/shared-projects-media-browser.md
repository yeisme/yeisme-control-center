# 共享项目与媒体文件浏览器

2026-10-21 后续完成方案见 [completion-roadmap.md](completion-roadmap.md)，接口增量见 [frontend-api-completion.md](frontend-api-completion.md)。当前本地切片不包括批次服务端分页/detail、参考 binding 选择和 Scaena known-cost 视频计划；这些仍由 OpenSpec 明确任务推进，不将拟议合同描述为已支持。

本地实现入口为 `#/projects?shared=1`。组织管理在“团队与设置 → 协作组织”，owner 成员继续在独立页签读取。现有 owner 项目连接、原项目引用、任务与回执入口保留。

## 能力与归属

| 能力 | 归属 | 当前状态 |
|---|---|---|
| 组织、稳定成员、团队、项目分配、授权并集、暂停撤权 | 控制中心，fit | 已实现本地服务与 UI |
| 项目创建、初始管理员、可选绑定、复制回退、CAS 重命名、隐藏 | 控制中心，fit | 已实现；复制与冲突保持可恢复 |
| 同一通知账本、跨会话阅读、确认分离、桌面/手机浮层 | 控制中心，fit | 已实现；事件先由服务端核验 |
| 手动文件夹、自动批次视图、网格/列表、显式预览与图片缩放 | 控制中心，fit | 已实现；目录只保存 owner 引用 |
| 256 像素授权图片缩略图 | Eikona，split-owner | 已补 owner 合同；旧 owner 未升级时明确不可用 |
| 固定图像输入、候选数量、多提示词批次、预算与原操作恢复 | Eikona 执行，控制中心保留关联 | 本地合同已实现；新提示词保持待审 |
| 视频生成、静态封面与时长 | Scaena，split-owner | 原视频授权播放路径保留；普通生成因固定输入/已知报价合同缺失而阻断，未完成成功路径 |
| 参考素材的不可变 binding 选择及交接 | 原素材 owner，split-owner | owner 输入 DTO 支持 binding；选择与授权交接 UI 尚未完成 |
| 个人会话借用服务凭据读取成员 | reject-now | 出站和凭据解析前拒绝 |
| 复制生成调度或原始媒体存储 | reject-now | 未引入 |

## 操作约束

组织是隔离边界。项目授权不扩大接收者的 owner 权限；读取使用接收者已有的 owner actor/binding。暂停成员、团队变更和过期会话在服务端重新校验。至少保留一名有效组织管理员。

组织与项目写入使用 actions preview/confirm/receipt。本地变更和回执同事务提交；外部提交先留开始标记。输入、计划、预算、绑定、目标目录和幂等键固定后才调用 owner。未知接收只查询原操作，不自动重发。

图片小图使用独立授权衍生图；不支持时显示状态，不用完整原图代替。媒体缓存仅在页面内存中保存，切换主体/项目、退出或权限变化会清空并丢弃迟到结果。单击选择只显示详情，预览与播放需要明确操作。

通知的阅读状态与失败提醒确认状态独立。轮询更新观察时间，不把旧失败置顶为新通知。弹窗提供未读/全部及加载更多；服务端分页与未读总数独立于当前已加载页。

## 迁移

先预览明确 tenant/scope 映射；启动应用不会自动导入。

```bash
bun scripts/migrate-collaboration.ts --config /path/to/control-center-config.json
```

在操作者明确选择写入后运行：

```bash
bun scripts/migrate-collaboration.ts --config /path/to/control-center-config.json --apply
```

按 scope 保守建立独立组织，避免把已有管理员权限扩展到其他 scope。相同项目名和相同 owner 引用不合并。歧义映射、缺少管理员的 scope 留在旧入口，报告为 unresolved；命令可重复执行，不删除旧数据。

## 本地验证

```bash
bun run typecheck
bun run test
bun run build
bun run test:contract-integration
bun run test:browser-journey
bun scripts/verify-collaboration-journey.ts
```

共享项目旅程覆盖创建组织与绑定项目、创建/进入文件夹、仅选择不读取完整媒体、显式预览/缩放、重命名 ID 保持、URL 恢复、复制失败回退、阅读不确认，以及 390/768/1440/1920 明暗主题无横向溢出。测试使用显式 fixture owner；证据保存在 `temp/integration-test-runs/`，不能作为真实 owner 或付费结果证明。

Eikona 合同验证在其 owner 仓执行：

```bash
go run ./scripts/verify-browser-input.go
```

该命令核对生成 OpenAPI 并运行输入、缩略图与相关 owner 合同测试，证据写入 Eikona 自己的 `temp/integration-test-runs/`。

本次 Eikona 最终验证在 `53f4f09d` 的隔离检出上仅施加 16 个本次合同文件；未带入共享工作区并行开发的渠道改动。结果为通过，证据位于 Eikona 的 `temp/integration-test-runs/isolated-browser-input-20261021T094757.747705095Z/`，其中 `env.json` 记录实际检出与执行目录。该结果不代表共享工作区其他改动通过了完整构建。

## 独立验收状态

本地协作服务、图像合同与浏览器流程有测试证据。真实组织委托、真实付费图像/视频生成和部署尚未执行。视频已知报价、参考 binding 选择与相关成功旅程仍在 OpenSpec 中保留未完成任务，不能宣称整份计划已全部交付。现有部署与付费开关未修改。
