# Tasks

## 1. 静态白名单与构建

- [x] 1.1 `server/served-entries.mjs` 作唯一列表（服务端、构建、发布脚本、公开面检查共用，`.d.mts` 给 TypeScript），`server/static.ts` 导出 `servedEntries`；`planStatic` 对列表之外的真实文件 404，含 `..` 与编码写法，不带扩展名的页面地址仍回首页 | evidence: `tests/static-files.test.ts` 8 项通过；去掉白名单判断后其中 2 项失败（变异检查）
- [x] 1.2 `vite.config.ts` 删去 `control-center-docs` 插件，`closeBundle` 删除 `dist/` 里白名单之外的顶层条目；`public/source.zip` 本身不动 | evidence: 构建后 `dist/` 只有 `assets guide guide.html index.html v18`，`public/source.zip` 仍在
- [x] 1.3 `prepare-intranet-release.ts`、`lan-deploy.ts` 按 `servedEntries` 复制；`check-public-surface.mjs` 对 `dist/` 里的白名单之外条目报 `unserved-dist-entry`；`release-manifest.mjs` 去掉 `source.zip` | evidence: 往 `dist/` 放 `docs/README.md` 与 `source.zip` 后检查失败并列出两项，清掉后通过；候选 2799 个指纹文件里没有 `source.zip` 与 `docs/`
- [x] 1.3a 附带：`.guide-command-note` 加 `overflow-wrap: anywhere`（HEAD 上 `test:public-guide` 就因手机宽度下“接入”章节溢出 7px 失败，在干净的 HEAD 副本上复现过） | evidence: `test:public-guide` 12/12 通过

## 2. 候选自己构建

- [x] 2.1 `prepare-intranet-release.ts` 先 `bun run build`，记录 `source_commit`、`dirty`、`dirty_allowed`、`changed_files`；已跟踪文件有改动时拒绝（`dirty_working_tree`），`YEISME_RELEASE_ALLOW_DIRTY=1` 放行，未跟踪文件不算；判定在纯函数 `scripts/release-source.ts` | evidence: 脏树上实跑：拒绝（31 个文件，未构建）；加 `YEISME_RELEASE_ALLOW_DIRTY=1` 通过且 `built_here: true`；`tests/release-scripts.test.ts` 14 项含真实 git 仓库用例，去掉拒绝判断后 2 项失败
- [x] 2.2 `control-release.ts` 把 `source_commit`、`source_dirty` 写进部署清单与证据 | evidence: 静态核对 + 类型检查；该脚本会改线上 unit，本轮未运行

## 3. 复验账号读回

- [x] 3.1 `scripts/live-readback.ts`（`loadProbeCredentials`、`runLiveReadback`、`readbackVerdict`）：一次登录、内存 cookie、检查 viewer 角色、`/services` 不含秘密、`/notifications`、`/observation/status`（404 记 absent）、三项 403、登出并确认会话失效；密钥文件 0600，纯密钥或 JSON（`key`/`access_key`），用户名可来自 `YEISME_RELEASE_PROBE_USERNAME` | evidence: `tests/live-readback.test.ts` 14 项，真实应用在进程内、`fetch` 可注入；结果里没有密钥、cookie、地址
- [x] 3.2 `scripts/verify-live-readback.ts`：证据写 `temp/integration-test-runs/<name>-<时间>/`，退出码反映结果，HTTPS 用部署 CA | evidence: 在本机私有端口起的服务（临时配置，含一个 viewer）上实跑通过 10 项；错误密钥得 `login_unauthorized`，第 6 次得 `login_rate_limited`（登录限流 5 次）；权限过松、缺用户名的探针文件在发请求前失败；用一次性本地 CA 验证 Bun `tls.ca`：带 CA 到达服务器，不带得 `login_tls`
- [x] 3.3 `control-release.ts`：设置了 `YEISME_RELEASE_PROBE_FILE` 时，改动前读取探针文件，激活并通过静态核对后运行读回，记入 `verification.authenticated_read`；5xx 走原有回滚，401/429 与其他失败只标记 | evidence: `readbackVerdict` 单测覆盖 503、后续 500、401、429、网络不可达、非 viewer 账号；脚本未在线上运行
- [x] 3.4 `verify-release-component.ts`：默认端口 4380，候选带 `YEISME_CONTROL_BACKGROUND=off` 且隔离配置关掉 `observation`，确认 `/source.zip`、`/docs/README.md` 为 404，在隔离配置里建一次性 viewer 做读回 | evidence: 对本轮候选实跑（临时 HOME 与私有端口，未碰线上配置）通过，读回 10 项通过，隔离目录已清理

## 4. 账号命令与配置回写

- [x] 4.1 `personal-config user add … --key-file`（新建 0600 文件、不打印、已存在则拒绝且不留半成品）、`user rotate`、`user enable`、`observe on|off`；动作写在配置文件之前也接受 | evidence: `tests/personal-config.test.ts` 17 项（新增 8 项）：密钥与摘要匹配、输出无密钥、旧密钥不再匹配新密钥匹配、配置文件字节不变、非法值不改写文件（inode 不变）
- [x] 4.2 `SessionAuth.persistConfig` 重新读取配置文件，只替换 `personal.users`，临时文件原子改名、0600；创建账号在读不到文件时 503 且不留半成品，吊销仍先在内存生效 | evidence: `tests/personal-auth.test.ts` 14 项（新增 5 项）：保留运行期间对文件的修改与命令行新增的账号、不写入环境来源的值、无临时文件残留；改回整份写回后新增的第一项失败（变异检查）
- [x] 4.3 轮换密钥后该账号已有会话立即失效 | evidence: 同一测试文件用真实命令行轮换：下一次请求 401，旧密钥 401，新密钥 200

## 5. CI 与 canary 工作流

- [x] 5.1 `ci.yml` 在构建后运行 `test:server-boot` 与 `test:public-guide` | evidence: `tests/release-scripts.test.ts` 核对步骤存在且在构建之后；本地两项通过（8/8、12/12）
- [x] 5.2 `provider-live.yml` 输入改为 `total_usd/image_usd/video_usd/audio_usd`，`run_label` 与 `modality`（单选）必填，经 `env:` 传入，`run:` 里没有表达式，先做一次无密钥的 `--dry-run`；参数解析移到 `scripts/provider-live-args.ts`（拒绝 CNY、未知、重复与缺值参数） | evidence: 测试按 shell 的展开方式还原两条命令并交给脚本自己的解析器；把 `--confirm-live` 当作标签输入会被拒；本地以 `bun run test:provider-live -- --dry-run …` 实跑通过
- [x] 5.3 删除失效的 `test:task-visibility`（`package.json` 条目与 `scripts/verify-task-visibility.ts`），确认没有其他引用；`docs/current-status.md` 同步 | evidence: 测试断言每个工作流里的 `bun run` 脚本都存在、`package.json` 指向的脚本文件都存在

## 6. 验证

- [x] 6.1 全量检查 | evidence: `bun run typecheck` 通过；`bunx vitest run` 75 个文件 581 项通过（基线 72/498）；`bun run build`；`bun run check:public-surface`（0 个发现）；`test:server-boot` 8/8；`test:public-guide` 12/12；`CI_UI_PORT=4350 CI_LIVE_PORT=4351 test:ci:browser` 4/4；`CONTRACT_OWNER_PORT=4385 CONTRACT_API_PORT=4388 test:contract-integration` 42/42
- [x] 6.2 `openspec validate yeisme-control-center-release-hygiene-v1 --strict --no-interactive` | evidence: 输出 `Change 'yeisme-control-center-release-hygiene-v1' is valid`
