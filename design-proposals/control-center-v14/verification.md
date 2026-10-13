# v14 验证与证据

复用项目既有 Playwright 与 v13 的证据目录格式。测试脚本为 scripts/verify-design-v14.mjs。每轮在 temp/integration-test-runs/design-v14-<时间>/ 生成 summary.json、command.txt、stdout.log、stderr.log、env.json 和 artifacts/；失败同样保留。

## 覆盖

- 原任务结果未知 → 查询原任务 → 审阅交接；取消回包未知 → 查询原取消回执；版本冲突不重投。
- 资产类型、固定版本和缺失字节；声音和视频不虚构媒体；服务关联任务及配置冲突草稿。
- 表单520px、只读详情400px，输入/select/textarea字段对齐，全屏最大720px，手机全屏。主题、密度及断点变化保留草稿。
- 两组织独立项目与成员；组织切换草稿保护；无领域投影不复制旧组织内容。
- 新建项目三步、必填、既有项目引用、返回上一步、部分绑定失败；未知创建操作关闭／切换范围后按原引用恢复，管理项目不重复增加。
- Key配置变更只预览；临时24小时／紧急1小时默认值；显式项目授权、撤销预览与Aigora关闭状态。
- 持Key身份范围及刷新不提权；只读创建禁用；跨组织深链拒绝；撤销会话清理且再次登录拒绝；禁用、过期、未开放面板、未知代码及无项目授权状态。
- 管理页加载、空数据、部分来源失败、观察过期、读取失败、权限撤销和会话过期。
- 两主题×两密度×1440×900、1920×1080、1280×800、390×844，覆盖六入口与设置，并单独截取项目表单、Key表单。检查横向溢出、触控目标、键盘Tabs、Escape和减少动态效果。
- 浏览器无脚本异常，无真实管理、生成、第三方请求。原型演示代码不作为凭据使用。

## 运行

```sh
python3 -m http.server 4394 --directory design-proposals/control-center-v14
node scripts/verify-design-v14.mjs
DESIGN_V14_URL=http://10.10.1.101:7456/api/projects/yeisme-service-control-center/raw/design-proposals/control-center-v14/index.html node scripts/verify-design-v14.mjs
node scripts/sync-design-v14.mjs --verify
```

实际结果以最新 summary.json 为准。没有运行 race。没有生产认证、真实配置写入、领域项目创建、Key签发或部署验收。

## OpenDesign 交付

沿用原生 OpenDesign MCP。同步前检查活动写入，并冻结 v10–v13 与旧入口共78个文件摘要；资源先写、入口最后，逐文件HTTP摘要回读，随后通过MCP读取资源包。temp/design-v14-delivery/receipt.json保存交付与回读结果。旧版摘要变化时停止覆盖，不默默替换远端内容。
