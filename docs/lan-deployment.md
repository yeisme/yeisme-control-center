# 控制中心运行与部署边界

正式入口统一由 `YEISME_CONTROL_ORIGIN` 管理。默认本地配置为：

```bash
export YEISME_CONTROL_ORIGIN=http://127.0.0.1:4312
export YEISME_CONTROL_BIND=127.0.0.1
```

loopback 本地测试允许 HTTP；任何可被其他设备访问的入口必须使用 HTTPS。`0.0.0.0` 只能作为显式监听地址用于受控联调，不能写入浏览器 URL，也不能绕过 HTTPS 要求。

## 本地验证

```bash
bun install --frozen-lockfile
bun run build
YEISME_CONTROL_ORIGIN=http://127.0.0.1:4312 YEISME_CONTROL_BIND=127.0.0.1 bun run serve
curl --fail "$YEISME_CONTROL_ORIGIN/api/control-center/v1/health"
```

v18.1 使用同一根入口：

```bash
curl --fail -I "$YEISME_CONTROL_ORIGIN/"
```

未登录的业务读取应返回 `401 login_required`。健康端点只证明控制中心进程响应，不证明 owner、Provider 或真实业务数据可用。

## 真实开发预览

需要在本机浏览真实 owner 读取时，使用临时配置启动预览；不会覆盖用户配置，也不会启动写操作：

```bash
export YEISME_PREVIEW_PASSWORD='仅用于本次预览的临时密码'
bun run preview:real
```

预览 UI 使用 `http://127.0.0.1:4298/`，控制中心 API 使用 `http://127.0.0.1:4312`。启动器复制现有连接定义到临时目录，退出后清理临时配置和登录密码。浏览器验收使用：

```bash
bun run test:preview:real
```

这条路径只验证真实只读合同；它不替代外部 HTTPS 部署，也不触发 Provider 生成、取消或账务操作。

受控局域网开发联调可以显式绑定 `0.0.0.0`：

```bash
YEISME_PREVIEW_BIND=0.0.0.0 YEISME_PREVIEW_UI_HOST=0.0.0.0 bun run preview:real
```

该模式只用于开发预览；正式外部入口仍必须使用 HTTPS，且不把实际机器地址提交到仓库。

## 外部 HTTPS 部署契约

部署前必须提供一个由部署环境负责解析和签发证书的 HTTPS origin，并通过环境变量传入：

```bash
export YEISME_CONTROL_ORIGIN=https://<internal-control-center-host>
export YEISME_CONTROL_BIND=127.0.0.1
bun run build
bun scripts/prepare-intranet-release.ts
```

仓库不保存实际主机名、IP、证书、账号、密码、observer token 或 Provider 凭据。反向代理只转发到 loopback 应用端口，并阻断 `/docs/`、`/source.zip` 和源码路径；应用本身也只发送白名单里的文件（见下节），两层互为纵深。

## 运行命令

```bash
systemctl --user status yeisme-control-center.service
systemctl --user restart yeisme-control-center.service
journalctl --user -u yeisme-control-center.service --since today
```

停止控制中心不会停止 owner 服务，也不会删除任务、资产或凭据。发布切换必须先通过候选构建和组件验证；失败时恢复 `previous_release`，不得覆盖开发目录。

含数据库迁移的发布，在切换前先做升级演练：用 SQLite 自带的 `VACUUM INTO` 复制运行中的配置库（不要直接拷贝 WAL 文件），用不含任何 owner 连接的最小配置、在副本上启动候选包，确认迁移条数增加、既有表行数不变、`PRAGMA integrity_check` 为 `ok`、没有外键违规；再用当前线上版本启动同一份已升级的副本，确认回滚只需恢复 unit。切换前另存一份同样方式生成的恢复点备份，权限 0600，放在控制中心状态目录下的 `backups/`。演练副本用完即删。

组件验证默认在 4380 启动候选服务（4313 属于开发预览，不再是默认）。该端口被占用时，验证会以 `verification_port_in_use` 失败，而不会误测占用端口的服务；改用空闲端口：

```bash
YEISME_RELEASE_VERIFY_PORT=4350 bun scripts/verify-release-component.ts <candidate-run>
```

候选服务以 `YEISME_CONTROL_BACKGROUND=off` 启动，隔离配置里的 `observation` 也被关掉，所以候选不会自己读任何 owner。

## 发布卫生

**静态文件白名单。** 应用只发送 `server/served-entries.mjs` 列出的条目：`index.html`、`guide.html`、`favicon.svg`、`favicon.ico`、`assets/`、`guide/`、`v18/`。同一份列表被服务端、`vite build`、`prepare-intranet-release.ts`、`lan-deploy.ts` 和 `check:public-surface` 共用：

- 白名单之外的真实文件（源码包、`docs/`、测试证据）一律 404，路径穿越（`/assets/../docs/...`）也不例外；不带扩展名的页面地址仍回到应用首页。
- `vite build` 不再复制 `docs/`，并在 `closeBundle` 删去 `dist/` 里白名单之外的顶层条目（`public/source.zip` 本身不动，只是不进 `dist/`）。
- `bun run check:public-surface` 在存在 `dist/` 时，发现白名单之外的条目就失败（`unserved-dist-entry`）。
- 组件验证确认候选上 `/source.zip` 与 `/docs/README.md` 都是 404。

