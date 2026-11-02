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
bun scripts/personal-config.ts user <配置文件> revoke <用户名>                          # 已有会话立即失效，旧密钥不再能登录，无需重启
bun scripts/personal-config.ts user <配置文件> enable <用户名>                          # 恢复被吊销的账号；旧密钥随之重新有效，疑似泄漏就先 rotate
```

不带 `--key-file` 时 `user add` 与 `user rotate` 沿用“只显示一次”的行为。动作也可写在配置文件之前（`user add <配置文件> ...`）。

**账号变更不需要重启。** 服务端在处理登录、已登录的请求和 `/auth/methods` 之前，以及后台观察每个周期开始时，用一次 `stat`（inode、大小、修改与变更时间）比对配置文件；文件变了，就只重新读取其中的 `personal.users`，一次换入：新账号马上可以登录；被吊销的账号已有会话在它的下一个请求就结束（401），旧密钥登录被拒；`enable` 之后旧密钥重新可用；`rotate` 改的是密钥摘要文件，已有会话在下一个请求失效。文件里别的内容（观察开关、连接、开放工具）仍然只在启动时读取，改了要重启。读不到的文件、坏掉的 JSON、不是列表的 `users` 都不会清空内存里的账号，下个请求再读。命令的输出里 `restart_required: false` 就是这个意思。

**配置文件锁。** 控制中心（网页创建、吊销账号）和 `personal-config`（所有写配置的命令）改写配置文件，都先取同一把由内核持有的独占锁：配置文件旁的一个小 SQLite 文件 `<配置文件>.lock.sqlite`（第一次用到时创建，权限 0600，里面不存任何东西），用 `BEGIN IMMEDIATE` 在整个“读、改、写、改名”期间占住。锁属于进程：持有者无论怎样退出（包括被 `kill -9`），内核立刻放掉它，所以没有“遗留的锁”，也没有按 pid、按时间去判断并清除别人的锁这回事。等不到锁最多等约 5 秒：控制中心返回 503 `config_busy`（已经做出的吊销仍在进程内生效，并随下一次写文件存盘），命令行用中文报错、什么也不写。慢的部分（口令哈希、密钥生成）在取锁之前做，锁内只做“重读、改、写、改名”。控制中心在锁内重新读文件、从这份新内容出发应用自己的修改（以及还没存盘的吊销）；命令行在开始读配置时记下文件的版本（inode、大小、修改与变更时间），取锁后发现文件已被别人改过，就报“配置文件在读取后被改动，请重新运行”并且不写，所以两边谁也不会用旧副本盖掉对方刚存的内容（例如命令行 `user add` 的哈希计算期间网页做了吊销）。两边在改名之前还会再核对一次版本：有人没取锁就改了文件，这次写入作废（控制中心在新内容上重做，最多三次，仍不行返回 503 `config_busy`；命令行报同样的“被改动”并且不写）。命令因此中止时，它刚做出的密钥文件和摘要文件会一并删掉，重新运行即可。锁内做的事必须是同步的：加锁的辅助函数拒绝返回 Promise 的工作（会在放锁之后抛 `TypeError`），因为锁一旦跨着 `await` 持有，同一进程里别的工作就是在这把锁底下运行；需要跨 `await` 持有的（测试、辅助进程）用 `acquireConfigLock` 取句柄，自己放锁，并且要一直拿着这个句柄，被回收的连接会把锁放掉。锁文件只在不存在时用 `wx` 创建，之后只用 `lstat` 和 `chmod` 查看，从不打开再关闭：POSIX 规定一个进程关闭同一个文件的任何一个描述符，就会放掉它在这个文件上持有的全部锁。旧版本留下的 `<配置文件>.lock`（内容是 pid 和时间）不再被读取，可以删掉；但还在运行的旧版服务和新版命令行互不排斥，部署新版后要重启服务，之后两边才共用这把锁。

**锁文件必须是当前用户的普通文件。** 每次取锁前先 `lstat` 检查 `<配置文件>.lock.sqlite`：是符号链接（会把锁引到别处）、管道或目录（打开管道会让进程一直挂住）、或属于另一个用户（当前用户打不开它，之后每次写入都会失败）时，不去用它，控制中心返回 503 `config_lock_invalid`（已经做出的吊销照旧在进程内生效，下一次写文件存盘），`personal-config` 用中文说明是哪一种并且什么也不写。处理办法是把它删掉：下一次写入会重新创建一个属于当前用户的 0600 文件。目录里不该有人去删正在使用的锁文件：删掉再重建的是另一个文件，持有旧文件的写入者和新的写入者就不再互相排斥。这些检查防的是配置不当，不是恶意的本地用户；配置文件所在目录只能属于服务用户。

**配置文件是符号链接时。** 两边都先解析到真实文件（`realpath`）：锁文件放在真实文件旁，写入和改名作用于真实文件，符号链接本身保持为链接，所以一边用链接、一边用真实路径也互相排斥，不会各自拿着不同的锁。账号状态库的位置仍按配置里给出的路径推算，不会因为链接的目标换了目录而挪走。服务只在启动时解析一次路径（`server/index.ts`）：服务运行期间把符号链接改指向另一个文件，服务仍然读写、加锁原来的那个真实文件，而之后运行的 `personal-config` 会按新的指向走，两边就不再共用一份文件和一把锁。所以改动符号链接的指向之后要重启服务。

**用谁的身份运行命令。** `personal-config` 的写操作要求运行它的用户就是配置文件的所有者：用 `sudo` 改写一个属于服务用户的 0600 文件，会让文件变成 root 的，服务读不到它，命令却已经报告“账号变更无需重启”。所以身份不一致时命令用中文报错、什么也不写；写出的文件始终是 0600。服务端读不到配置文件（权限、坏 JSON、`users` 不是列表）时保持内存里的账号不变，并在日志里按文件版本记一行 `[control-center] account list reload failed: <代码>`（只有代码，没有路径，同一版本只记一次）；`users: null` 视为空列表。

**账号是否启用只有一条规则。** 账号的 `enabled` 是 `true` 或根本没有这个字段（旧文件）才算启用；`false`、`"false"`、`0`、`null` 等任何别的值都算停用，不会因为手改成了字符串而意外启用。同一个用户名在 `users` 里出现多次时，所有同名条目都停用（日志记一行，不写用户名），直到手工删掉重复项。登录、已登录会话的权限判断、共享项目可选成员、凭据面板的管理员判断、后台提醒接收人都用这条规则；`personal-config user list` 显示的 `enabled` 也是它。

密钥文件（`YEISME_RELEASE_PROBE_FILE` 指向它，权限必须是 0600 的普通文件）有两种内容：

- 只有密钥本身（第一行）；用户名由环境变量 `YEISME_RELEASE_PROBE_USERNAME` 提供；
- 或 JSON `{ "username": "<用户名>", "key": "<访问密钥>" }`（`access_key` 也认，所以 `user add` 的输出可以原样保存）。环境变量里的用户名优先于文件里的。

```bash
YEISME_RELEASE_PROBE_FILE=<密钥文件> YEISME_RELEASE_PROBE_USERNAME=<用户名> bun scripts/verify-live-readback.ts [--name <证据前缀>]
```

目标 origin 取 `YEISME_CONTROL_ORIGIN`，缺省读部署清单；HTTPS 目标用部署的 CA 校验（`YEISME_RELEASE_CA_FILE`，缺省为清单旁的公开 CA 副本）。每次运行**只登录一次**（读回所在的来源地址，或它登录的那个账号，在 15 分钟内已经有过多次被拒的登录时，会得到 429 `login_rate_limited`；成功的登录和服务端自己的凭据文件问题不计数，另见下面“登录与会话的上限”）；检查项：`/session` 角色是 viewer；`/services`（不带 `observe=1`，不问任何 owner）不含 `credential_ref`、哈希引用和家目录路径；`/notifications` 为 200；`/observation/status` 为 200 或 404（404 记为 `absent`，不算失败）；`/admin/personal-users`、`/audit` 与对 `admin.user.revoke` 的预览都是 403；登出成功且会话随即失效。证据在 `temp/integration-test-runs/<前缀>-<时间>/`，只含状态码和简短原因，没有密钥、cookie、地址或响应正文。

`control-release.ts` 在设置了 `YEISME_RELEASE_PROBE_FILE` 时，激活并通过静态核对后运行同一读回，结果写入部署清单的 `verification.authenticated_read`：任何响应是 5xx 都走原有回滚；登录被拒（401）、被限流（429）或其他检查失败只把读回标为失败，不回滚。密钥文件在改动任何东西之前就读取，文件不可用时命令直接失败。

## 后台观察开关

服务端后台观察（无需打开浏览器也能把失败与凭据问题变成提醒）由配置里的 `observation` 控制，服务启动时读取：

```bash
bun scripts/personal-config.ts observe <配置文件> on [--interval-minutes N] [--open-tools-every N] [--recipients <issuer|subject>,...]
bun scripts/personal-config.ts observe <配置文件> off
```

`--interval-minutes` 至少 5（默认 10，上限 1440）；`--open-tools-every` 至少 1（默认 3，上限 1000）；`--recipients` 缺省是每个已启用的管理员，至多 100 个、每个不超过 200 个字符，`--recipients default` 恢复缺省。`off` 保留已设的参数。设置后需重启服务。

服务启动时检查整块 `observation`：`enabled` 要是布尔值，`interval_minutes` 是 5 到 1440 的数，`open_tools_every` 是 1 到 1000 的整数，`recipients` 是至多 100 个、每个不超过 200 个字符的非空字符串；缺省的可选键不算问题。任何一项不合格，**整块按未启用处理**，并按问题代码写一行日志（只写代码，不写值，例如 `observation_recipients_invalid`），`GET /observation/status` 也会标出配置无效；越界的值不会被悄悄夹进范围。`observe` 命令用的是同一份界限，并且写之前检查整块：它拒绝的，就是服务端会当作无效的。只有手改配置文件才写得出无效的块，这时下一次 `observe` 会列出问题代码、什么也不写，直到改正：数值或接收人越界的，用参数改正（例如 `observe <配置文件> on --interval-minutes 10`）；整块根本不是对象（比如被改成了字符串 `"yes"`）的，参数改不了，`observe` 以 `observation_not_an_object` 拒绝，不会把它展开进新块，要在文件里改正或删掉 `observation` 再运行（`null` 和没有这一项一样）。

## 登录与会话的上限

任何一个有效账号，哪怕是只读账号，都不能靠反复登录占满会话表、拖住别人的登录；不知道密钥的人也不能靠乱试名字，把所有人锁在外面：

- **被拒的登录按来源地址和账号分开计，15 分钟为一个窗口：** 同一个已有账号、同一个来源地址 5 次；同一个来源地址（不论试的是哪些名字）20 次；同一个已有账号、不论从哪些地址 50 次；整台服务 500 次（断路器，防很多地址同时来试）。不对应任何账号的名字只计入该地址的 20 次和整台服务的 500 次，碰不到任何账号自己的额度。所以一个地址上乱试名字，最多锁住这个地址自己，别的地址上的管理员照常登录；某个账号被一个地址试满 5 次，只有“这个账号加这个地址”被锁，同一个账号换一个地址仍可登录。每个额度都在做任何口令计算、占用“正在核验”标记之前检查，被拒的请求几乎没有代价，得到 429 `login_rate_limited`。成功的登录和服务端自己的凭据文件问题（503）不计入。
- **不是猜测的请求不计数。** 密钥或口令超过 1024 字节（按字节算，一个汉字三个字节）的登录请求永远对不上任何东西，口令校验也是不做任何运算就拒绝它；它不是对某个凭据的猜测，所以在任何计数之前就得到 400 `invalid_login_request`，不占任何额度，也就不能被人拿来几毫秒填满一个桶。用户名超过 80 个字符、整个请求超过 2048 个字符同样是 400，也不计数。
- **来源地址怎么定。** 控制中心只监听本机，前面是同机的 TLS 入口，所以连接对端总是这台入口，真正的客户端是它设置的 `X-Forwarded-For` 的最后一项。只有连接对端是本机回环地址（127.0.0.0/8、`::1`，不论写成哪种形式）时才相信这个头；其他任何对端发来的头都是客户端自己的说法，一律忽略，用对端地址。头缺失或不是合法地址时同样退回对端地址；没有对端信息时算作 `unknown`。对端地址在处理请求一开始就读取，不在读完请求体之后：客户端复位连接后套接字就不再知道对端，读晚了会把一个已经完整的请求算成来自“未知”。
- **每一台挡在控制中心前面的本机代理，都要自己写这个头。** 它要写的是它自己连接上的对端地址，不是原样转发客户端写的：转发了，任何能连到它的客户端就能自选来源地址。开发服务器（`bun run dev`、`bun run preview:*`，同一份 `vite.config.ts`）的 `/api/control-center` 代理已经这样做：它把 `X-Forwarded-For` 整个替换成自己连接上的真实对端（对端已经没有时删掉这个头），客户端写的任何值都到不了控制中心；有测试用这份配置启动开发服务器，证明伪造的头到达控制中心时是真实对端。自己再加的别的本机代理，如果原样转发客户端自带的头，客户端就能自选来源地址；这时每个账号 50 次和整台服务 500 次的额度仍然兜底，但那一层要改成也写自己的对端地址。
- **地址的写法和范围。** 地址先化成唯一的写法再计数，也再判断是不是本机：IPv6 压缩成小写的标准形式，IPv4 映射的 IPv6（`::ffff:192.0.2.1`、`::ffff:c000:201`）就是它带着的那个 IPv4 地址，区域标识（`%eth0`）去掉。所以 `2001:db8:0:0::1`、`2001:DB8::1` 是同一个客户端，`::ffff:7f00:1` 也是本机。IPv4 按单个地址计（/32），IPv6 按 /64 计：拿到 IPv6 的人至少有一个 /64，可以在里面随意换地址，按单个地址计就等于让一台机器想当多少个客户端都行。账号加地址、单个地址这两个桶按这个范围计；每个账号的 50 次和整台服务的 500 次与地址无关。
- **闲置会话先清掉。** 个人会话闲置满 30 分钟（以最后一次请求时间为准，该时间每分钟最多写一次）就在下一次请求或下一次登录之前被删除，不再占着名额等到 12 小时的绝对到期。
- **每个账号最多 8 个会话。** 同一账号再登录时，最早的会话被结束，而不是去撞全局的 100 个上限；全局上限只在很多账号同时在用时才会触发（503 `session_capacity`）。
- **每个账号 15 分钟内最多成功登录 20 次。** 第 21 次在做任何口令计算、占用“正在核验”标记之前就得到 429 `login_rate_limited`，只影响这个账号；失败的尝试不计入这份额度，所以不知道密钥的人没有办法替别人用光它，也不会因此结束别人的会话。
- **不存在的用户名与密钥错误一样处理。** 用户名不对应任何账号（也不是配置里的旧版所有者）时，用一个启动时生成一次的摘要做同样代价的校验，只计入该来源地址的失败次数和整台服务的断路器，并返回 401 `invalid_credentials`；即使旧版所有者的口令摘要文件读不到，也不会返回能把“存在的名字”和“不存在的名字”区分开的 503。
- 一个登录正在核验时到达的另一个登录得到 429 `login_busy`，几秒后再试即可；它不计入任何额度。
- **审计里的登录记录。** 被拒的登录，只有用户名与某个已配置账号完全一致时才记下这个名字，否则记为 `(unknown)`，所以把密钥误贴进用户名框也不会落进审计。被 429 拒绝的请求不逐条记；某个额度刚被填满的那一次记一条（`meta.bucket` 写明是哪个额度，每个额度每个窗口一条）。成功的登录照旧记录。

**剩下的风险。** 手里有至少 10 个不同真实地址（IPv6 则是 10 个不同的 /64）的攻击者，可以把某一个账号的 50 次失败额度用光，让该账号在 15 分钟内无法从任何地址登录；至少 25 个地址每个试 20 次，就能触发 500 次的整台服务断路器，15 分钟内所有人登录得 429。限额按进程计数，进程重启后从零开始。所以控制中心前面的入口只放在局域网里，不要暴露到不可信的网络；给每台设备发一个设备标识（设备 cookie）来分开计数，是以后可以做的跟进，目前没有做。

**要知道的另外两点。** 一是持有某个账号密钥的人，可以让这个账号的会话被结束（超过 8 个时最早的被结束），也可以用光它 15 分钟 20 次的成功登录额度，让账号真正的使用者在 15 分钟内无法新登录；所以一个账号只给一个人用，几个人共用的密钥要换掉（`user rotate`）。二是一个账号的额度已满时，错误的密钥得到 429，而不存在的名字得到 401，从这个差别能看出那个名字是个真实账号；账号加地址、账号这两个额度也一样。这是为了让限制在口令计算之前生效而接受的代价，所以账号名不要当作秘密。

## 账号管理不改别的配置

网页里创建、吊销账号时，服务端重新读取配置文件，只替换 `personal.users`，经同目录临时文件原子改名写回（0600）。写之前取上面的配置文件锁，并在锁内重新读取。所以服务运行期间用 `personal-config` 做的其他修改（观察开关、开放工具、连接等）不会被覆盖，也不会把环境变量带来的值（Provider 端点、绑定地址）写进文件；运行期间用命令行新增的账号也会被保留。配置文件读不到时，创建账号返回 503 且不留半成品；吊销则先在内存里生效再尝试写文件。

**吊销只增不减。** 网页吊销没能存进文件（目录只读、磁盘满、配置文件锁 5 秒内没等到而返回 503 `config_busy`）时返回 503，但该账号在这个进程里已经被吊销，并且记为“待存”：之后每一次写文件（例如再创建一个账号）都会带上它，每一次重新读取文件也会把它按吊销处理，所以它不会因为别的写入或别人改了文件而复活。文件一旦记下了吊销（网页自己在锁内写成功，或重读时看到文件里同名的所有条目都已停用，或账号已从文件里删除），“待存”就解除，之后以文件为准——此时用 `personal-config user enable` 恢复才有效。因为所有写入者都遵守同一把锁，并且命令行不会用读取之后又被改过的旧副本写回，所以网页写成功之后，不会再有别的写入把这次吊销悄悄改回来。进程重启会丢掉还没存进文件的吊销，所以 503 之后要在服务器上用 `personal-config user revoke` 补上。

网页不能通过 `/actions` 创建账号（`admin.user.create` 在目录里标为不可用，预览和确认都返回 422 `action_unavailable`）：新账号的访问密钥只显示一次，收据里没有地方放它。创建账号在服务器上用 `personal-config user ... add --key-file`；`POST /admin/personal-users` 仍可供脚本调用，密钥只在那一次响应里返回，网页界面不使用它。

## 凭据到期记录与续签

owner 与开放工具不会通过接口报告凭据何时到期，所以到期时间由签发的人记在配置里，紧挨着对应的 `credential_ref`（`credential_expires_at`、`credential_issued_at`，RFC 3339，要带秒和时区）。配置里的这两个字段本身不会发往浏览器；个人管理员的「服务」页「凭据」面板和各卡片页脚收到的是由它算出的到期时间，据此显示“还剩几天”，并在凭据文件读不到（不存在、不是普通文件、权限不是 0600、运行账号读不了、为空）或 owner 拒绝它时标出来。个人只读账号和 OIDC 会话收不到这一段。面板只列这个范围用得到的凭据：它的连接（含在控制中心里登记的工具项目）、它列出的开放工具、它绑定了的 owner 与 Provider，以及它绑定了 Auctra 项目时的 Auctra 两把密钥。

```bash
# 登记时一起记下（connect、open-tool、provider、auctra 都接受；二选一，--issued-at 可选）
bun scripts/personal-config.ts open-tool <配置文件> drivebridge https://<主机> <令牌文件> --expires-in 30d
bun scripts/personal-config.ts open-tool <配置文件> gateway https://<主机> <令牌文件> --expires-at 2026-11-30T00:00:00Z

