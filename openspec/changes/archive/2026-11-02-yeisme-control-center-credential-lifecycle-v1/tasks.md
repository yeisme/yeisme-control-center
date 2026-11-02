# Tasks

## 1. 槽位、状态与文件检查

- [x] 1.1 `server/credential-file.ts`：凭据文件的检查，顺序为不存在 → 不是普通文件 → 有组或其他权限位，或本进程读不了（`accessSync(R_OK)`，别的用户的 0600 文件）→ 为空，只看元数据与可读性；`secret()` 与状态计算共用，没有 import 环 | evidence: `tests/credentials.test.ts` 用注入的 stat 覆盖 `0o640`、`0o604`、`0o060`、`0o007`、`readable: false`、缺失、目录、空文件和判定顺序；真实文件 `chmod 0200` 一项（root 下跳过）
- [x] 1.2 `src/shared/credentials.ts`：状态与原因类型、中文标签、`MM-DD 到期 · 还剩 N 天`（最后一天按小时，非当年带年份）、严格的 `parseRfc3339`（要秒和时区、日期真实存在）、问题优先的排序、续签章节 id | evidence: `tests/credentials-view.test.ts` 8 项，在 UTC、Asia/Shanghai、Pacific/Auckland 三个时区下通过
- [x] 1.3 `server/credentials.ts`：槽位（带范围时：连接取连接目录给的列表、开放工具按范围、owner 与 Provider 要范围绑定、Auctra 要范围绑定 Auctra 项目；已停用的不列）、`credentialStatuses`、`credentialSlots`、`credentialHolder`、`isPersonalAdmin`；状态顺序、7 天与 1 天两档、观测说读不了也算 `unreadable`（`read_failed`）、`limited`、`shared_with`、`last_accepted_at`、读不了的到期记录标 `invalid_expiry`，行里没有路径、地址和令牌 | evidence: `tests/credentials.test.ts` 25 项
- [x] 1.4 `secret()`：不存在、不是普通文件、权限不对、为空（含只有空白）统一抛 `AuthError("credential_unreadable", 503)` 带 `reason`，不让裸 ENOENT 逸出，错误里没有路径；中文标签进 `connectionStateLabels`、`reasonLabels` | evidence: `tests/credentials.test.ts` 的 `secret()` 一项（五种文件）；`tests/owners-delegation.test.ts` 6 项（缺失、空、目录、0644，且不发起 owner 调用）

## 2. 服务目录与服务页

- [x] 2.1 `serviceDirectory` 只对个人管理员加 `credentials` 段（按配置判定，规则与 `SessionAuth.role` 相同，测试逐一对照），用已有的观测、开放工具读数和范围连接列表计算，不新增 owner 调用，`server/app.ts` 不变 | evidence: `tests/service-directory.test.ts` 10 项：管理员的行；个人只读账号、OIDC 会话、未知账号都没有该段也没有 `expires_at`；没有绑定的 owner、Provider、Auctra 不出槽位，绑定了才出；登记的工具项目有自己的行
- [x] 2.2 服务页「凭据」面板（要处理的在前、正常的折叠、没有到期记录的写明并给出补记命令）、卡片页脚的标签与「续签方法」链接；`ServicesResponse` 加 `credentials?`，页面不再强转类型 | evidence: 浏览器旅程两项，见 6.4；截图人工看过
- [x] 2.3 旅程夹具：`FIXTURE_CREDENTIALS=lifecycle` 让 DriveBridge 的令牌 3 天后到期、Gateway 配置的令牌被模拟 owner 以 401 拒绝；默认夹具不变

## 3. 指南

- [x] 3.1 `connectedTools` 每项加 `renew` 步骤并渲染为 `guide-renew` 小节，每个工具有 `guide-renew-<tool>` 锚点，其余凭据一段通用步骤；DriveBridge 与 Gateway 的首次登记命令加 `--expires-in` | evidence: `tests/guide-content.test.ts` 10 项、`tests/guide-location.test.ts` 9 项；`test:public-guide` 12/12

## 4. `personal-config`

