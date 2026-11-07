# Design · Yeisme Studio v21

完整设计见 `docs/design/studio-v21.md`，包括原则、层级表、动效规则、各页交互和前后对比。这里只记录实现上的决定。

## 边界

- **职责不变**：控制中心仍是「观察 · 决定 · 交接」，不编辑剧本、分镜或时间线。
- **新增写入只有账号管理接口**。它们要求个人管理员会话和 `auth.csrf`，用 `audited()` 记审计，在 `withConfigLock` 里写入。
- **能力开关**：账号管理由 `personal.web_accounts.manage` 控制，默认开启，设为 `false` 关闭。
- **不做**：不签发 owner 凭据，不付费，不做真实取消，不部署，不提交。
- **他人在制的文件**一律不动：
  - `src/pages/prompts/*`
  - `server/prompt-library.ts`
  - `server/db/prompt-collection-store.ts`
  - 迁移 `0012_known_bucky`
  - `scripts/verify-prompt-library.ts`
  - `docs/prompt-library*.md`
  - `docs/live-read-integration.md`
  - `src/pages/requests/RequestDetail.tsx`

  `InspectorShell` 与 `DetailSheet` 的 props 因此必须保持向后兼容。
- **不新增依赖**：动效策略脚本会拦未批准的动画库。

## 决定

### D1 层级刻度

`tokens.css` 定义 `--z-*` 一组，取代散落在各文件里的字面值。

| 层 | z 值 |
|---|---|
| sticky | 20 |
| nav | 30 |
| dock | 35 |
| inspector | 44 / 45 |
| sheet | 50 / 51 |
| palette | 60 / 61 |
| grain | 65 |
| viewer | 70 / 71 |
| popover | 80 |
| critical | 86 / 87 |
| toast | 88 |
| tooltip | 90 |
| skip | 95 |

规则：

- 从检查器里打开的抽屉，一定在检查器之上。
- 胶片颗粒层在大图之下。
- 对话框里的菜单和提示框，一定在对话框之上。

### D2 复制

`copyText()` 按顺序尝试：

1. 安全上下文下，用 `navigator.clipboard.writeText`。
2. 否则，把 textarea 挂进当前打开的对话框（`activeElement.closest('[role=dialog]')`），避开焦点陷阱，再执行 `execCommand("copy")`。

只有一次性的 `copy` 事件监听确实触发并写入了 `clipboardData`，才算复制成功。失败时，手动复制框是多行 textarea，打开即全选。

### D3 列表

- **纯函数**：页窗口、排序、偏好、查询、匹配、计数都写在 `src/shared/**`，各配单元测试。
- **页码**：写在地址的 `page` 参数里，筛选一变就归 1。叠层参数统一走 `useOverlayParams`，所以按后退会先关最上层。
- **每页数量与密度**：按账号存成 `yeisme.prefs.v1:<id>`，第一次读取时迁移旧的 `list-preferences` 值。
- **窄屏卡片**：表格容器窄于 560px 时，每行变成卡片，规则写在容器查询里。
- **保留的行为**：行按钮 `[data-row-button]`、空格键、Shift+F10 不变。

### D4 任务查询只在已读批次上

- **不建索引**：不建服务端任务索引，owner 合同也没有筛选参数。
- **查询范围如实写明**：读到第几页、还有没有更早的历史。
- **继续读取**：每次多读 8 页历史，可以取消。游标过期时提供「从头读取」。

### D5 搜索

- **一个匹配器**：⌘K、页内搜索和查询语法共用 `src/shared/search/match.ts`。
- **预处理**：先做 NFKC 规整，再统一大小写。
- **打分顺序**：完全相同 > 前缀 > 词首 > 包含 > 子序列。匹配器同时返回命中区间，用于高亮。
- **服务端补查**：至少 2 个字才发出，防抖 300ms，可取消，结果缓存 15 秒。
- **预览**：只用已缓存的缩略图，不申请新的预览句柄。

### D6 账号

- **只用访问 Key**：登录仍是用户名加访问 Key，没有密码。
- **新 Key 只给一次**：重置后只在响应里返回一次，不进地址，也不写日志。
- **摘要文件**：以 0600 原子替换，该账号的现有会话随即失效。
- **防护**：
  - 不能撤掉最后一个管理员（`last_admin_required`）。
  - 不能停用自己（`cannot_revoke_self`）。
  - 旧版所有者账号只能用命令行管理（`legacy_owner_managed_by_cli`）。
  - 改资料带 `if_match`，冲突返回 409 `user_changed`。
- **旧路径**：`/actions` 仍拒绝 `admin.user.create`。

### D7 动效规则 v21

这一条取代 v20 的「≤3px」。

- **微交互**（悬停、按下、选中、指示条）：90–180ms，位移不超过 3px。
- **空间动效**（面板、抽屉、浮层、共享元素、路由）：200–320ms。
  - 沿真实几何，从触发点或屏幕边缘出来。
  - 退场时长约为入场的 0.7 倍。
  - 不回弹，可以打断，第一帧就能读。
- **减少动效**：只做透明度变化，不超过 120ms，或直接切换。
- **可动的属性**：只用 transform、opacity 和 filter。

### D8 大图不走 View Transition

- **为什么**：大图在 Radix 传送门里，原图还要等异步授权，View Transition 无法原子地切换。
- **怎么做**：大图用 WAAPI 做 FLIP，从 `[data-viewer-origin]` 放大打开，关闭时缩回原处。
- **单图约束**：非对比模式下，`.viewer-stage` 里只有一张 `<img>`。占位图、相邻图和氛围背景都用 div 加 background-image。
- **只读已有数据**：手势和信息抽屉都只用已有数据，不预取相邻的原图。

### D9 右侧面板一个外壳

- **共用外壳**：`SidePanel` 同时给 `InspectorShell` 和 `DetailSheet` 用。
- **三种布局**：
  - ≥1280：停靠成浮卡，四周内缩 12px。
  - 768–1279：抽屉，点遮罩即关闭。
  - <768：底部 sheet，可以拖动，吸附在 60% 或 94%。
- **宽度**：范围 400–720px，默认 `clamp(400px,34vw,520px)`，调过的宽度按账号保存。
- **切换条目**：只交叉淡化正文，外壳不重挂。
