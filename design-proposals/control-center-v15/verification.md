# v15 验证与交付

复用项目Playwright及既有证据目录格式，脚本为scripts/verify-design-v15.mjs。每轮生成temp/integration-test-runs/design-v15-<时间>/，包含summary.json、command.txt、stdout.log、stderr.log、env.json及artifacts/；失败同样保留。

16组检查覆盖：

- 创建用户、分配团队／项目、代建个人Key、一次演示交付、切换身份；所属用户与创建者两类列表分离。
- 登录名组织内唯一，默认只读，Key不能提升用户创建能力。
- 重置用户使旧会话失效，Key与历史保留；管理员重置自己的登录也使当前会话失效；轮换Key使旧值拒绝，新值不再回显，历史仍按原版本查询。
- 最后组织管理员和项目负责人保护。
- 全部请求生命周期、无产物过滤、失败多次尝试、未知原操作查询不重投。
- 资产生产用户和多条件交集、固定版本、来源请求、Key与筛选结果往返；缺少字节不虚构媒体。
- 项目团队／负责人移交，历史生产者与历史团队不改写；负责人项目权限不可直接撤销。
- 项目授权撤销、跨组织深链拒绝、默认组织管理员与显式平台视角、未认证事件分区。
- 暂停／恢复用户、移出团队、新建项目负责人和团队绑定。
- 表单520px、草稿保护、主题密度与断点切换、减少动态效果。
- 原领域任务恢复与审阅交接、取消未知回执恢复。
- 两主题×两密度×1440×900、1920×1080、1280×800、390×844：六入口和设置，另截图用户与Key表单；检查横向溢出、手机触控尺寸。
- 没有真实服务调用或脚本异常。

运行命令：

```sh
python3 -m http.server 4395 --directory design-proposals/control-center-v15
node scripts/verify-design-v15.mjs
DESIGN_V15_URL=http://10.10.1.101:7456/api/projects/yeisme-service-control-center/raw/design-proposals/control-center-v15/index.html node scripts/verify-design-v15.mjs
node scripts/sync-design-v15.mjs --verify
```

实际结果以最新summary.json为准。原型证据不能替代真实文件存储、认证、部署、领域服务授权或生产采集完整性验收。不运行race，不产生付费生成。

通过原生OpenDesign MCP交付；同步前检查活动写入，保护v10–v14与原入口共103个文件摘要，资源先写、入口最后，逐文件HTTP摘要回读并通过MCP再次读取资源包。交付记录由脚本写入temp/design-v15-delivery/。
