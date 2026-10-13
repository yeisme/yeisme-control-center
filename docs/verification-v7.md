# AdminCN v7 验证记录

本轮为六入口和统一组件改造；不把设计演示或fixture升级为真实owner读取证明。

- 原有浏览器流程：53/53，157张截图。证据：temp/integration-test-runs/2026-10-04T13-25-48-416Z/。
- 新工作区：10/10，覆盖六入口、受控正文、1280px固定与焦点、独立授权/配额、四档明暗及手机记录。证据：temp/integration-test-runs/v7-2026-10-04T12-18-47-509Z/。
- 真实模式fixture：2/2，未配置登录拒绝、同名租户隔离与批次导出边界。证据：temp/integration-test-runs/live-2026-10-03T21-14-55-960Z/。
- 单元测试49项通过；源码包独立验证再次执行安装、类型、单元、正式构建及演示构建，结果由下载旁的 source-integrity.json 单独记录。
- 最终视觉检查：temp/integration-test-runs/visual-v7-2026-10-04T13-58-04-486Z/。成员首条记录267px，请求历史297px；正文未进入截图。
- 侧栏与全屏详情复验：temp/integration-test-runs/sidebar-motion-2026-10-04T12-54-43-320Z/。详情从420px铺满1440px，Escape还原420px，收起导航48px；对象标题图标与三项详情标签可见。
- 原版参考：固定AdminCN Free在本地1440×1000渲染，temp/integration-test-runs/reference-v7-clean-2026-10-03T21-01-58-019Z/。组件样式未改；仅限定构建扫描范围、关闭开发标识和外部GitHub小挂件。
- 总览图表禁用初始数值动画，成员状态色对齐原版语义；最后两项视觉调整分别完成对应聚焦复验。
- 真实正文未进入公开原型、普通CSV、服务端缓存或证据。未执行生产部署、授权修改、真实生成、片场入口修改或race。
- 发布完成后，对原OpenDesign进行远端工作区复验和逐文件SHA-256回读；结果保存在 delivery-integrity.json。

## 现行边界

前端源码、正式/演示构建和fixture测试分别验收。四服务的部署、OIDC注册、owner委托与日常真实读取仍以来源能力矩阵为准。源码包在发布前冻结，发布回执作为外部证据，不循环写入归档自身。
