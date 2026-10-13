# AdminCN 全组件改版 · admincn-v5

十页统一使用 AdminCN 的页面、卡片、表格、表单与模态 Sheet。此文取代早期访达外壳、Phosphor 图标与可调宽并排面板的规格。所有业务状态仍为可重置的设计演示。

## 参考与源码边界

- AdminCN Free：https://shadcnstudio.com/templates/admin-dashboard/admincn-free
- 固定源码：https://github.com/shadcnstudio/shadcn-nextjs-admincn-admin-template-free/tree/dd1afd2f3a794ea9e746197de314f81d43670ea1
- MIT 许可：third-party/admincn-LICENSE.md。复用其 Button、Card、Field、布局和语义令牌的结构与样式；原作者 shadcn/studio 署名保留。
- Sales 官方视觉：https://shadcnstudio.com/templates/admin-dashboard/admincn 。使用公开截图核对布局、留白及配色，未使用 Pro 源码或销售样例数据。
- 两个 Vercel 演示页在制作环境无法打开；官方公开截图与固定免费源码为可验证的参考基准。交付对照页链接这些参考，并列展示原型实际截图。

## 外壳与组件

256px 分组侧栏，48px 收起模式，手机 288px 导航抽屉。56px 内缩圆角顶栏承载面包屑、全局搜索、主题、通知与账户。环境、范围和设计演示入口进入页面标题行。主区最大宽度 1440px，桌面间距 24px，手机 16px，恢复文档自然滚动。

颜色采用 AdminCN 白色／炭黑令牌，主按钮黑色、深色模式浅色；选中灰色。基础圆角 10px，卡片约 14px，1px 边框和轻阴影。常用控件 36px，手机主要控件 44px。正文 16px，表格和控件 14px，辅助信息 12px。

Geist Variable 5.3.0 自托管；中文使用 PingFang SC / Microsoft YaHei 系统回退。Lucide React 1.24.0 统一图标入口，已移除 Phosphor 运行依赖。字体与图标许可分别保存在 third-party/geist-LICENSE、third-party/lucide-LICENSE。

`src/components/ui` 维护统一基础组件、Radix 适配入口、表格与管理控件；旧 ui/admin-ui 导入路径保留兼容重导出。Tailwind CSS / Vite 插件固定 4.3.3。保留 React 19、Radix、TanStack Table 9 和 Recharts，不引入模板的 Next.js、Base UI 或 Table 8。

旧样式中的外壳、按钮、字段、卡片和表格规则已移除，由组件层和 layout.css 单独维护。字体、图标和必要媒体都随构建输出，预览不依赖外部字体 CDN。

## 页面行为

- 总览：六项事实指标为网关调用、生成任务、执行尝试、关联产出、已决成功率和未知结果。青绿／橙色趋势图及执行结果卡沿用 Sales 的布局语言。没有前期可比事实时，不显示增长率。无已决结果显示 —，不是 0%。
- 总览指标、统计图和导出使用相同范围与事实过滤；不同请求类别不相加为总请求。已决成功率沿用成功 ÷ 成功与失败。币种、账单去重、费用权限不变。
- 管理表格：Card 容器内整合标题／筛选／列与视图／导出／内容／分页。保留批量逐项结果、选中范围、导出完整性说明、当前页与全量区别。少量记录没有无意义的翻页按钮。
- 项目与资产：改为模板卡片与列表，移除拟物文件夹和底部路径栏。目录、收藏、移动、撤销、备注、空格快速查看、Enter 与方向键继续可用。
- 组织与成员：保留平台／团队／个人范围、不同 owner 角色、同名成员隔离及最后负责人保护。列表和编辑使用同一套 Card / Field / Sheet。
- 设置：横向标签与分区说明／字段两列，手机单列；主题、导航偏好即时生效。

## Sheet、表单与恢复

所有详情和编辑统一为模态 Sheet。详情 420px，编辑 560px，小于 640px 全屏；取消拖动调宽与并排挤压主区，忽略旧宽度偏好。背景滚动锁定，焦点留在当前 Sheet，标题与底部操作固定，中部独立滚动。

继续使用现有编辑、预览、确认、提交与回执状态。关闭按钮、Escape 和遮罩关闭均走脏草稿检查；弹出“继续编辑／放弃修改”。关闭后恢复触发对象焦点及原列表位置。嵌套菜单和确认框不误关闭父 Sheet。断点变化复用当前输入，不重建编辑状态。

环境、身份或授权范围变化清理旧内容、草稿和迟到结果。进行中操作可以收起，再用“查看操作回执”恢复，不二次提交。未知任务继续查询原引用，新增付费尝试仍需单独确认。

去掉常驻访达前进／后退按钮。导航历史保留，通过 Alt+←／Alt+→ 和账户菜单的前进／后退项使用；环境、身份变化清理历史。默认无 hash 打开总览，已有深链与片场返回参数兼容。

## 验证与交付

原有 51 条浏览器流程按模态交互更新；旧调宽场景改为 Sheet 焦点约束、遮罩关闭、独立滚动和位置恢复。追加总览指标与明细一致、直接范围深链清除脏 Sheet 两项，共 53 条。单元测试 36 项，原调宽边界替换为空白数字草稿与有效配置保护。最终结果以 verification.md 为准。

四档尺寸 1440 / 1280 / 768 / 390、明暗主题和减少动态效果。发布前校验活动写入及源文件基线，资源先写、入口最后，所有发布文件回读；源码 ZIP 独立安装、类型检查、单元测试和构建。

```sh
bun install --frozen-lockfile
bun run typecheck
bun run test
bun run build
bun run dev
CONTROL_CENTER_URL=http://127.0.0.1:4298 bun run test:ui
node scripts/verify-source.mjs
```

源包包含本轮对比和应用媒体。旧轮次截图保留在原预览中，由历史对比页面引用。领域 owner API、生产服务、真实生成、账号写操作及片场主原型不在本轮变更范围。
