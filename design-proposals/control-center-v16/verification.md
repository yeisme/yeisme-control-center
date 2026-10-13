# v16 浏览器验收

使用现有 Playwright 与 Chromium，脚本 `scripts/verify-design-v16.mjs`。每轮证据位于 `temp/integration-test-runs/design-v16-<时间>/`，包含 summary.json、command.txt、stdout.log、stderr.log、env.json、artifacts/。失败轮次保留。

20 组检查包括原有 16 组业务回归和 4 组展示交互检查：

- 用户创建、代建 Key、归因分离、会话重置与轮换、最小权限、最后管理员与负责人保护。
- 无产物请求、拒绝／失败／取消／未知状态、查询原操作、取消未知回执恢复与审阅交接。
- 团队移交、授权撤销、暂停用户、跨组织深链及显式平台身份。
- 资产多条件筛选、固定版本、来源请求、生产归因；缺字节不构造媒体。
- 两主题、两密度、928×933、1440×900、1920×1080、1280×800、390×844；六入口、设置、用户与 Key 表单。检查无页面横向溢出、520px 标准表单及手机触控。
- 展开后主内容 inert、导航可用、侧栏收放、收回滚动恢复、同一表单节点及草稿保护。
- 头像菜单键盘、Escape、焦点返回、身份切换清理。
- 列表／网格结果一致、名称排序、列设置、单项筛选清除、媒体缩放、宽屏320px属性栏及928px截图。
- 详情抽屉与展开工作区追加全部主题／密度／视口矩阵，检查手机展开导航及详情触控目标。
- 监听脚本异常及所有请求；不得产生真实服务或管理请求。不运行 race。

本地验证：

```sh
python3 -m http.server 4396 --directory design-proposals/control-center-v16
node scripts/verify-design-v16.mjs
```

同步与远端验证：

```sh
node scripts/sync-design-v16.mjs --check
node scripts/sync-design-v16.mjs --publish
DESIGN_V16_URL=http://10.10.1.101:7456/api/projects/yeisme-service-control-center/raw/design-proposals/control-center-v16/index.html node scripts/verify-design-v16.mjs
node scripts/sync-design-v16.mjs --verify
```

同步使用原生 OpenDesign MCP，资源先写、入口最后，逐文件独立 HTTP 摘要回读。旧版本与项目入口共131个文件受基线保护。这里的浏览器验收只证明设计原型行为，不代表正式后端、真实身份或生产权限已经实现。
