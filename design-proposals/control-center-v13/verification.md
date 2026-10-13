# v13 验证范围

复用现有 Playwright，原有业务路径与新交互共 39 组检查，不运行 race。每次运行由脚本生成 temp/integration-test-runs/design-v13-<时间>/ 六件套；失败保留原始错误和截图。

覆盖待决原任务查询到审阅交接、固定资产版本到来源任务与镜头、服务到关联任务、取消未知回执、修订冲突、只读身份禁用、范围及会话清理、加载/空数据/部分失败/过期/未授权/读取失败/会话过期。

新增首屏可见记录数、20 条默认分页与 10/50 切换、400px 停靠与最小主区、拖动/键盘/重置宽度、连续任务切换保留列表滚动、必填与首错焦点、脏表单继续/放弃、跨断点/密度/主题/全屏保留同一输入节点、高级筛选应用和无效日期、键盘 Tabs、Popover、Switch 和样例字段校验。

两主题、两密度、1440×900 / 1920×1080 / 1280×800 / 390×844 覆盖六入口与设置；另有请求详情和邀请表单的完整矩阵。检查中文最小字号、手机触控目标、页面横向溢出、焦点恢复及减少动态效果。正文、辅助文字及主操作令牌检查 WCAG AA 对比度；不冒充完整 Axe、屏幕阅读器或生产验收。

本地与远端验证命令：

```sh
python3 -m http.server 4393 --directory design-proposals/control-center-v13
node scripts/verify-design-v13.mjs
DESIGN_V13_URL=http://10.10.1.101:7456/api/projects/yeisme-service-control-center/raw/design-proposals/control-center-v13/index.html node scripts/verify-design-v13.mjs
node scripts/sync-design-v13.mjs --verify
```

同步使用原生 OpenDesign MCP。同步前捕获 v10/v11/v12 与原入口共 56 个文件的摘要，检查活动写入；资源先写、入口最后，逐文件 HTTP 摘要回读并通过 MCP 再读资源包。temp/design-v13-delivery 保存交付记录。

以最新 summary.json 为实际通过依据。没有真实接口写入、Provider 调用、付费生图或正式客户端部署。所有任务、邀请、角色和配置状态均为演示投影。
