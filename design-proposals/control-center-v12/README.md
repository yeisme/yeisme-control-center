# Yeisme 控制中心 v12：编辑室 × 电影工作台

本版采用已选定的 A「编辑室」与 B「电影工作台」视觉方向，交付同一信息架构和操作位置的全站浅深双主题。这里是独立设计原型，数据为样例；未修改正式 React 客户端、部署、用户权限或领域服务。

## 开始体验

- [总览](index.html#overview?scope=team)：当前作品、优先事项、运行任务、三服务和近期结果。
- [项目](index.html#projects?scope=team)：项目列表进入作品运行页，选择镜头，再打开「专注预览」。
- [任务历史](index.html#requests?scope=team&tab=领域任务&mode=history)：搜索、服务/状态/日期筛选、分页与样例导出。
- [资产](index.html#assets?scope=team)：类型与布局筛选、按需参考摄影预览、固定版本与来源任务。
- [服务](index.html#services?scope=team)：27 项目录、核心服务五维观察与关联任务。
- [团队](index.html#team?scope=team)：成员与服务身份，邀请只做未提交预览。
- [设置](index.html#settings?scope=team)：主题、密度、角色演练、会话、重置。
- [设计规范](design-spec.md)、[组件样板](components.html)、[接口映射](interface-map.md)、[验证说明](verification.md)。

## 主题与导航

右上角主题按钮和详情内主题按钮均可切换。浅色使用暖白、墨绿；深色使用深炭黑、低饱和黄绿。主题只改变 CSS 变量，不重建 DOM，因此当前项目、筛选、弹层草稿、版本选择与滚动位置保持。

左侧导航展开 232px、收起 64px，真实改变主区域可用宽度。主题、导航折叠和密度保存在独立 v12 偏好中。手机使用独立导航抽屉和全屏详情。

## 完整体验路径

1. 总览「查询与恢复」打开待决任务，查询原任务后准备审阅交接；声音权利不会自动通过。
2. 项目列表进入雨夜重逢，选择镜头 02，打开专注预览；切换主题和镜头，退出后保留原位置；「在片场继续」保持当前镜头。
3. 任务历史筛选 Sonora，查看运行中环境音；演练取消确认、回包未知、查询原回执，以及版本冲突重新预览。
4. 图像资产按需打开参考摄影；切换 v2 时明确显示缺少历史字节，不借用 v3。声音和视频没有真实字节，不提供虚构播放器。
5. 服务打开 Sonora，核对连接、授权、任务合同、内容与管理动作，跳转关联任务；配置草稿只展示差异和冲突，不写入服务。
6. 团队邀请填写协作意图，交接停在未提交；角色只读时取消动作禁用。
7. 顶部切换八种状态；撤销权限和退出清理旧详情，切换范围不增加权限。

## 实现边界

复用 v11 的原生 HTML/CSS/JavaScript、路由、事件与恢复逻辑。新版展示使用明确的模板函数和组件组合，不在运行时进行整段 HTML 字符串替换。新增样式统一映射到双主题变量，原型不引入新前端框架。

媒体继续使用 v10/v11 已有参考摄影，标识为参考而不是当前作品结果。本轮不新增付费生成，不把 A/B 图中生成的身份、日期、按钮或合规结论当作产品事实。Geist 字体来自项目已安装依赖，同目录保留许可证。

## 本地预览和验证

在 client/yeisme-control-center 执行：

```sh
python3 -m http.server 4392 --bind 127.0.0.1 --directory design-proposals/control-center-v12
node scripts/verify-design-v12.mjs
```

远端同步和回读：

```sh
node scripts/sync-design-v12.mjs --baseline
node scripts/sync-design-v12.mjs --check
node scripts/sync-design-v12.mjs --publish
node scripts/sync-design-v12.mjs --verify
```

发布入口为同一 OpenDesign 项目的独立 v12 目录。原生 MCP 写入前检查活动任务，资源先写、入口最后；每个文件进行独立 HTTP 摘要回读，并核对 v10/v11/旧入口基线。