**候选自己构建，并记录来源。** `bun scripts/prepare-intranet-release.ts` 自己执行 `bun run build`，不会拿现成的 `dist/` 当发布；证据（`env.json`、`summary.json`）记录 `source_commit`、`dirty`、`dirty_allowed`、`changed_files`。已跟踪文件与 HEAD 不一致时拒绝构建（`failure: dirty_working_tree`），未跟踪文件不算；确实需要时设 `YEISME_RELEASE_ALLOW_DIRTY=1`，记录里会留下 `dirty: true`。`control-release.ts` 把 `source_commit` 与 `source_dirty` 写进部署清单。

## 复验账号与登录后读回

登录后的读回用一个个人只读（viewer）账号，永远不用管理员。创建账号与密钥文件（密钥写入新建的 0600 文件，不显示在终端，文件已存在则拒绝）：

```bash
bun scripts/personal-config.ts user <配置文件> add <用户名> viewer <显示名> --key-file <新密钥文件>
bun scripts/personal-config.ts user <配置文件> rotate <用户名> --key-file <新密钥文件>   # 换新密钥；该账号已有会话立即失效，无需重启
bun scripts/personal-config.ts user <配置文件> revoke <用户名>
bun scripts/personal-config.ts user <配置文件> enable <用户名>                          # 恢复被吊销的账号；旧密钥随之重新有效，疑似泄漏就先 rotate
```

不带 `--key-file` 时 `user add` 与 `user rotate` 沿用“只显示一次”的行为。动作也可写在配置文件之前（`user add <配置文件> ...`）。

密钥文件（`YEISME_RELEASE_PROBE_FILE` 指向它，权限必须是 0600 的普通文件）有两种内容：

- 只有密钥本身（第一行）；用户名由环境变量 `YEISME_RELEASE_PROBE_USERNAME` 提供；
- 或 JSON `{ "username": "<用户名>", "key": "<访问密钥>" }`（`access_key` 也认，所以 `user add` 的输出可以原样保存）。环境变量里的用户名优先于文件里的。

```bash
YEISME_RELEASE_PROBE_FILE=<密钥文件> YEISME_RELEASE_PROBE_USERNAME=<用户名> bun scripts/verify-live-readback.ts [--name <证据前缀>]
```

目标 origin 取 `YEISME_CONTROL_ORIGIN`，缺省读部署清单；HTTPS 目标用部署的 CA 校验（`YEISME_RELEASE_CA_FILE`，缺省为清单旁的公开 CA 副本）。每次运行**只登录一次**（登录限流是全局的，15 分钟 5 次）；检查项：`/session` 角色是 viewer；`/services`（不带 `observe=1`，不问任何 owner）不含 `credential_ref`、哈希引用和家目录路径；`/notifications` 为 200；`/observation/status` 为 200 或 404（404 记为 `absent`，不算失败）；`/admin/personal-users`、`/audit` 与对 `admin.user.revoke` 的预览都是 403；登出成功且会话随即失效。证据在 `temp/integration-test-runs/<前缀>-<时间>/`，只含状态码和简短原因，没有密钥、cookie、地址或响应正文。

`control-release.ts` 在设置了 `YEISME_RELEASE_PROBE_FILE` 时，激活并通过静态核对后运行同一读回，结果写入部署清单的 `verification.authenticated_read`：任何响应是 5xx 都走原有回滚；登录被拒（401）、被限流（429）或其他检查失败只把读回标为失败，不回滚。密钥文件在改动任何东西之前就读取，文件不可用时命令直接失败。

## 后台观察开关

服务端后台观察（无需打开浏览器也能把失败与凭据问题变成提醒）由配置里的 `observation` 控制，服务启动时读取：

```bash
bun scripts/personal-config.ts observe <配置文件> on [--interval-minutes N] [--open-tools-every N] [--recipients <issuer|subject>,...]
bun scripts/personal-config.ts observe <配置文件> off
```

`--interval-minutes` 至少 5（默认 10，上限 1440）；`--open-tools-every` 至少 1（默认 3）；`--recipients` 缺省是每个已启用的管理员，`--recipients default` 恢复缺省。`off` 保留已设的参数。设置后需重启服务。

## 账号管理不改别的配置

网页里创建、吊销账号时，服务端重新读取配置文件，只替换 `personal.users`，经同目录临时文件原子改名写回（0600）。所以服务运行期间用 `personal-config` 做的其他修改（观察开关、开放工具、连接等）不会被覆盖，也不会把环境变量带来的值（Provider 端点、绑定地址）写进文件；运行期间用命令行新增的账号也会被保留。配置文件读不到时，创建账号返回 503 且不留半成品；吊销则先在内存里生效再尝试写文件。

## Provider 与 owner 状态

Provider transport、action contract、任务观测、内容读取和真实生成分别验收。`configured`、`transport verified` 或 `tools/list` 成功都不能直接推导业务 ready。真实 canary 只允许在明确预算和 owner 授权下运行：

```bash
bun run test:provider-live -- --confirm-live --modality audio --run-label <新标签> --total-usd 0.5 --audio-usd 0.5
```

预算以 USD 给出，原样交给 owner，不换汇。各模态的准入与证据要求见 [Provider 实时调用](provider-live.md)。

当前状态以 [当前实现状态](current-status.md) 为准；本文件不记录真实部署地址或秘密配置。
