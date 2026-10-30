# Tasks

## 1. 历史约定

- [x] 1.1 `src/app/overlay-history.ts`：`overlayMove`（打开 / 切换 / 关闭 / 其他）、`querySignature`、`useOverlayParams`（读取当前地址与记录 key；关闭时按打开位置退回或替换）；单元测试
- [x] 1.2 查看器 `close` 立即置为关闭；`urlParam` 让查看器跟随 popstate

## 2. 接入

- [x] 2.1 任务中心、资源库、请求记录、模型与工具、剧集、首页工作项改用 `useOverlayParams`；首页工作项跳转不先关闭

## 3. 验证

- [x] 3.1 浏览器旅程：7 个详情与浮层的后退与 Esc 后后退、任务详情内查看器的嵌套关闭；资源库逐层后退保持通过
- [x] 3.2 单元测试、类型检查、构建、`test:ci:browser`、共享项目旅程、axe 门、公开面扫描
