# Yeisme 控制中心设计交接

当前版本 **admincn-v5**。十页统一采用 AdminCN 组件，Sales 式总览与统计，以及右侧模态 Sheet。默认打开运行总览。

- [本轮视觉与组件规格](admincn-design.md)：参考、许可、字体、图标、组件、Sheet 与兼容边界。
- [本轮参考与截图对比](../admincn-review.html)：Sales / Orders 参考链接，及原型总览、请求、资产、表单、设置、深色和手机版。
- [验证记录](verification.md)：实际浏览器与独立源码构建证据。
- [全生态能力矩阵](capability-matrix.md)：项目 owner、管理能力与接口缺口。
- [管理台与统计规格](admin-design.md)、[接口交接](admin-interfaces.md)：范围、用户、请求和统计口径。
- [基础领域接口](interfaces.md)：任务恢复、权限、配置及 owner 边界。
- [片场集成交接](frame-integration-handoff.md)：仍保留独立合并待办，本轮未修改片场主原型。

历史视觉材料继续可查：[precision-v4](../precision-review.html)、[右侧工作区](../workspace-review.html)、[访达](../finder-review.html)。涉及外观、调宽和导航外壳的旧说明由 admincn-v5 取代；领域功能继续保留。

下载 source.zip 后，在源码目录运行：

```sh
bun install --frozen-lockfile
bun run typecheck
bun run test
bun run build
bun run dev
```

浏览器验证需要本机 Chrome 与 Playwright，指定已启动的预览：

```sh
CONTROL_CENTER_URL=http://127.0.0.1:4298 bun run test:ui
node scripts/verify-source.mjs
```

所有业务数据为可重置的设计样例，没有真实服务探测、生成、账户变更或付费调用。所有检查不运行 race。资产目录、备注、收藏和通知增量已保留，全部为当前范围内的演示状态。源码 ZIP 由 fflate 0.8.2 生成。
