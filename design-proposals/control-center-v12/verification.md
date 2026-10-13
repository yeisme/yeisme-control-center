# v12 验证范围

验证复用项目既有 Playwright，不使用新的测试框架，不运行 race。每次运行由 scripts/verify-design-v12.mjs 生成 temp/integration-test-runs/design-v12-<时间>/ 六件套，失败同样保留。

基础覆盖复用 v11 的 25 组业务交互，包括原任务恢复与交接、任务历史/筛选/导出、取消未知回执/冲突/权限、资产缺失版本、服务配置草稿、成员邀请未提交、通知、范围隔离、八种状态、键盘、手机详情和会话重置。

v12 增加：主题切换保留任务筛选、弹层草稿与滚动；232/64px 导航和持久化；项目列表/专注预览/同镜头返回；两主题首屏待处理入口；1440×900、1920×1080、1280×800、390×844 的全部六入口及设置矩阵；最小字体与手机控制目标；手机专注预览；正文与主操作令牌的 WCAG AA 对比度计算。

远端原型验收：

```sh
DESIGN_V12_URL=http://10.10.1.101:7456/api/projects/yeisme-service-control-center/raw/design-proposals/control-center-v12/index.html node scripts/verify-design-v12.mjs
node scripts/sync-design-v12.mjs --verify
```

同步由原生 OpenDesign MCP 执行，temp/design-v12-delivery 保存逐文件 SHA-256 回读记录和 MCP 资源清单；v10/v11/旧入口保护基线由脚本生成于 temp/design-v12-baseline。

实际通过情况以 summary.json 为准。截图仅证明原型样例的视觉和交互；没有真实服务身份、Provider、生产部署或真实资产授权验收。未声称完整屏幕阅读器、Axe 或 Lighthouse 验收。对比度检查针对正文/辅助文字/主操作的实际主题令牌，不冒充所有照片和任意混合背景的自动合规。