bun scripts/personal-config.ts credential <配置文件> list                                  # 槽位、状态、到期时间；不含路径和地址
bun scripts/personal-config.ts credential <配置文件> expiry <槽位> <RFC3339|never|none>      # 给已在用的凭据补记，记成不过期，或清除
bun scripts/personal-config.ts credential <配置文件> replace <槽位> <新文件> --expires-in 30d  # 换上新凭据文件
```

槽位 id：`connection:<连接 id>`、`open_tool:<drivebridge|gateway>`、`provider:<owner>`、`owner:<owner>`、`collection:auctra`（收集密钥）、`collection:auctra:flow`（读取密钥）。`--expires-in` 接受 `<N>d` 或 `<N>h`；`--expires-at` 要带秒和时区。本来就不会过期的凭据（Auctra 的服务密钥，以及一些观察密钥）把到期时间记成 `never`（`--expires-at never` 或 `credential … expiry <槽位> never`）：配置里存的就是这个词，「服务」页写“不过期”，状态为正常、没有剩余天数，也不再永远提示“未记录到期时间”。只认全小写的 `never`；它不是日期，不能当 `--issued-at` 或 `--expires-in` 用，别的写法（`Never`、`forever`、只有日期）都会被拒绝，`credential … expiry` 另外认 `none`，用来清除记录。**先升级服务端，再记 `never`**：只有运行这份配置的控制中心已带上这项改动（第五轮 W5），才认这个词；旧服务端会把它读成“到期时间读不了”（`invalid_expiry`，一个要更正的记录），在服务页显示警告。`connect`、`open-tool`、`provider`、`auctra` 和 `credential replace` 都先用服务端读凭据的同一个函数检查文件：必须存在（所以先签发凭据，再登记）、是普通文件、0600、运行命令的账号读得了、不是空白，不满足就拒绝、什么也不写。`credential replace` 总当作新凭据，不给日期就清掉旧日期并提示，同一个旧文件上的其他槽位会列出来，它们要各自 `replace`；`open-tool --replace`、`provider` 与 `auctra --replace` 重跑时文件没变（只改地址或模型）就保留已记录的日期，文件变了才清掉。`credential expiry` 会点名共用同一文件的其他槽位，每个槽位各记各的到期时间。改完后重启服务。各工具的续签步骤见使用指南「接入」章节的「续签凭据」。

控制中心不签发、不续签凭据，也不会因为快到期就自行动作；这里只记录和提示。

## 剧集看板的 Auctra 服务

剧集制作看板的剧集和阶段来自一台 Auctra 服务，一部作品一台。Auctra 不允许一把密钥兼做两件事，所以要两把：`service-collector` 读收集库，`service-consumer` 读每集的阶段。形态如下，尖括号都是占位符：

```bash
# Auctra 一侧：监听控制中心服务器够得到的非本机地址，开启 HTTP 创作接口并确认远程 MCP
auctra serve --path <作品目录> --listen <非本机地址>:<端口> --http-authoring --mcp-remote-ack --mcp-access-key-file <作品目录>/.auctra/mcp/access-keys.json

