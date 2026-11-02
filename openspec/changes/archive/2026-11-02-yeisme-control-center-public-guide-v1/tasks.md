# Tasks

## 1. 页面

- [x] 1.1 `GuideContent`（不依赖路由、会话、接口）；站内 `GuidePage` 改为包装
- [x] 1.2 `app/guide.html`、`src/guide-main.tsx`、`PublicGuide`（顶栏、主题切换、页脚、地址里的选择）
- [x] 1.3 登录页链接；未登录访问 `#/guide` 跳转并保留参数
- [x] 1.4 指南文件直接导入所需组件；构建分块按模块路径划分，公开页不加载 Radix 分块

## 2. 服务器

- [x] 2.1 `server/static.ts`：媒体类型、单段 Range、缺失文件 404、缓存头、304、CSP 补充；`server/index.ts` 流式发送

## 3. 发布与公开面

- [x] 3.1 发布清单与 `lan-deploy` 带上 `guide.html`、`dist/guide/`；`lan-deploy` 复制迁移文件；发布组件检查公开页
- [x] 3.2 docs 复制排除 `docs/reviews/`；公开面规则（私网 IPv4、家目录、内网主机名）；修掉已有家目录路径

## 4. 验证

- [x] 4.1 单元测试：`tests/static-files.test.ts`、`tests/public-guide.test.ts`、指南源码禁用文本
- [x] 4.2 `scripts/verify-public-guide.ts`（`bun run test:public-guide`）：真实服务器加生产构建，未登录打开、无 `/api` 请求、无 CSP 违规、地址参数、站内跳转、Range 与 404、axe 浅色深色与手机
