# v11 验证范围

浏览器验证入口为 `node scripts/verify-design-v11.mjs`，使用项目现有 Playwright 依赖。每次运行生成 `temp/integration-test-runs/design-v11-<时间>/` 六件套，失败也保留日志与截图。

验证涵盖六入口、历史筛选/分页/导出、路由恢复、原任务查询/审阅交接、取消未知回执/冲突/权限、正文缺失、资产按需预览/历史版本、服务观察/配置草稿、成员邀请未提交、通知、项目/片场返回、范围隔离、八种状态、搜索/键盘/Escape、1280/1440/1920/390 视口、深浅主题和减少动态效果。

脚本同时检查页面异常、文档横向溢出与非静态网络访问。所有浏览器数据是原型样例；不运行 race、正式客户端全局构建或真实服务测试。

远端验证方式：

```sh
DESIGN_V11_URL=http://10.10.1.101:7456/api/projects/yeisme-service-control-center/raw/design-proposals/control-center-v11/index.html node scripts/verify-design-v11.mjs
```

同步回执通过脚本生成于 `temp/design-v11-delivery/receipt.json`，包含路径、字节数、SHA-256、MCP 传输方式和入口顺序。`mcp-readback.json` 记录原生 MCP 的最终资源清单；`node scripts/sync-design-v11.mjs --verify` 独立核对 HTTP 字节并确认 v10 和旧入口没有变化。

本文件定义验证范围，实际通过情况以本轮 `summary.json` 为准。未包含真实业务认证、生产接入、Provider 执行、屏幕阅读器、Axe/Lighthouse 或三平台实机验收，不作相应声明。