# 签发两把密钥，各写进一个新的 0600 文件；--store 与上面服务用的是同一个密钥库
auctra mcp access-key issue --purpose service-collector --work-ref <项目引用> --key-file <新文件> --store <同一个密钥库>
auctra mcp access-key issue --purpose service-consumer --work-ref <项目引用> --key-file <新文件> --store <同一个密钥库>

# 控制中心一侧：登记地址、项目和两把密钥；地址是私网 IPv4 上的 http 时加 --private-http
bun scripts/personal-config.ts auctra <配置文件> <Auctra 地址> <项目引用> <收集密钥文件> <读取密钥文件> --private-http

# 控制中心已带上第五轮 W5 的改动之后，再把这两把不过期的密钥记成 never（旧服务端会把它读成“到期时间读不了”）
bun scripts/personal-config.ts credential <配置文件> expiry collection:auctra never
bun scripts/personal-config.ts credential <配置文件> expiry collection:auctra:flow never
```

`<项目引用>` 是完整的项目引用（形如 `project:<作品>`），签发和登记要用同一个。Auctra 的服务密钥不过期，所以升级之后记成 `never`（见上节；也可以在登记时用 `--expires-at never`，同样要等服务端先升级）。`--private-http` 只放行私网 IPv4 上的 http，公网地址、主机名和带路径的写法仍被拒绝；经过不可信网络时，Auctra 前面要放 HTTPS 反向代理。命令只写配置，不发请求；重启控制中心后在「服务」页点「同步记录」。看板“制作拆解”一格读的是 Scaena 的分镜投影：Scaena 没有部署它，或控制中心的观察密钥读不到它时，这一格显示未连接，不影响其余阶段。

## Provider 与 owner 状态

Provider transport、action contract、任务观测、内容读取和真实生成分别验收。`configured`、`transport verified` 或 `tools/list` 成功都不能直接推导业务 ready。真实 canary 只允许在明确预算和 owner 授权下运行：

```bash
bun run test:provider-live -- --confirm-live --modality audio --run-label <新标签> --total-usd 0.5 --audio-usd 0.5
```

预算以 USD 给出，原样交给 owner，不换汇。各模态的准入与证据要求见 [Provider 实时调用](provider-live.md)。

当前状态以 [当前实现状态](current-status.md) 为准；本文件不记录真实部署地址或秘密配置。