- [x] 4.1 `connect`、`open-tool`、`provider`、`auctra` 接受 `--expires-at`、`--expires-in`、`--issued-at`：RFC 3339 要带秒和时区、日历上真实存在、二选一、不重复、`--issued-at` 早于到期；`auctra` 的日期同时写给两把密钥 | evidence: `tests/personal-config.test.ts` 的记录位置一项和 15 种坏参数一项（含缺时区，文件 inode 不变）
- [x] 4.2 `credential list|expiry|replace`；`list` 不含路径与地址；`expiry` 点名共用同一文件的其他槽位；`replace` 总当作新凭据；未知槽位列出有效槽位 | evidence: `tests/personal-config.test.ts` 五项，含共用文件点名与 Auctra 读取密钥单独成槽
- [x] 4.3 `auctra --private-http`：允许私网 IPv4 上的 `http://`，记为 `collection.auctra.allow_private_http`，输出带 `private_http` | evidence: `tests/personal-config.test.ts` 一项；公网地址、`172.32`、`172.15`、`11.` 开头、主机名、路径、凭据都拒绝
- [x] 4.4 所有带凭据文件的命令（`connect`、`open-tool`、`provider`、`auctra`、`credential replace`）都用 `secret()` 检查，空白、空、过宽、读不了、缺失、目录都拒绝，配置文件字节不变；`connect` 不再接受尚未建好的文件 | evidence: `tests/personal-config.test.ts` 一项（6 种文件 × 8 条命令，错误里是原因而不是路径）
- [x] 4.5 `--replace` / 重跑时文件没变保留已记录的日期（新日期优先，发行时间晚于新到期则拒绝），文件变了清掉并提示；`credential replace` 总清 | evidence: `tests/personal-config.test.ts` 两项（open-tool、provider、auctra 两把密钥各自保留或清除）

## 5. 评审跟进

- [x] 5.1 `unreadable` 补上 stat 看不到的情形：观测说读不了（连接 `runtime.reason`、开放工具 `open_tool_credential_unreadable`）、本进程读不了的 0600 文件、CLI 用 `secret()` 拒绝空白文件 | evidence: `tests/credentials.test.ts`（读不了的观测、`readable: false`、真实 `chmod 0200`）、`tests/personal-config.test.ts`（空白文件被拒）；原先锁定相反行为的一项已改
- [x] 5.2 凭据段只给个人管理员；owner、Provider 与 Auctra 槽位按范围绑定 | evidence: `tests/service-directory.test.ts`、`tests/credentials.test.ts`（`isPersonalAdmin` 与 `SessionAuth.role` 对照七种账号、四种旧式账号）
- [x] 5.3 开放工具 401：不带凭据的读取（`health`）不算，只有本该通过的读取上的 401 才是 `rejected` 且不报“最近被接受”，可选读取（Gateway 用量）上的 401 或 403 是 `limited`；`openToolChecks` 由适配器与状态计算共用 | evidence: `tests/credentials.test.ts` 四项（Gateway 与 DriveBridge）
- [x] 5.4 Provider 目录把 `credential_unreadable` 记为 `unavailable`（可见故障），不再被 `/credential/i` 当成“未配置” | evidence: `tests/provider-discovery.test.ts` 两项（过宽、空、缺失、目录四种文件；没配密钥的仍是 `needs_configuration`）；去掉修复后该项失败（变异检查）
- [x] 5.5 剧集与 Auctra 阻塞原因的 `credential_unreadable` 中文标签 | evidence: `src/shared/read-model/drama.ts`
- [x] 5.6 配置里「不发往浏览器」的说法改为实际行为（配置字段不发，管理员的凭据行带 `expires_at`）；Auctra 地址规则在 `server/auctra.ts` 再核一次 | evidence: `tests/auctra-origin.test.ts` 3 项（https 与环回无需标志，私网需要标志，公网、主机名、带凭据即使有标志也拒绝且不发请求）；去掉检查后其中两项失败（变异检查）
- [x] 5.7 登记在控制中心里的工具项目（连接目录，不在配置里）有自己的凭据行与卡片标签 | evidence: `tests/credentials.test.ts`、`tests/service-directory.test.ts` 各一项
- [x] 5.8 小项：读不了的到期记录标 `invalid_expiry`；CLI 拒绝缺时区的日期；`credential expiry` 点名共用文件的槽位；`credentialReasonOf` 留用（CLI 用它翻译原因）；缺少年份的日期在跨年时带年份 | evidence: `tests/credentials.test.ts`、`tests/credentials-view.test.ts`、`tests/personal-config.test.ts`

## 6. 验证

- [x] 6.1 `bun run typecheck` | evidence: 通过；`scripts/personal-config.ts` 另按严格模式单独检查
- [x] 6.2 全量单元测试 | evidence: `bunx vitest run --testTimeout=90000 --hookTimeout=90000 --maxWorkers=4`：78 个文件 671 项通过（评审前 77 个文件 618 项；机器负载 50–90 时默认 5 秒超时会误报）
- [x] 6.3 `bun run build`、`bun run check:public-surface`、`test:public-guide` | evidence: 构建通过；公开面检查 753 个文件 0 个发现；`PUBLIC_GUIDE_PORT=4372 bun run test:public-guide` 12/12
- [x] 6.4 浏览器旅程：「凭据」两项（到期标签与续签链接、被拒行排第一、折叠、无泄漏、axe，深色 axe） | evidence: `I1_UI_PORT=4411 I1_API_PORT=4412 I1_OWNER_PORT=4413 bun run test:browser-journey` 73/73
- [x] 6.5 `openspec validate yeisme-control-center-credential-lifecycle-v1 --strict --no-interactive` | evidence: 输出 `Change 'yeisme-control-center-credential-lifecycle-v1' is valid`
