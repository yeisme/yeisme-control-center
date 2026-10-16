> 本文为历史规格。当前外观、组件、导航和详情承载方式以 [AdminCN 改版规格](admincn-design.md) 为准；现有领域能力继续保留。

# 统一右侧工作区与表单

## 已实现结构

`RightWorkspace` 同时承载详情、编辑、预览、提交与回执。标题、范围、状态、标签页和底部动作固定，中部独立滚动。进入编辑替换详情，完成后通过回执返回原对象与标签页。只读详情使用语义属性行、可复制引用和紧凑关联列表；服务仍有概况、连接与能力、配置、访问、诊断五个标签。

1440px 起并排；详情默认 400px，可调 360–560px，编辑默认 560px，可调 480–640px；最大值同时受主区至少保留 560px 的约束。1280/768 使用模态 Sheet；低于 768px 全屏。拖动边界立即改变宽度，方向键每次调整 16px，Home/End 到边界，双击复位。详情和编辑的宽度分别保存在 UI 偏好中，拖动期间关闭宽度动画。

断点切换复用 App 中的受控草稿与字段错误；输入使用稳定 ID，容器恢复滚动和焦点。桌面面板不锁住主页面焦点，Sheet 使用 Radix 焦点约束；关闭后返回原触发点，原触发点消失时回到页面标题。

## 表单与校验

- 服务接入：服务与范围、连接引用、检查与确认。范围只读；实例名称必填，连接和凭据引用复用既有格式约束。检查通过只表示引用格式有效；认证、能力与真实连接仍待 owner 接线。
- 配置：执行限制和模型配置分组；并发为 1–16 整数，超时为 10–600 秒整数。数字在草稿中保留字符串，清空保持空值；通过校验后才转换。预览只展示真正变化的字段；没有变更禁止预览或保存。
- 配置冲突：保留草稿，读取有效版本后回到编辑，按新基线重新预览。保存失败保留草稿和原配置；确认按钮在提交中不可重复使用。
- 审阅、拒绝、取消、费用确认：显示对象、原引用、范围、明确关联的版本/尝试与费用。没有证据明确写未提供，拒绝原因必填，确认项未勾选时不可提交。新尝试保留父任务，unknown 先回查原操作。
- 成员角色、主题、导航：采用相同字段和控件风格，维持演示身份切换与即时外观偏好。后续管理台已增加邀请和授权的演示流程；没有真实授权写入或通知服务。

Field 采用 label/control/description/error 分层，使用 id、htmlFor、aria-describedby、aria-invalid 和 aria-required。首次失焦或提交时显示错误，修改后清除该字段错误，提交错误聚焦第一个无效输入。固定 footer 保留取消、返回、预览或确认，表单 Enter 走同一受保护动作。

## 草稿、结果与范围

同一工作区只有一个活动编辑会话。关闭、换对象、导航或同范围深链切换时，脏草稿弹出“继续编辑／放弃修改”；继续编辑保留输入。环境、项目或身份切换直接清理失效状态，迟到回调通过 scope generation 拒绝写入新范围。

提交中可收起工作区，浮动“操作处理中／查看操作回执”入口恢复原会话；收起不重发提交。进行中禁止再开始其他管理操作。完成显示固定引用、有效配置或逐项结果，明确为设计回执；原操作与审计继续保留。

详情读取提供短暂的设计加载态；离线演练读取失败时明确保留最后快照。缩略图依据实际图片加载结果呈现加载或不可用，不将失败预览伪装为空白正常内容。所有设计状态不调用真实 Provider 或管理 API。

## 开源来源与适配

- Extend UI：固定 commit `a0ddcecd7bb3c92458b148cb0d34cbd5263191d4`。`src/extend-finder.tsx` 使用其文件夹 SVG，并适配 `file-thumbnail.tsx` 的图片就绪/失败生命周期。工具栏与属性区参考 File System (Finder) 的布局，继续由现有对象引用驱动。
- [Extend UI 原组件](https://www.extend.ai/ui/docs/components/file-system)；[MIT 许可](third-party/extend-ui-LICENSE.md)。保留 CrowdView Inc / Extend 和 shadcn 署名。没有引入 `@pierre/trees`、整套文档渲染器或额外动画库。
- [shadcn Field](https://ui.shadcn.com/docs/components/field) 的字段解剖与状态作为交互参考，映射到现有 Radix 与 CSS 变量；保留系统字体、访达蓝与 React Spring 10.1.2。
- Aigora 的统一右侧工作区提供布局与编辑生命周期参考；控制中心未复制其领域业务或真实授权合同。
- generation-v4 延续 [shadcn Field](https://ui.shadcn.com/docs/components/field) 的 label/control/description/error 分层与 [Popover](https://ui.shadcn.com/docs/components/popover) 的上下文筛选模式。实现仍使用现有 Radix，不引入 Base UI 或重复表单框架。


## 验证入口

UI 修改后的视觉检查使用本机 Demo 预览，不进入内网开发容器：

```bash
bun run build:demo
bun run preview:demo
CONTROL_CENTER_URL=http://127.0.0.1:4298/?mode=demo bun run test:ui
```

浏览器预览地址为 `http://127.0.0.1:4298/?mode=demo`。内网地址只用于部署和运行验证。

```sh
bun run typecheck
bun run test
bun run build
bun run dev
```

已有预览启动后：

```sh
CONTROL_CENTER_URL=http://127.0.0.1:4298 bun run test:ui
```

浏览器验证沿用原有 22 条流程，追加字段错误、草稿保护、调宽、断点切换、收起恢复、范围清理、接入、审阅及读取状态检查；仍使用原 Vitest/Playwright 体系，不运行 race。完整输出由脚本写入 `temp/integration-test-runs/`。

generation-v4 追加 8 条生成产物浏览器场景：目录表单与重名、组合筛选、产物/目录拖拽与循环拒绝、键盘移动、备注与草稿保护、通知已读与定位、保存失败与只读权限、四尺寸明暗布局。4 项目录状态测试覆盖循环、同级重名、递归交集和授权范围隔离；实际总数以 `verification.md` 为准。

precision-v4 将图标统一为 Phosphor React 2.1.10（[MIT 许可](third-party/phosphor-LICENSE)），移除 Lucide。关闭详情由工作区统一恢复焦点，尊重已移到外部的用户焦点；原对象不再存在时返回仍然选中的浏览对象或页面标题。全量合并验收共 51 条浏览器流程、36 项单元测试，实际结果见验证记录。
