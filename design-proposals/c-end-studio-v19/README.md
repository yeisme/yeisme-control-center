# Yeisme Studio v19 · C 端创作台原型

提案文档：[../../docs/design/c-end-experience-v1.md](../../docs/design/c-end-experience-v1.md)

这是「控制中心从 SaaS 控制台转向 C 端创作台」的可点原型，只覆盖四屏：

| 文件 | 内容 |
| --- | --- |
| `prototype/index.html` | 提案封面、三条原则、四屏入口、前后对比 |
| `prototype/today.html` | 今天：Hero、等你决定、正在片场、今天的产出 |
| `prototype/works.html` | 作品：画廊、类型/作品筛选、预览灯箱 |
| `prototype/drama.html` | 创作 · 剧集：五段阶段、每集下一步、今晚通告 |
| `prototype/mobile.html` | 手机端：底部 5 tab、单列、横向片场卡 |
| `screenshots/` | 渲染截图，含 `before-*` 现行版本与亮暗两套 |

## 边界

- 静态原型：不连接 owner、不发起写入、不进入构建、不在 `app/` 或 `src/` 注册路由。
- 画面使用项目内已有的公开演示素材（`public/guide/showcase`、`public/v18`），叙事沿用 fixture 的《雨夜重逢》。
- 令牌在 `prototype/tokens.css`，实现时迁入 `src/styles/tokens.css`，不复制第三套。

## 本地预览

```bash
cd client/yeisme-control-center
python3 -m http.server 4330 --bind 127.0.0.1
# http://127.0.0.1:4330/design-proposals/c-end-studio-v19/prototype/index.html
```

## 重新截图与核查

```bash
cd client/yeisme-control-center/design-proposals/c-end-studio-v19/prototype
TMPDIR=$PWD node capture.mjs "$BASE/today.html" ../screenshots/today-1440.png 1440 900 1
TMPDIR=$PWD node verify.mjs
```

> `capture.mjs` / `verify.mjs` 需要控制中心 `node_modules` 里的 Playwright；本机浏览器使用已经安装的 chromium headless shell 路径。
