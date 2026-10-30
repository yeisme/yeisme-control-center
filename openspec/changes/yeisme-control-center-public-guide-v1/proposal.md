# Yeisme 控制中心：使用指南公开化，无需登录 v1

## Why

交互路线第三轮 T4（`docs/interaction-roadmap.md`）。用户希望“将使用指南设计为公开文档，无需登录使用”。

只读探查结果：

- **依赖登录的部分很少**：指南内容全是前端数据与组件，只有工具目录状态依赖登录。
- **服务器缺媒体支持**：缺少媒体类型和 Range 支持；任何缺失的文件都回退成 `index.html`，媒体元素会拿到 HTML。
- **发布与构建**：
  - 发布清单只带 `index.html`。
  - `lan-deploy` 没有复制迁移文件。
  - 构建把未跟踪的 `docs/reviews/` 一起复制进 `dist`，这些文件含家目录路径。
- **加载过重**：React 的 CommonJS 包装被分进了 Radix 分块，任何页面都要加载整个 Radix。

## What Changes

- **拆分页面**：`GuideContent` 不依赖路由、会话或接口。站内 `GuidePage` 传入实时工具目录；公开页不传，并改为链接到登录。
- **公开入口**：
  - `app/guide.html` 加 `src/guide-main.tsx`，作为第二个构建入口。
  - 页面有自己的顶栏（品牌、主题切换、登录控制中心）和页脚。
  - 工具与客户端的选择记在地址里。
  - 不发任何 `/api` 请求，不加载 Radix 分块。
- **入口互通**：登录页加“使用指南（无需登录）”。未登录访问 `#/guide` 时跳到 `guide.html`，保留 `?tool=&client=`。
- **服务器**（新的 `server/static.ts`，纯函数，可单测）：
  - 补齐 webp、jpg、mp4、webm、mp3、m4a 等类型。
  - 支持单段 Range：返回 206 或 416，带 `Accept-Ranges`，流式发送。
  - 缺失的带扩展名文件返回 404，不再回退为 HTML。
  - 只有带哈希的 `/assets/` 长期缓存，其余为 `no-cache`，带 `Last-Modified`、支持 304。
  - CSP 增加 `object-src 'none'; form-action 'self'`。
- **构建与发布**：
  - 分块按模块路径划分，React 不再落进 Radix 分块。
  - docs 复制排除 `docs/reviews/`。
  - `prepare-intranet-release` 与 `lan-deploy` 带上 `guide.html` 和 `dist/guide/`。
  - `lan-deploy` 补上复制迁移文件。
  - `verify-release-component` 检查无会话访问 `guide.html` 返回 200。
- **公开面**：
  - `check-public-surface` 增加私网 IPv4、家目录路径、内网主机名（只在地址或 `user@host` 里匹配）三条通用规则。
  - 修掉已有的 7 处家目录路径。
  - 指南源码全部纳入禁用文本检查。

## Owner Boundary

- 只改控制中心的前端、静态服务与发布脚本。公开页不读取任何账号、owner 或工具目录数据。
