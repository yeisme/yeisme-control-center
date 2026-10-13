# v17 浏览器验收

复用现有 Playwright 与 Chromium，脚本 `scripts/verify-design-v17.mjs`。证据保存在 `temp/integration-test-runs/design-v17-<时间>/`，包含 summary.json、command.txt、stdout.log、stderr.log、env.json 与 artifacts/，失败轮次同样保留。

25 组检查覆盖：

- 既有用户与 Key 生命周期、最小权限、团队移交、组织隔离、无产物请求、原未知操作恢复和草稿保护。
- 五种视口928×933、1440×900、1920×1080、1280×800、390×844，两主题及两密度；七页面、表单、请求详情及媒体工作区。检查横向溢出与手机44px触控。
- 默认360px浮窗不压缩主区、不设置inert；点击其他记录更新浮窗。显式固定才分屏，取消固定恢复浮窗，固定后键盘调整宽度。
- 同一表单节点跨浮窗／固定／展开保持草稿；展开后导航仍可用；Escape与焦点、滚动恢复。
- 资产列表／网格、列、排序、筛选与固定版本上下文。
- 图片真实读取、故障提示、只重新读取同一引用；适应宽度保持比例、1:1按原始像素、50%缩放及展开保持比例。
- 本地图片、转义文本、真实PCM音频与浏览器生成的视频验证片段；播放与暂停、主题及展开保留播放器节点；不支持的文件明确降级为元数据。
- 替换文件和关闭撤销临时URL、范围切换停止并清除预览；浏览器存储不包含文件名或Blob URL；资产记录数不改变。
- 浏览器异常和网络请求监听；不得调用真实管理或生产接口。不运行race。

本地：

```sh
python3 -m http.server 4397 --directory design-proposals/control-center-v17
node scripts/verify-design-v17.mjs
```

同步与远端：

```sh
node scripts/sync-design-v17.mjs --check
node scripts/sync-design-v17.mjs --publish
DESIGN_V17_URL=http://10.10.1.101:7456/api/projects/yeisme-service-control-center/raw/design-proposals/control-center-v17/index.html node scripts/verify-design-v17.mjs
node scripts/sync-design-v17.mjs --verify
```

原生OpenDesign MCP同步前检查活动写入与基线，资源先写、入口最后，逐文件独立HTTP摘要回读。旧版和项目入口共161个文件受保护。浏览器测试只代表原型体验，不升级为正式后端或生产集成验收。
