# Yeisme 控制中心：凭据生命周期 v1

## Why

控制中心读取每个 owner 和开放工具都靠服务端持有的凭据文件，而凭据会悄悄失效：

- 两个开放工具凭据（MCP Gateway 令牌、DriveBridge 令牌）都将在 2026-11-30 到期。owner 不会通过自己的接口报告凭据何时到期，控制中心也就无从知道；到期当天读取开始失败，「服务」页才出现“无读取权限”，此前没有任何提前量。
- 凭据文件被删、权限被放宽或内容为空时，`secret()` 抛 `secret_permissions_invalid`；文件不存在时甚至抛出原生的 ENOENT，各调用点把它显示成 `source_unavailable`。看不出是控制中心自己这边的文件出了问题。
- 同一个文件常被多个连接、工具共用；换文件时哪些槽位要一起换，没有地方看得到。
- 续签方法分散在各工具的文档里；使用指南只讲了第一次接入，没讲换一份新的。

## What Changes

- **记录到期时间。** `credential_expires_at` 与 `credential_issued_at`（RFC 3339，要带秒和时区；类型在 `server/contracts.ts` 的 `CredentialLifecycle`）和 `credential_ref` 并列，写在 `connections[]`、`open_tools[kind]`、`providers[owner]`、`owners[owner]` 和 `collection.auctra`（读取密钥用 `flow_credential_expires_at` / `flow_credential_issued_at`）。配置本身不发往浏览器；个人管理员在凭据行里收到由它算出的 `expires_at`。
- **槽位与状态。** 纯函数模块 `server/credentials.ts`：每个配置过的凭据文件是一个槽位，id 固定：`connection:<id>`、`open_tool:<kind>`、`provider:<owner>`、`owner:<owner>`、`collection:auctra`、`collection:auctra:flow`。带范围时只列这个范围用得到的：它的连接（取连接目录给的列表，所以在控制中心里登记的工具项目也有行）、它列出的开放工具、它绑定了的 owner 与 Provider（`scope.owners[owner]`）、它绑定了 Auctra 项目时的 Auctra 两把密钥；没有范围（命令行）则列全部。已停用的连接、工具、Provider 不用凭据，服务端不出槽位。`credentialStatuses(config, scope, { connections, scopeConnections, openTools, now, stat })` 返回 `{ id, owner, label, state, reason?, stage?, expires_at?, days_left?, last_accepted_at?, shared_with }`，状态先中先得：`unreadable`（文件不存在、不是普通文件、有组或其他权限位、本进程读不了、为空；只做 stat 与可读性检查，不读内容；或观测说控制中心读不了它：连接的 `runtime.reason`、开放工具的 `open_tool_credential_unreadable`，原因记 `read_failed`）→ `rejected`（连接观测 `authorization === "denied"`；开放工具带凭据的、本该通过的读取任一返回 401，或全部返回 403；`health` 这类不带凭据的读取、以及 Gateway 用量这类“可能没授予”的可选读取上的 401 不算）→ `expired` → `expiring`（7 天内 `7d`，1 天内 `1d`）→ `limited`（凭据被接受但某项读取被拒）→ `ok` / `unknown_expiry`（记录的到期时间读不了时原因为 `invalid_expiry`）。被拒时不报“最近被接受”。行里没有路径、地址和令牌。
- **`secret()` 说清原因。** 文件不存在、不是普通文件、权限不对（含本进程读不了）、为空或只有空白时统一抛 `AuthError("credential_unreadable", 503)`，带 `reason`，不抛裸 ENOENT。检查在 `server/credential-file.ts`，`secret()` 与状态计算共用。任务连接状态、各页面与 Provider 目录同步：`credential_unreadable` 在 Provider 目录里是 `unavailable`（可见的故障），不是“未配置”；剧集与 Auctra 阻塞原因有中文标签。
- **服务目录。** `/services` 只对个人管理员多一个 `credentials` 段（个人只读账号、OIDC 会话都没有），由已有的观测和开放工具读数算出，不新增 owner 调用，`server/app.ts` 不变。
- **Auctra 地址在服务端再核一次。** `collection.auctra.allow_private_http`（`personal-config auctra --private-http` 写入）之前只在命令行检查；`server/auctra.ts` 现在同样要求 https、环回 http，或在该标志下的私网 IPv4 上的 http，手改配置也发不出去（`upstream_not_allowed`）。
- **服务页。** 开放工具之下新增「凭据」面板：要处理的行在前（读不到、被拒、已过期、即将到期、部分被拒、到期时间读不了），正常的折叠在“其余 N 项”里；任务连接卡片和开放工具卡片的页脚各有一个小标签（“11-30 到期 · 还剩 29 天”，非当年带年份，“凭据被拒”……），到期、被拒、读不到时带「续签方法」链接，指向指南「接入」章节的 `guide-renew-<tool>`（Anatomia、DriveBridge、MCP Gateway），其余工具指向 `guide-renew`；没有记录到期时间的槽位在面板里写明并给出补记命令（只有管理员收到这个段，所以命令天然只给管理员）。文案与格式化在 `src/shared/credentials.ts`。
- **指南。** `connectedTools` 每项多一份 `renew` 步骤，渲染为「续签凭据」小节，每个工具有 `guide-renew-<tool>` 锚点，其余凭据有一段通用步骤；第一次登记 DriveBridge 与 Gateway 的命令加上 `--expires-in`。命令里只有占位符。
- **`personal-config`。** `connect`、`open-tool`、`provider`、`auctra` 接受 `--expires-at <RFC3339>` 或 `--expires-in <N>d|<N>h`（二选一）和 `--issued-at <RFC3339>`（缺时区的写法一律拒绝），写在 `credential_ref` 旁边；`auctra` 的日期同时写给两把密钥。所有带凭据文件的命令（含 `connect`，它不再接受还没建好的文件）都用 `secret()` 检查文件，空白、读不了的文件被拒。`--replace` / 重跑时：文件没变，已记录的日期保留（只改地址或模型）；文件变了，旧日期清掉并提示。`credential <配置文件> list`、`expiry <槽位> <RFC3339|none>`（会点名共用同一文件的其他槽位）、`replace <槽位> <文件>`（总视作新凭据：清旧日期；仍用旧文件的其他槽位会列出）。`auctra --private-http` 允许私网 IPv4 上的 `http://`，公网 http 仍拒绝。
- **不做的事。** 控制中心不签发、不续签、不替 owner 做任何事；本变更也不产生提醒或待办——后续把这些状态接入提醒与 `credential_renewal` 工作队列的变更，用本变更导出的 `credentialStatuses()` 和槽位 id。

## Impact

- `/services` 的个人管理员响应多一个可选的 `credentials` 数组；其他会话没有，旧服务端没有时页面不显示「凭据」面板。没有数据库迁移，没有新依赖。
- `secret()` 的错误码从 `secret_permissions_invalid` 变为 `credential_unreadable`（仍是 503）；文件不存在不再是裸 ENOENT。所有调用点——owner 读取、任务连接、开放工具、Provider、Auctra、Scaena 分镜、个人登录读取密码摘要——都走同一个检查；空文件、只有空白的文件、别的用户的 0600 文件现在也被拒。已有的 `secret_permissions_invalid` 标签保留，只为读到旧数据时仍能显示。
- `personal-config connect` 不再接受尚未建好的凭据文件：先签发凭据，再登记。
- 线上配置里还没有任何到期记录：发布后用 `personal-config credential <配置文件> expiry …` 为现有凭据补记（Gateway 与 DriveBridge 的到期日是 2026-11-30），在补记之前它们显示“未记录到期时间”。
- `personal-config` 的 `open-tool`、`provider`、`auctra` 的 JSON 输出多了 `expires_at`（给了或保留了日期时，保留时另有 `expiry_kept`）或 `expiry_recorded: false` 与 `notice`（没有时）。
