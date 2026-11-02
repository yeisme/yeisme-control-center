# Yeisme 控制中心：发布卫生与复验账号 v1

## Why

第五轮规划核对发布链路时，发现几处会让“发布了什么”和“以为发布了什么”不一致：

- `vite build` 的 `control-center-docs` 插件把整个 `docs/`（含未跟踪的笔记）复制进 `dist/`，`public/` 里被忽略的 `source.zip` 也随 publicDir 落进 `dist/`；应用的静态服务按目录发送，只有反向代理的一条规则挡着 `/docs/*` 与 `/source.zip`。
- `prepare-intranet-release.ts` 不自己构建，直接拷贝现成的 `dist/`，也不记录候选来自哪个提交、工作树是否干净；`release-manifest.mjs` 还把 `public/source.zip` 记进清单。
- 发布后只核对传输与静态资源，`authenticated_read` 恒为 `false`：没有任何一步用真实账号登录读回，看不到“只读账号能不能读到凭据引用、能不能进管理接口”。
- `SessionAuth.persistConfig` 把内存里的整份配置写回 `config.json`：服务运行期间用 `personal-config` 做的修改被覆盖，环境变量带来的值（Provider 端点、绑定地址）被写进文件。
- `personal-config` 只能把一次性密钥打印到终端，不能换密钥，被吊销的用户名不能恢复，也没有后台观察的开关命令。
- CI 没跑 `test:server-boot` 与 `test:public-guide`；`provider-live.yml` 传 `--*-cny`，而 `test-provider-live.ts` 对任何 `-cny` 参数直接抛错（预算只用 USD）；`test:task-visibility` 早已因界面重构失效，却还在 `package.json` 里。
- 附带：`test:public-guide` 在 HEAD 上就有一项失败——手机宽度下“接入”章节横向溢出 7px，原因是一条注释里的环境变量名没有换行点。要让 CI 运行它，就得一并修掉。

## What Changes

- 静态白名单：`server/served-entries.mjs` 是唯一列表（`index.html`、`guide.html`、`favicon.svg`、`favicon.ico`、`assets/`、`guide/`、`v18/`），`server/static.ts` 导出为 `servedEntries`；`planStatic` 对列表之外的真实文件一律 404（含路径穿越写法），页面地址仍回到应用首页。`vite build` 删掉 `control-center-docs` 插件，并在 `closeBundle` 删去 `dist/` 里白名单之外的顶层条目；`prepare-intranet-release.ts` 与 `lan-deploy.ts` 只复制白名单；`check-public-surface.mjs` 在存在 `dist/` 时对白名单之外的条目报 `unserved-dist-entry`；`release-manifest.mjs` 去掉 `source.zip`。
- 候选自己构建：`prepare-intranet-release.ts` 先 `bun run build`，在证据里记录 `source_commit`、`dirty`、`dirty_allowed`、`changed_files`；已跟踪文件与 HEAD 不一致时拒绝（`dirty_working_tree`），`YEISME_RELEASE_ALLOW_DIRTY=1` 才放行，未跟踪文件不算。判定是纯函数（`scripts/release-source.ts`）。`control-release.ts` 把 `source_commit`、`source_dirty` 写进部署清单。
- 复验账号读回：`scripts/live-readback.ts`（库）与 `scripts/verify-live-readback.ts`（命令）。用一个个人只读账号登录，**每次运行只登录一次**（登录限流全局 5 次/15 分钟），检查：`/session` 角色是 viewer；`/services`（不带 `observe=1`）不含 `credential_ref`、哈希引用和家目录路径；`/notifications` 为 200；`/observation/status` 为 200 或 404（404 记 `absent`）；`/admin/personal-users`、`/audit` 与对 `admin.user.revoke` 的预览都是 403；登出成功且会话随即失效。密钥来自 0600 文件（`YEISME_RELEASE_PROBE_FILE`：只有密钥，或 JSON `{username,key}`；用户名也可来自 `YEISME_RELEASE_PROBE_USERNAME`），密钥与 cookie 只在内存，证据只有状态码与简短原因。`readbackVerdict` 判定：只有 5xx 回滚，其余失败只标记。
- 接入发布：`control-release.ts` 设置了 `YEISME_RELEASE_PROBE_FILE` 时，在改动前读取密钥文件，激活并通过静态核对后运行读回，结果记入 `verification.authenticated_read`；5xx 走原有回滚，401/429 与其他失败只标记失败。`verify-release-component.ts` 默认端口改为 4380（不再是 4313），候选以 `YEISME_CONTROL_BACKGROUND=off` 启动并关掉隔离配置的 `observation`，确认 `/source.zip` 与 `/docs/README.md` 是 404，并在隔离配置里建一个一次性 viewer 对候选做读回。
- 账号命令：`personal-config` 新增 `user add … --key-file <新文件>`（密钥写入新建 0600 文件、不打印、文件已存在则拒绝；不带该选项时沿用只显示一次）、`user rotate <用户名> [--key-file]`（换密钥，该账号已有会话立即失效）、`user enable <用户名>`（恢复被吊销的账号）、`observe on|off [--interval-minutes N] [--open-tools-every N] [--recipients …]`（写 `config.observation`：间隔至少 5、默认 10；`open_tools_every` 至少 1、默认 3）。动作写在配置文件之前（`user add <配置文件> …`）也接受。
- 账号管理只改账号：`persistConfig` 重新读取配置文件，只替换 `personal.users`，经同目录临时文件原子改名写回（0600）；运行期间用命令行新增的账号会保留，读不到文件时创建账号返回 503 且不留半成品，吊销仍先在内存生效。
- CI：`ci.yml` 在构建后运行 `test:server-boot` 与 `test:public-guide`；`provider-live.yml` 的输入改为 `total_usd`、`image_usd`、`video_usd`、`audio_usd`，`run_label` 与 `modality`（单选）必填，经 `env:` 传给脚本、`run:` 里没有表达式，并先做一次不带密钥的 `--dry-run` 预算检查；参数解析移到 `scripts/provider-live-args.ts`，未知参数与重复参数一律报错；删除失效的 `test:task-visibility` 与 `scripts/verify-task-visibility.ts`。
- 附带修复：`.guide-command-note` 加 `overflow-wrap: anywhere`，让 `test:public-guide` 重新通过。

## Impact

- 构建输出只有白名单内容；`docs/` 与 `source.zip` 不再出现在 `dist/`、候选或发布清单里。反向代理的阻断规则保留，作为第二层。`public/docs/third-party/` 里的许可证文本留在仓库，不再随构建发布（它们本来就被代理阻断，页面也没有链接）。
- `prepare-intranet-release.ts` 会自己构建并拒绝脏树；确需带改动构建时设 `YEISME_RELEASE_ALLOW_DIRTY=1`，证据里会留下 `dirty: true`。
- 组件验证的默认端口从 4313 变为 4380；`YEISME_RELEASE_VERIFY_PORT` 仍可覆盖。
- 没有数据库迁移，没有 HTTP 接口变化；`personal-config user add` 不带 `--key-file` 时行为不变。网页创建账号的接口行为不变，但配置文件读不到时返回 503。
- `package.json` 只删除了 `test:task-visibility`；没有新增脚本入口，读回命令直接用 `bun scripts/verify-live-readback.ts`。
- 线上还没有复验账号：发布下一版前需用 `personal-config user add … viewer … --key-file` 建一个并设置 `YEISME_RELEASE_PROBE_FILE`。
