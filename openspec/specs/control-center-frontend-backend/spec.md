# control-center-frontend-backend Specification

## Purpose
TBD - created by archiving change yeisme-control-center-frontend-backend-v1. Update Purpose after archive.
## Requirements
### Requirement: Same-origin scoped read model

控制中心 SHALL 通过同源 API 读取固定 owner allowlist 的只读投影；浏览器不得直接访问 owner URL、携带 owner credential 或自报 scope/actor。

#### Scenario: 客户端伪造范围

- **WHEN** 浏览器传入未出现在 session 中的 `scope` 或 actor
- **THEN** server 返回 `scope_not_found`/`forbidden`，不向任何 owner 发起读取

### Requirement: Contract-stable task and request views

任务和请求 SHALL 保留 owner 原始引用、native state、阶段、覆盖度、观察时间和明确的缺失状态；列表分页不能替代全范围汇总。

#### Scenario: 第一页不是全量

- **WHEN** 请求列表只返回当前来源第一页，但 summary 覆盖完整筛选范围
- **THEN** 页面分别标示当前批次与汇总覆盖，不能用第一页数量显示为全量

### Requirement: Epoch-safe frontend state

前端 SHALL 在注销、scope/identity/permission 改变时清空旧详情和正文，并拒绝旧 epoch 的迟到响应。

#### Scenario: 快速切换项目

- **WHEN** 用户在项目 A 详情加载期间切换到项目 B
- **THEN** A 的响应不得渲染到 B，详情回到 loading/empty 状态并按 B 重新读取

### Requirement: Independent content authorization

正文、附件、预览和下载 SHALL 走独立授权、用途和 CSRF 保护；没有 owner 合同或审计结果时显示原因并保持不可用。

#### Scenario: 内容权限被撤回

- **WHEN** owner 返回 `forbidden` 或 `content_not_authorized`
- **THEN** 前端隐藏正文/媒体句柄，保留任务或请求元数据，不重新生成、不重试、不伪造成功

### Requirement: Degraded source truthfulness

当一个来源失败、超时或合同缺失时，系统 SHALL 保留其他授权来源并显示失败来源的状态、观察时间和恢复提示；不得通过 fixture、零值或空成功列表静默回退。

#### Scenario: Scaena unavailable

- **WHEN** Scaena 超时而其他 owner 可读
- **THEN** 其他 owner 正常显示，Scaena 显示 `unavailable`，整体 coverage 为 partial/unavailable

### Requirement: Every configured credential is a slot with a stable id

The control center MUST treat each configured credential file as one slot with a stable id: `connection:<id>` for each task connection of the scope (the connection catalog's list for the scope, which includes tool projects registered from the control center, and otherwise the configured connections in the scope's `connection_ids`), `open_tool:<kind>` for each open tool the scope lists, `provider:<owner>` for a provider with a `credential_ref` and `owner:<owner>` for a request owner with a `credential_ref`, each only when the scope binds that owner (`scope.owners[owner]`), and `collection:auctra` (collector key) and `collection:auctra:flow` (reader key) only when the scope binds an Auctra project. Without a scope (the command line) every configured credential SHALL be a slot. A switched-off connection, open tool, provider or Auctra collection MUST NOT be listed by the server, because it does not use its credential. The expiry that whoever issued a credential recorded (`credential_expires_at`, `credential_issued_at`; `flow_credential_expires_at`, `flow_credential_issued_at` for the Auctra reader key, RFC 3339 with seconds and a zone) SHALL be read from beside the reference it describes, and MUST NOT be sent to browsers under those configuration names; a credential row carries only the resulting `expires_at`.

#### Scenario: a scope reads some of the configured credentials

- **WHEN** the configuration holds connections, open tools, a provider, a request owner and an Auctra collection, and a scope lists two of the connections and one open tool but binds no owner and no Auctra project
- **THEN** the server lists the two connections and the one open tool only, and none of the provider, the owner, the Auctra keys, the other connections, the other open tool or a disabled entry; once the scope binds the owner or the Auctra project, their slots appear

#### Scenario: a tool project registered in the control center

- **WHEN** the connection catalog gives the scope a registered connection that copies its template's credential file
- **THEN** the registered connection has its own `connection:<id>` row, judged by its own observation, and its row and its template's name each other in `shared_with`

### Requirement: A credential's state is decided in a fixed order

`credentialStatuses(config, scope, { connections, scopeConnections, openTools, now, stat })` MUST return, for each slot, `{ id, owner, label, state, reason?, stage?, expires_at?, days_left?, last_accepted_at?, shared_with }`, and MUST decide `state` by the first rule that matches: `unreadable` when the file is missing, is not a regular file, has any group or other permission bit, cannot be read by this process, or is empty (judged from file metadata and read access alone, the content MUST NOT be read; `reason` is `missing`, `not_file`, `permissions` or `empty`), or when an observation says the control center could not read the file (a task connection's `runtime.reason` or state `credential_unreadable`, or an open tool read answering `open_tool_credential_unreadable`; `reason` `read_failed`); `rejected` when the task connection's observation says `authorization` is `denied`, or an open tool answered any read that carries the credential and that the credential is expected to pass with 401, or all of them with 403 (reads made without the credential, such as the health route, and reads whose refusal only means the credential was not granted them, such as Gateway usage, do not count); `expired` when the recorded expiry is at or before `now`; `expiring` when it is within 7 days, with `stage` `7d`, and `1d` within one day; `limited` when the credential is accepted but a read is refused, namely a task connection's content access (`content` is `denied`) or some of an open tool's reads, including a 401 on a read it may simply not be granted; `ok` when an expiry is recorded and `unknown_expiry` when none is, with `reason` `invalid_expiry` when one is recorded but is not an RFC 3339 time with a zone. `days_left` MUST be the whole days remaining rounded up and be absent once the credential has expired; `last_accepted_at` MUST come only from the observations given (a connection's `last_success_at`, or the time of a fresh open tool reading in which a credentialed read passed) and MUST be absent while the credential is `rejected`; `shared_with` MUST list only the ids of other slots in the same list that point at the same file. A row MUST NOT contain a file path, an address or any part of a credential.

#### Scenario: a rule that comes earlier wins over one that comes later

- **WHEN** a connection's file is missing, its owner has denied it and its expiry has passed
- **THEN** its state is `unreadable` with reason `missing`; with the file present it is `rejected`; with no denial it is `expired`

#### Scenario: a file the process cannot use, whatever its mode says

- **WHEN** a 0600 file belongs to another user, or holds only whitespace and an observation says the read failed
- **THEN** the first is `unreadable` with reason `permissions`, the second is `unreadable` with reason `read_failed`

#### Scenario: expiry stages

- **WHEN** a credential expires in exactly 7 days, in 1 day plus a millisecond, in exactly 1 day, and in 7 days plus a millisecond
- **THEN** the first two are `expiring` at stage `7d`, the third is `expiring` at stage `1d`, and the last is `ok` with `days_left` of 8

#### Scenario: refusals on reads that say nothing about the credential

- **WHEN** the Gateway's health route answers 401, or its usage read answers 401 or 403 while every other read passes
- **THEN** the credential is not `rejected` and offers no renewal for the health case, and is `limited` with `last_accepted_at` for the usage case; a 401 on any other credentialed read makes it `rejected` and drops `last_accepted_at`

### Requirement: Credential files are refused for the same reasons wherever they are read

`secret()` MUST apply the file rule above before it reads a credential and MUST throw `AuthError("credential_unreadable", 503)` carrying a `reason` of `missing`, `not_file`, `permissions` or `empty` for a missing path, a path that is not a regular file, a file readable by group or others or not readable by this process, and a file that is empty or holds only whitespace. It MUST NOT let a raw file-system error escape and MUST NOT put the path in the error. The rule MUST be shared with the credential status computation by one small module. The task connection state and every page that shows a connection, coverage or Auctra blocker reason SHALL label `credential_unreadable` in Chinese, and the provider catalog MUST show a provider whose key file is unusable as `unavailable` with that reason, not as a provider that was never configured.

#### Scenario: an owner credential file is unusable

- **WHEN** a request-owner credential file is missing, empty, a directory or mode 0644
- **THEN** the owner's coverage is unavailable with reason `credential_unreadable`, no owner call is made, and the error names no path

#### Scenario: a provider key file is unusable

- **WHEN** a provider's `credential_ref` is missing, empty, a directory or mode 0644
- **THEN** its readiness is `unavailable` with blocker `credential_unreadable`, while a provider with no key configured at all stays `needs_configuration`

### Requirement: The service directory lists credential statuses for personal administrators only

For a personal session whose account is an administrator (decided on the server from the configuration, by the rule the session role uses), `GET /services` MUST include `credentials`, computed by `credentialStatuses()` from exactly the connection observations, open tool readings and scope connection list the request already has (observations fresh with `observe=1`, otherwise none), and MUST NOT make any additional owner call. Personal viewers, OIDC sessions and any session the configuration does not recognise MUST NOT receive the section, nor any expiry date. The section MUST NOT contain file paths, addresses, tokens, `credential_ref` or the recorded dates under their configuration names.

#### Scenario: observation off and on, administrators and others

- **WHEN** a personal administrator reads `/services` without and then with `observe=1`, and a personal viewer and an OIDC session read it too
- **THEN** the administrator's first response judges each row by file and recorded expiry alone, the second also uses the observations (a denied connection becomes `rejected`, `last_accepted_at` appears), neither contains a path or the credential, and the viewer's and the OIDC session's responses have no `credentials` and no `expires_at`

### Requirement: The Auctra origin is checked where the keys are sent

The server MUST send Auctra requests only to an origin that is https, plain http to loopback, or plain http to a private IPv4 address (127/8, 10/8, 172.16/12, 192.168/16) when `collection.auctra.allow_private_http` is set; any other origin, including a public http address, a host name over http and a URL with credentials, MUST be refused with `upstream_not_allowed` before any request is made, whether or not the file was written by `personal-config`.

#### Scenario: a hand-edited origin

- **WHEN** the configuration names a public http origin for Auctra, with or without `allow_private_http`
- **THEN** every Auctra read is refused with `upstream_not_allowed` and no request is sent

### Requirement: The services page shows what needs action first and where to renew

The services page MUST show a 「凭据」 panel below the open tools when credential rows are present, listing rows that need action (unreadable, rejected, expired, expiring, limited, or an expiry that cannot be read) first, refused ones before expiring ones, and folding the others into a closed-by-default group. Each task connection card and open tool card MUST show, in its footer, a small chip for its credential (for example 「11-30 到期 · 还剩 29 天」, with the year when it is not the current one, or 「凭据被拒」), and an expiring, expired, rejected or unreadable credential MUST carry a 「续签方法」 link to the guide's renewal section for that tool (`#/guide/connect?section=guide-renew-<tool>` for Anatomia, DriveBridge and MCP Gateway, `guide-renew` for the others). A slot with no recorded expiry MUST say so and show `bun scripts/personal-config.ts credential <config-file> expiry <slot> <RFC3339>`.

#### Scenario: one token expires soon and another is refused

- **WHEN** DriveBridge's token expires in 3 days and the Gateway's token is refused with 401
- **THEN** the panel's first row is the refused one, the DriveBridge card shows 「… 到期 · 还剩 3 天」 with a 「续签方法」 link to `guide-renew-drivebridge`, the Gateway card shows 「凭据被拒」, and following the link opens the 接入 chapter at that tool's steps

### Requirement: The guide explains how to renew each credential

The 接入 chapter of the guide MUST contain a 「续签凭据」 section with an anchor `guide-renew` and one anchor `guide-renew-<tool>` for Anatomia, DriveBridge and MCP Gateway, each with the steps in order using placeholders only: for DriveBridge the server is stopped before `agents create … --out <new file>` runs, started again, and then `credential replace … --expires-at` is run; for MCP Gateway a new token is issued with the administrator token or the owner's plan flow and then `credential replace` is run; for Anatomia a new observer key is created and then `credential replace` is run. The same content MUST be available on the public guide page, which MUST NOT contain a real host, address or home path.

#### Scenario: the renewal link is opened from outside the app

- **WHEN** the public guide is opened at `guide.html?chapter=connect#guide-renew-gateway`
- **THEN** the 接入 chapter is shown and its Gateway renewal steps are at that anchor

### Requirement: personal-config records and replaces credential expiry

`personal-config connect`, `open-tool`, `provider` and `auctra` MUST accept `--expires-at <RFC3339>` or `--expires-in <N>d|<N>h` (mutually exclusive) and `--issued-at <RFC3339>` and record them next to the credential reference (the dates of `auctra` apply to both of its keys). An RFC 3339 value MUST include seconds and a zone, be a real calendar date and time, and `--issued-at` MUST be earlier than the expiry; a bad or repeated option MUST be refused without rewriting the file. Every command that takes a credential file (`connect`, `open-tool`, `provider`, `auctra` and `credential replace`) MUST accept it only if `secret()` accepts it, so a missing, loose, unreadable, empty or whitespace-only file is refused before anything is written. A re-run or `--replace` that names the same credential file MUST keep the dates already recorded for it unless new ones are given, and one that names another file MUST clear them with a notice. `personal-config credential <config-file> list` MUST print each slot's id, owner, state, reason and expiry without any path or address; `credential … expiry <slot> <RFC3339|none>` MUST set or clear one slot's expiry and name the other slots that use the same file; `credential … replace <slot> <file> [date options]` MUST replace the reference, clear the old dates unless new ones are given, and name the other slots still on the old file. An unknown slot MUST be refused with the list of valid slots. `personal-config auctra` MUST accept `--private-http`, allowing a plain http origin on a private IPv4 address and recording `allow_private_http`, MUST still refuse a public http origin with it and any non-loopback http origin without it, and MUST compose with the date options and `--replace`.

#### Scenario: a credential is replaced

- **WHEN** the Gateway's token file is replaced with a new 0600 file and no date is given
- **THEN** the old expiry is cleared with a notice that says how to record the new one, the other slots that still use the old file are named, and the output contains no path

#### Scenario: only the endpoint changes

- **WHEN** `open-tool … --replace` is run with a new address and the same credential file
- **THEN** the recorded expiry and issue time are kept and the output says the expiry was kept

#### Scenario: a blank key file

- **WHEN** any of the commands above is given a file that holds only whitespace
- **THEN** it exits with an error that says the file is empty or holds only whitespace, and the configuration file is byte-for-byte unchanged

#### Scenario: Auctra on a private address

- **WHEN** `auctra` is run with a private IPv4 http origin, first without and then with `--private-http`, and then with a public http origin and the flag
- **THEN** the first and the third are refused with the file unchanged, and the second records `allow_private_http: true` and prints `private_http: true`

### Requirement: Background observation writes reminders without a browser

When `observation.enabled` is true, the `observation` block is valid, and the process is not switched off by `YEISME_CONTROL_BACKGROUND=off`, the server MUST run a background loop that, once per cycle and base scope, reads the task lists of the scope's connections (the first page of both lists, and the rolling read of the next requirement) and feeds the rows to the same reminder-ledger sync a browser sync uses, as an incomplete projection so that a task missing from the pages read is never marked gone. It MUST write reminders per recipient with the session `background`, MUST NOT read task details, and MUST NOT write to an owner. When the loop is not enabled, or the environment switches it off, the server MUST NOT start it. On SIGTERM or SIGINT the server MUST stop accepting connections before it stops the loop and exits.

#### Scenario: a task fails while no page is open

- **WHEN** a task behind a configured connection ends failed and a cycle runs
- **THEN** every recipient has one unread failure reminder for that failure version, written with the session `background`

#### Scenario: a browser syncs the same failure later

- **WHEN** a browser sync lists and verifies a failure the loop already opened a reminder for
- **THEN** the sync touches the existing row and inserts none, and what the user already acknowledged, muted or archived stays that way

#### Scenario: a task is missing from the pages read

- **WHEN** a failed task has an open reminder and the next cycle's pages do not show that task at all
- **THEN** the reminder stays live, neither recovered nor stale

#### Scenario: the release candidate runs switched off

- **WHEN** the server starts with `observation.enabled` true and `YEISME_CONTROL_BACKGROUND=off`
- **THEN** no loop runs, no owner is read on the server's own initiative, and `GET /observation/status` reports `enabled: true, running: false`

### Requirement: Only enabled personal admins receive background reminders, in base scopes only

The loop MUST write reminders only for enabled personal admin accounts bound to the scope, including the legacy owner of `personal.username` when `personal.role` is admin, or, when `observation.recipients` names some, only those of them that are such accounts. It MUST NOT write reminders for viewers, even when one is named, and MUST observe only the base scopes of the config, never a shared-project scope. An account that cannot sign in under the rules of personal sign-in (a disabled user, or a legacy owner without a configured name once named users exist) MUST NOT be a recipient.

#### Scenario: viewers and unbound admins

- **WHEN** a cycle finds a failure in a scope with two admins, a viewer, a disabled admin and an admin bound to another scope
- **THEN** exactly the two admins bound to the scope have a reminder and nobody else has one

#### Scenario: named recipients

- **WHEN** `observation.recipients` names one admin, one viewer and an unknown identity
- **THEN** only the named admin receives reminders, and the cycle summary counts each named identity that reached nobody under the error code `recipient_unresolved`

### Requirement: Turning observation on does not flood the reminder list

The server MUST record, in `control_state`, when a stretch of background observation began (the first enabling on a database) and when the last cycle began, and MUST NOT open a new failure reminder for a task whose last update is more than 24 hours before the stretch began. The recorded start MUST NOT move while the loop keeps running or restarts after a short stop. A cycle that begins more than 24 hours (or two intervals, when that is longer) after the previous cycle began, because observation was disabled or the server was down, MUST begin a new stretch at its own start, so that enabling again later does not open a reminder for every failure since the first enabling.

#### Scenario: failures older than a day when observation is first enabled

- **WHEN** the first cycle sees one failed task updated three days ago and one updated an hour ago
- **THEN** only the recent one opens a reminder, and later cycles keep the same floor

#### Scenario: enabled again after weeks

- **WHEN** the loop ran once, was off for forty days, and its next cycle sees a failure updated twenty days ago, one updated 23 hours ago and one updated five minutes ago
- **THEN** only the last two open reminders, the recorded start becomes that cycle, and the following cycle keeps it

#### Scenario: a loop that keeps running

- **WHEN** cycles run every six hours for thirty hours and a failure last updated four hours after the first cycle only then appears in the lists
- **THEN** it still opens a reminder, because the floor stays a day before the first enabling

### Requirement: Recovery is judged from list rows, not details

When a later cycle's list rows show a task whose open failure reminder exists as no longer failing, the loop MUST mark that reminder recovered. It MUST NOT infer recovery from a task being absent from a page, and MUST NOT call a task detail. A task that more than one row of the cycle shows (the same task on two pages or in both lists) MUST count as failing when any of its rows is failing, whichever row was read last, and MUST NOT be recovered then; the reminder MUST NOT open and recover from cycle to cycle with the pages the walk happens to reach.

#### Scenario: a failed task runs again

- **WHEN** the owner lists the task as running in the next cycle
- **THEN** the recipient's reminder gets a recovered time, and no detail request was made

#### Scenario: a task fails on one page and runs on a later one

- **WHEN** a task is failed on history page 1 and running on a later page of the active list, which the walk reads after it
- **THEN** a failure reminder is opened for it, and it is not recovered in this or any cycle in which the failed row is still listed

#### Scenario: the walk comes and goes

- **WHEN** the healthy row of such a task is on a page the walk reaches in every other cycle
- **THEN** over eight cycles the reminder is opened once, never recovered, and the summaries show no flip

### Requirement: Background reads reach past the first page

Owners page their lists in an order the control center does not choose, and `control_center.tasks.list` has no "updated after" filter, so the first page can not be trusted to hold what failed. Besides page 1 of the active and of the history list, which every cycle MUST read for each connection it reads, the loop MUST keep in memory, per connection and scope, a rolling position that walks the history list and then the active list page by page with the owner's own cursors, MUST continue from that position in the next cycle, and MUST start over after the end of the active list. Page 1 MUST count as the first page of a walk that starts at the beginning, so that a list that fits in one page costs no further call. The walk MUST have its own failure handling, apart from the connection's. A rolling page that cannot be read MUST keep the cursor, stop the walk of that connection for the cycle, and be tried again in the next cycle; after 3 failed reads of the same page in a row the walk MUST give that page up, going on after it when the owner's answer arrived and named the next page (a page it sent but that holds a row the control center refuses) and otherwise treating the rest of that list as out of reach. A rolling page MUST NOT change the connection's backoff or the channel states browsers are shown; only a connection's first pages do. A failed first page MUST put the whole connection in backoff and make it forget its place in the walk. The cycle summary MUST count the list pages asked for (`pages_read`), the rolling pages given up (`pages_skipped`, with the error code `walk_page_skipped`; a failure not yet given up is `walk_page_failed`) and the connections whose walk has not yet completed a pass over both lists since the process started, a pass that gave a page up not counted (`scan_incomplete`, including connections not yet read).

#### Scenario: a failure on page sixteen

- **WHEN** a connection's history has twenty pages, the only failed task is on page 16, and cycles run one after another
- **THEN** the first two cycles open nothing, the third cycle opens the reminder, and later passes over the list add none

#### Scenario: a family that is only reachable after the cursor

- **WHEN** failed `video-task` and `delegation` tasks sit after the first page of the history list and a blocked `delegation` task after the first page of the active list
- **THEN** the first cycle opens a reminder for each

#### Scenario: a walk across cycles

- **WHEN** a connection's history has fifteen pages
- **THEN** the cycles read pages 1 to 7, then page 1 and pages 8 to 13, then page 1 and pages 14 and 15, and the fourth starts again at page 2; `scan_incomplete` counts the connection until the third cycle and not after

#### Scenario: a deep page keeps failing

- **WHEN** history page 4 always answers an error and cycles run ten minutes apart
- **THEN** page 1 of both lists is read in every cycle, the connection is never skipped or put in backoff, the channel states browsers are shown stay `ready`, the first two cycles report `walk_page_failed`, the third gives the page up and reports `walk_page_skipped`, and the pattern repeats with every pass, which never counts as complete

#### Scenario: a page fails once

- **WHEN** the owner answers an error for the page after the cursor and answers it again in the next cycle
- **THEN** the walk goes on at that page in the next cycle, not at page 2, and the count of failures starts over after a success

#### Scenario: a page holds a row the control center refuses

- **WHEN** page 4 of the history list holds a row for another project, so the whole page is refused, and the owner's answer names page 5
- **THEN** after three cycles the page is given up, `pages_skipped` is 1, the walk goes on at page 5 and reaches a failure on page 7, and the connection is never in backoff

#### Scenario: the first pages fail

- **WHEN** a connection part-way through its walk cannot be read at page 1
- **THEN** the connection backs off as a whole and, when it is read again, its walk starts at page 2 instead of continuing from the cursor it had

### Requirement: Background reads stay inside a fixed budget

Each cycle MUST make at most 40 owner HTTP requests in all, counting the requests the owners really get: the MCP handshake of a connection that has no session yet, every list page, and every request of an open-tool reading (3 for DriveBridge, 6 for the Gateway, none when the reading is served from the cache; the budget keeps the most it can make). Each connection the cycle reads MUST be reserved 3 requests (page 1 of both lists and one rolling page) and 1 more when it still needs its handshake, and a connection that does not fit MUST be first in line for the next cycle, so successive cycles rotate through all of them. Requests left over MAY deepen a connection's walk, one round at a time across the connections, but MUST NOT give one connection more than 8 requests in a cycle, handshake and first pages included. A connection that several scopes have MUST be read once per cycle, with one backoff, one walk position and one share of the budget, and its rows MUST go to each of those scopes, under that scope's task keys, for that scope's own recipients. The cycle interval MUST default to 10 minutes and MUST NOT be shorter than 5 minutes. After a connection could not be read, the loop MUST wait twice as long before reading it again, up to 60 minutes, and MUST start over once it can be read. The loop MUST NOT call a Provider or Auctra. Two cycles MUST NOT run at the same time. The first cycle MUST run no sooner than 60 seconds after start. `stop()` MUST cancel the timer and wait for a cycle in flight, and a cycle in flight MUST NOT start another round of reads once stopped. A `start()` after a `stop()` MUST leave exactly one timer, whatever happens to a cycle that was running when `stop()` was called.

#### Scenario: more connections than the budget

- **WHEN** 25 connections with one-page lists are configured
- **THEN** the first cycle makes 30 requests and reads 10 of them (a handshake and two pages each), the second reads the next 10, and the third reads the last 5 and then 6 that already have a session

#### Scenario: long lists use the whole budget and no more

- **WHEN** 25 connections with 80-page lists are configured
- **THEN** each cycle makes at most 40 requests, the owners get exactly as many as the cycle reports, the first cycle makes exactly 40 (10 connections: a handshake, two first pages and one rolling page each), and one connection alone gets 8

#### Scenario: an open tool is read in the same cycle

- **WHEN** DriveBridge is read and 25 connections with long lists are configured
- **THEN** its 3 requests are kept back from the 40, the first cycle reads 9 connections, and the owners and DriveBridge together get exactly 40 requests

#### Scenario: a connection shared by two scopes

- **WHEN** two scopes have the same connection, with different recipients
- **THEN** the connection gets 8 requests in the cycle, not 16, a failure found on it opens a reminder in each scope for that scope's recipients with a task key valid in that scope only, and a failing connection has one backoff

#### Scenario: restarting while a cycle is running

- **WHEN** `stop()` and then `start()` are called while a cycle waits on an owner, and the cycle then finishes
- **THEN** exactly one timer is pending, the one the restart set

#### Scenario: an owner is down

- **WHEN** a connection answers `source_unavailable`
- **THEN** it is skipped for 20 minutes, then 40, then up to 60, the other connections are read as usual, and the error is counted by code in the cycle summary

#### Scenario: stopping during a cycle

- **WHEN** `stop()` is called while a cycle waits on an owner
- **THEN** no further timer is scheduled, the call resolves only after that cycle ends, and the cycle asks for no further page

### Requirement: One failing recipient or listing costs the others nothing

A failure to write one recipient's reminders MUST be counted under the error code `reminder_write_failed` and MUST NOT keep the other recipients of the scope from theirs; the next cycle writes what is missing. What the loop remembers for connections (backoff and walk position) MUST be dropped for a connection that is no longer in any observed scope's list only when the connections of every observed scope could be listed in that cycle; a scope whose connections could not be listed (`connections_unreadable`) MUST leave all of it as it was.

#### Scenario: one recipient's write fails

- **WHEN** a scope has two admins and the write for the first fails
- **THEN** the second has the reminder, the summary counts one `reminder_write_failed`, and the next cycle writes the first one's

#### Scenario: a connection leaves and returns

- **WHEN** a backing-off connection and a connection part-way through its walk leave the configuration for a cycle and then return
- **THEN** the first is read at once and the second starts its walk at page 2

#### Scenario: the connections of a scope cannot be listed

- **WHEN** reading the registered connections fails for one cycle
- **THEN** the next cycle finds the backoff and the walk positions as they were

### Requirement: Failed open-tool runs become operation reminders

Every `open_tools_every` cycles (default 3, the first cycle included) the loop MUST read the open tools in scope and MUST turn failed or unknown runs from `operations.attention` into reminders of category `operation`, at most 10 per tool per cycle, each opening `/services`, written once per run and state for each recipient. Owner error text and paths MUST NOT reach the reminder.

#### Scenario: a tool with fourteen failed runs

- **WHEN** a cycle reads DriveBridge and 14 runs need attention
- **THEN** each recipient gets 10 `operation` reminders linking to `/services`, a later cycle adds none for the same runs, and viewers get none

### Requirement: Credential reminders are delivered by the loop

For each observed scope and cycle the loop MUST ask the credential lifecycle for that scope's credential problems and write each as a reminder of category `credential` with the event key `credential:<slot>:<state>:<stage>` (`stage` is `-` when the state has none), once per recipient and scope. Only states that need attention are problems: `unreadable`, `rejected`, `expired`, `expiring` at its `7d` and `1d` stages, and `limited`. Working out the problems MUST make no owner request and MUST NOT use the cycle's request budget: it MUST read the latest task connection observation of each connection and, for each open tool, the latest reading that said whether the credential was accepted or refused, from memory. A reading says so when a read that needs the credential (an optional read does not count) was answered, accepted or refused with 401 or 403, or when the credential could not be read; a reading that only failed to get an answer (the network, a 5xx, a 429, a missing route) says nothing, and the credential MUST then still be judged by the last reading that did. When a slot is no longer a problem, or has moved to another state or stage, the reminder written for the earlier one MUST be marked recovered and stop counting as unread. Not knowing MUST NOT be taken for recovery: the lifecycle also reports the reminders it has no reading of this cycle (a connection nothing has read since the process started, one whose reads since got no answer, an open tool none of whose readings was answered), and the cycle MUST leave an open reminder of the refused, unreadable or limited kind under such a slot exactly as it is, so that whatever the person did with it (acknowledged, muted, snoozed) survives a blip or a restart and a refusal that comes back is the same reminder, not a new unread one. When the same slot, state and stage is a problem again after it was recovered, it MUST open again as a new unread reminder that keeps nothing the earlier one was handled with. When the lifecycle cannot be read for a scope, the cycle MUST count one `credentials_unreadable` error for that scope and MUST neither open nor recover credential reminders there.

#### Scenario: a credential moves to a later stage

- **WHEN** a connection's credential first expires within seven days and, three days later, within one day
- **THEN** each recipient has one reminder per stage, none is written twice, and the seven-day reminder is recovered when the one-day reminder opens

#### Scenario: a credential is replaced and later runs out again

- **WHEN** a reminder for an expiring credential was acknowledged, the credential was replaced, and months later the new credential is within seven days of expiring
- **THEN** the first reminder was recovered when it was replaced, and the second incident is the same reminder opened again as unread, not acknowledged and not recovered

#### Scenario: a tool stops answering after it refused the credential

- **WHEN** an open tool's credential was refused and the person acknowledged the reminder, and the next readings fail with a network error, a 503 or a 429, then the tool refuses the credential again
- **THEN** the reminder is neither recovered nor reopened at any step, it is still acknowledged with its first-seen time unchanged, and only a reading that accepts the credential recovers it, after which a new refusal opens a new unread reminder

#### Scenario: the process restarts

- **WHEN** the process restarts while twelve connections' credentials are refused and acknowledged, and its first cycle reads only the connections its budget allows
- **THEN** the reminders of the connections not read yet are kept as they were, and the one connection that is then read and accepted is the only one recovered

#### Scenario: the owner turns the credential away in the background

- **WHEN** only the loop's own list reads have touched a connection and its owner answered 401
- **THEN** a `rejected` reminder with the reason `owner_denied` opens for each recipient, and the cycle's owner requests are the same as without credential reminders

#### Scenario: the lifecycle cannot be read

- **WHEN** the credential lifecycle fails for one scope in a cycle
- **THEN** that scope's open credential reminders are left as they are and the cycle counts one `credentials_unreadable`

### Requirement: A credential that needs attention is one work queue item

For a personal administrator, `GET /work-queue` MUST contain one item of kind `credential_renewal` for each credential of the scope that needs attention, worked out from the connection observations and open-tool readings the request already took, with no further owner request. Its `source_ref` MUST be the credential's slot id, its `work_ref` MUST not change with the credential's state, and it MUST carry the credential's state, reason, stage, expiry and days left but no path, address or token. It MUST link to the credentials on the services page and to the guide's renewal section for the tool. A `rejected` or `unreadable` connection or open-tool credential MUST replace the `service_blocked` item for the same connection or tool when that item's own reason is the one the credential row explains (a refusal by the owner or the tool for `rejected`; a credential that could not be read for `unreadable`); a blocked item with another reason (the tool is down, its address is refused) is a separate fault and MUST stay beside the credential item, and the other credential states MUST NOT replace anything. Other sessions MUST NOT get these items.

#### Scenario: a refused credential

- **WHEN** an administrator's scope has a connection whose owner refuses its credential
- **THEN** the queue has one `credential_renewal` item for it and no `service_blocked` item for the same connection, and a personal viewer still gets the `service_blocked` item

#### Scenario: a credential problem that does not explain why the service is blocked

- **WHEN** a connection is refused by its owner and its credential file is also not private, or a tool's address is refused and its credential file is not private
- **THEN** the queue has the `credential_renewal` item and the `service_blocked` item both, because the file alone does not explain the refusal or the address

#### Scenario: an expiring credential of a tool that is reachable

- **WHEN** an open tool answers and its credential is within a day of expiring
- **THEN** the queue has the `credential_renewal` item with priority `high`, and the tool has no `service_blocked` item because it is not blocked

### Requirement: A malformed observation block turns observation off

The server MUST check the `observation` block once at startup: `enabled` a boolean, `interval_minutes` a number from 5 to 1440, `open_tools_every` an integer from 1 to 1000, `recipients` an array of at most 100 non-empty strings. A block with any problem MUST be logged by problem code, never by value, and MUST be treated as `enabled: false` with the defaults. A missing block or a missing optional key is not a problem. Neither a malformed block nor `YEISME_CONTROL_BACKGROUND=off` MAY make who receives reminders, the loop or `GET /observation/status` fail with a server error.

#### Scenario: recipients is a string

- **WHEN** the config holds `"recipients": "an-identity"` and the server starts
- **THEN** the log names `observation_recipients_invalid`, no loop runs, `GET /observation/status` answers 200 with `enabled: false, config_valid: false`, and the default recipients are looked up without an error

#### Scenario: an interval out of range

- **WHEN** `interval_minutes` is 2, 0, 99999 or `"soon"`
- **THEN** the block is invalid (nothing is clamped) and observation is off

### Requirement: Observation status is readable and reads nothing

`GET /observation/status` MUST require a personal session, MUST accept any role, and MUST answer from memory and configuration without calling an owner. It MUST report whether observation is enabled, whether its configuration is valid, whether it is running, the interval and open-tool cadence, the next run time, whether someone receives background reminders for the scopes asked about and whether the current user does, and the last cycle's start, finish and counts (owner requests, pages read and given up, reminders opened and recovered, connections read and skipped, connections whose walk is incomplete, open tools read) and errors by code. The counts and error codes MUST cover only the scopes the session has: the scope named by `?scope=` (404 when the session does not have it), or all of the session's scopes added together when none is named, a scope listed more than once counted once. It MUST NOT include another scope's counts or error codes, addresses, file paths, keys or reminder text.

#### Scenario: a viewer asks

- **WHEN** a viewer's personal session reads the status
- **THEN** the answer is 200 with `recipient: false` and no owner was called

#### Scenario: no personal session

- **WHEN** a session that is not personal reads the status
- **THEN** the answer is 403 `personal_connection_required`

#### Scenario: a viewer of one scope while another scope has trouble

- **WHEN** a cycle opened two reminders in scope B, one in scope A, and one connection of scope C answered `source_unavailable`, and a viewer of scope A reads the status
- **THEN** the last cycle shows one reminder opened and no errors, the text contains nothing of scope B or C, and `?scope=B` is 404 for that viewer

### Requirement: Only task-failure reminders become task items in the work queue

The work queue MUST turn a reminder into a `task_failure` or `task_unknown` item only when the reminder is a task-failure reminder. Reminders of any other category (generation batches, project assignments, operations, credentials) MUST NOT become task items, and their handled state MUST NOT hide a task failure.

#### Scenario: an operation reminder is open

- **WHEN** the ledger holds an unread `operation` reminder whose state is failed and no listed task matches it
- **THEN** the work queue holds no `task_failure` item for it

### Requirement: the browser journey fails on serious accessibility violations

The system MUST run an axe scan in the browser journey over every workspace page, the modal and popover overlays, the detail panels, the phone layouts and the degraded-source notices, MUST fail the journey when any scan reports a serious or critical violation, and MUST record the full violation list as evidence.

#### Scenario: a page regresses

- Given a change that removes the accessible name from a page control
- When the browser journey runs
- Then the accessibility check fails and names the page and the offending element in its evidence.

#### Scenario: a modal overlay is open

- Given the media viewer or the command palette is open
- When the journey scans it
- Then only the overlay is scanned, so the page correctly hidden behind it is not reported.

### Requirement: a control's accessible name contains the text it shows

The system MUST give every labelled control an accessible name that contains its visible text, so that speech-input users can activate it by saying what they see.

#### Scenario: a task row

- Given the task list
- When assistive technology reads the row's open button
- Then the button is named by the short row label and the row's title, owner and reference are read as plain cell text rather than hidden inside a differently named button.

### Requirement: Anatomia is observed like other task owners

The control center MUST accept `anatomia` task connections that read Anatomia's `anatomia.execute` observation contract with a project-bound observer key, and MUST show its shot breakdowns (`decompose`) as 拉片分析 and its video questions (`understand`) as 视频问答. It MUST accept Anatomia frames only through an `anatomia.task_artifact_grant.v1` grant whose address is on the connection's own origin, is exactly `/api/v1/control-center/artifact-grants/<32 hex>`, carries no query or fragment and expires within 125 seconds, and MUST fetch it with the connection's own credential. It MUST refuse to cancel Anatomia tasks.

#### Scenario: a finished breakdown with frames

- Given an Anatomia connection with content allowed and a finished breakdown with three frames
- When the reader opens the breakdown and previews its second frame
- Then the frame streams through a same-origin media handle, and no Anatomia address or key reaches the browser.

#### Scenario: a grant that carries a query

- Given Anatomia answers an artifact request with a grant address that has a query string
- When the reader previews the frame
- Then the request is refused as `media_address_denied` and nothing is fetched from that address.

#### Scenario: cancelling a running breakdown

- Given a running breakdown on a connection whose local cancel preference is on
- When an administrator asks to cancel it
- Then the control center answers `cancel_not_supported` without calling Anatomia.

### Requirement: A page whose code failed to load recovers by itself once

When a page's code fails to load while the browser is online, the system MUST keep the page placeholder on screen and reload the document once, at the same address. Browsers keep a failed module request failed for the rest of the document, so retrying inside the document cannot succeed. If the code fails again within a minute, the browser is offline, or session storage is unavailable, the system MUST show the page load error with a reload button and MUST NOT reload again by itself. Errors other than failed code loading MUST keep their current handling.

#### Scenario: a network blip during the idle prefetch

- Given the request for a page's code failed once while the page chunks were prefetched after sign-in
- When the user opens that page
- Then the document reloads once at the same address and the page renders.

#### Scenario: the page code keeps failing

- Given every request for a page's code fails
- When the user opens that page
- Then the document reloads once, the page load error with its reload button is shown, and no further automatic reload happens.

### Requirement: Items offer the same actions on right click as in their menu

The system MUST open a context menu on right click for every list row and card that has actions: tasks, tool projects, shared projects, reminders, assets, requests, episodes, service connections, catalog entries, notifications and navigation entries. Each context menu MUST offer the same actions as the item's "更多操作" menu, built from one list. It MAY add opening and link actions.

#### Scenario: a tool project card

- Given a tool project card with a "更多操作" button
- When the user right-clicks the card
- Then the context menu lists the same items, in the same order, as the button's menu.

### Requirement: Context menus work from the keyboard and on touch screens

The system MUST open the context menu of the focused row on Shift+F10 or the Menu key, below that row. Closing the menu with Escape MUST return focus to the row. A long press on a touch screen MUST open the menu without also opening the row, and the menu MUST stay within the screen.

#### Scenario: keyboard

- Given focus on a task row
- When the user presses Shift+F10 and then Escape
- Then a menu opens below the row, and after Escape focus is back on the row.

#### Scenario: a long press on a phone

- Given a phone-width screen
- When the user long-presses the middle of a task row
- Then the row's menu opens inside the screen, and the task inspector does not open.

### Requirement: Menus sit above every panel

The system MUST show menus above the task inspector, detail panels and the media viewer. Escape MUST close only the topmost menu.

#### Scenario: a menu inside the task inspector

- Given the task inspector is open
- When the user opens its "更多操作" menu and presses Escape
- Then the menu is visible on top while open, and after Escape the inspector is still open.

### Requirement: audio plays through the list it was started from

The system MUST queue the playable audio results of the list a track was started from, MUST let the user move to the previous and next queued track from the floating player and the operating-system media keys, and MUST start the next track automatically only when the user has turned continuous play on.

#### Scenario: reviewing dialogue lines in a row

- Given an asset list with several playable audio results
- When the user plays the first one and presses next in the floating player
- Then the second result plays, the player shows its position in the queue, and the list does not need to be reopened.

#### Scenario: continuous play is opt-in

- Given continuous play is off
- When a queued track ends
- Then playback stops without requesting the next track's handle; after the user turns continuous play on, the next track starts when the current one ends.

### Requirement: the viewer shows the set and compares two images

The system MUST show the current view's results as a strip in the full-screen viewer using only owner-provided thumbnails, MUST let the user jump to any item from the strip, and MUST let the user compare the current image side by side with another image without requesting a new handle for the pinned one.

#### Scenario: comparing two candidates

- Given the viewer shows an image and the view has more images
- When the user starts a comparison and steps to the next image
- Then the first image stays on the left, the next image appears on the right, the strip marks both, and Escape ends the comparison before it closes the viewer.

### Requirement: The accessibility gate covers the dark theme

The system MUST run the same serious and critical axe checks in the dark theme as in the light theme. This covers the desktop pages and overlays, the phone layout, and the degraded source notices. Any serious or critical violation in either theme MUST fail the browser journey and leave the violations as evidence.

#### Scenario: a dark-theme contrast regression

- Given a component renders a light-only color that falls below the contrast threshold on the dark canvas
- When the browser journey runs its dark-theme accessibility check
- Then the check fails and names the page or overlay, with the violations saved under a name ending in `@dark`.

#### Scenario: the dark pass leaves no preference behind

- Given the dark-theme checks entered the dark theme by emulating the system preference
- When they finish, whether they passed or failed
- Then the system preference is light again, no theme preference is stored, and the next check starts from the home page.

### Requirement: CLI and MCP guide replaces the creation workbench

The system MUST present a 使用指南 page in place of the AI 创作 workbench that teaches installing, checking and connecting the owner CLIs and MCP servers, MUST show only commands documented by each owner, and MUST NOT offer any generation submit from the guide.

#### Scenario: old creation links land on the guide

- Given a user in a personal scope opens `/creation?owner=sonora`
- When the page resolves
- Then the client lands on `/guide?tool=sonora`, the sidebar lists 使用指南 and no AI 创作 entry, and shared-project batch generation stays reachable at `/creation` inside a project scope.

#### Scenario: commands follow the chosen tool and client

- Given the guide is open
- When the user picks Sonora and then Codex
- Then the connect step shows `codex mcp add sonora -- sonora mcp serve --stdio`, notes that the published binary lacks the `mcp` command, and keeps internal hosts as `<lan-host>:<port>` placeholders.

### Requirement: audio plays in a global floating player

The system MUST start audio playback directly from any audio result's play control in a floating player with a seekable progress bar, MUST NOT open the Inspector for it, and MUST stop and release playback when the scope, session or epoch changes.

#### Scenario: play from the asset gallery

- Given an authorized audio result in the asset gallery
- When the user clicks its play control
- Then a short-lived preview handle is requested, playback starts in the floating player, the Inspector stays closed and no `preview` query is written.

#### Scenario: a refused or expired transfer recovers

- Given the media proxy refuses the first two transfers
- When playback starts
- Then the player falls back from the in-memory read to a stream, re-grants the handle a bounded number of times and resumes from the last position.

### Requirement: The guide is navigated by chapters from a top bar

The usage guide MUST be organised into the chapters 开始, 工具, 案例, 接入 and 排障与问答, with one page per tool under 工具. A top bar MUST list the chapters as links, mark the open one with `aria-current="page"`, and stay on screen under the page's own top bar while the reader scrolls. Every chapter, tool page and section MUST have its own address: `#/guide/<chapter>/<page>?section=` when signed in, `guide.html?chapter=&page=#<section>` on the public page. Opening another chapter MUST add a history entry, so Back returns to the previous chapter; moving within the open page MUST NOT. Old addresses that only name a tool MUST open the three steps with that tool chosen.

#### Scenario: a reader moves between chapters

- Given the guide open on 开始
- When the reader chooses 案例 in the top bar and then presses Back
- Then 案例 shows with its address and marked current, and Back returns to 开始 with it marked current again.

#### Scenario: a signed-out visit to a tool page

- Given a browser with no session
- When it opens `#/guide/tools/sonora?client=codex`
- Then it lands on `guide.html?chapter=tools&page=sonora&client=codex` showing the Sonora page.

### Requirement: Each chapter has an outline

Every chapter and tool page with two or more sections MUST show 本页大纲: a rail beside the text when the chapter is wide enough, otherwise a single button that unfolds the list. The outline MUST mark the section being read with `aria-current="location"` without writing the address on scroll, and choosing an entry MUST bring that section under both sticky bars and record it in the address without a new history entry.

#### Scenario: reading on a phone

- Given the 案例 chapter on a 390px-wide screen
- When the reader unfolds 本页大纲 and chooses Agent 回放
- Then the list was folded until asked for, and the replay section scrolls into view with its address updated.

### Requirement: The guide shows real recorded samples

The guide MUST show samples produced by real calls to the owner services. Every sample MUST state the prompt, the call that produced it, the model, the cost the owner reported, the time it took, the recording date and the service versions. A cost the owner did not report MUST be shown as unreported, never estimated. Every sample MUST be labelled as AI generated.

Shipped sample files MUST carry no embedded metadata, internal address, key or full run identifier. They MUST be listed in a manifest with no unlisted file, and MUST total at most 8 MB.

#### Scenario: reading how a video sample was made

- Given the public guide
- When a visitor opens the generation record of the text-to-video sample
- Then it shows the Scaena call with model, duration, resolution and ratio, the cost as unreported with the request cap, the time and the date.

### Requirement: The guide replays recorded agent sessions

The guide MUST replay real Claude Code and Codex sessions. Each step MUST keep the actual user request, agent reply, or tool call with its action and arguments. Folded runs of similar calls MUST state how many calls they replace. An editor's note MUST correct any explanation of the agent's that the run record contradicts.

The replay MUST reveal one step at a time and move focus to each new step. It MUST follow the page's client choice. It MUST end with the result and with both the provider spend and the agent's own usage.

#### Scenario: the agent stops before spending

- Given the Claude Code replay
- When it first appears
- Then it shows the request, the discovery calls, the dry run and the agent asking for confirmation, and nothing after that until the visitor asks for the next step.

### Requirement: The guide documents each tool end to end

The guide MUST give each tool a manual covering installation, initialisation and credentials, generation, cost and confirmation, output and read-back, and links to its real samples. It MUST give Claude Code and Codex configuration in which a shared service's token appears only as an environment-variable name. It MUST give a troubleshooting table that marks the problems actually met while recording.

#### Scenario: connecting a shared service

- Given the configuration examples
- When a visitor copies the Claude Code shared-service command
- Then the resulting `.mcp.json` names `${EIKONA_MCP_TOKEN}` and contains no token.

### Requirement: Guide media works from the keyboard

The sample viewer MUST open from the keyboard, step with the arrow keys, close on Escape and return focus to the thumbnail that opened it. The before-and-after slider MUST move with the arrow keys. Video and audio MUST use native controls and load by byte range. With reduced motion, the guide MUST NOT animate the viewer or the replay steps.

#### Scenario: comparing an edit without a mouse

- Given the edit sample
- When a visitor focuses the slider and presses the right arrow five times
- Then the split moves from 50% to 55%.

### Requirement: Back closes the topmost overlay and closing leaves no extra history step

The system MUST add a history entry when a URL-backed overlay (inspector, detail sheet or media viewer) opens, MUST replace that entry when the user switches items while it is open, and MUST return to the entry the overlay was opened from when the user closes it, so that browser Back closes the topmost overlay without leaving the page and a closed overlay never leaves a duplicate or reopening history step.

#### Scenario: Back with an inspector open

- Given the user entered the task center from the home page and opened a task's inspector
- When the user presses the browser Back button
- Then the inspector closes and the task center stays on screen.

#### Scenario: Back after closing with Escape

- Given the user entered the request records from the home page, opened a request and closed it with Escape
- When the user presses the browser Back button once
- Then the home page is shown, rather than the request records again or the request reopened.

#### Scenario: the viewer opened from an inspector

- Given a task inspector is open and the user opened a result in the media viewer from it
- When the user presses Escape twice and then Back
- Then the first Escape closes only the viewer, the second closes the inspector, and Back returns to the home page.

### Requirement: keyboard movement in result lists

The system MUST let keyboard users move between the items of the task, asset, request and reminder lists with the arrow keys, MUST open an item's details with Enter on that item, and MUST return focus to the selected item's row whenever its details close and focus would otherwise fall to the page body.

#### Scenario: keyboard-only task review

- Given the task list with a task that has a previewable visual result
- When the user presses `/`, types the task name, presses ArrowDown, Enter, Tab to the row's preview, Enter, then Escape twice
- Then the search field receives the text, the first matching row gains focus, the details open, the viewer opens and closes, the details close, and focus is inside the original row.

#### Scenario: details opened with the mouse

- Given the user opened a task's details by clicking a non-button part of its row
- When the user presses Escape
- Then the details close and focus moves to that task's row button instead of the page body.

#### Scenario: skip to content under hash routing

- Given any workspace page
- When the user tabs to the skip link and presses Enter
- Then focus moves to the main content and the route does not change.

### Requirement: page shortcuts and command palette actions

The system MUST focus the current page's search field on `/`, MUST open a shortcut reference on `?`, MUST ignore both while the user is typing or a dialog is open, and MUST offer recently opened items and theme, scope and shortcut actions in the command palette without persisting content beyond the current tab and identity.

#### Scenario: shortcut reference

- Given no text field has focus and no dialog is open
- When the user presses `?`
- Then a dialog lists the global, list and viewer shortcuts and Escape closes it.

#### Scenario: recent items stay within scope and session

- Given the user opened a task in one scope
- When the user opens the command palette with an empty query
- Then the task appears under recent items, it does not appear after switching to another scope, and logging out clears the list.

### Requirement: visual results preview in a full-screen viewer

The system MUST open image, video and text previews in a full-screen viewer with one click from any result surface, MUST let the user step through the visual results of the current view without opening the Inspector, and MUST request each item's short-lived preview handle only when that item is shown.

#### Scenario: preview from the asset gallery

- Given an authorized image result in the asset gallery
- When the user clicks its preview control
- Then the viewer shows the image, writes only the `preview` query, leaves the Inspector closed, and ArrowRight shows the next visual result in the current filter order.

#### Scenario: Escape closes one layer at a time

- Given the task Inspector is open and the user opened a preview from it
- When the user presses Escape
- Then only the viewer closes, the `preview` query is cleared, focus returns to the control that opened it and the Inspector stays open.

#### Scenario: a step that cannot be read keeps the current item

- Given the viewer shows a shared project result and the next item's task read fails
- When the user steps to the next item
- Then the viewer keeps showing the current item, announces the failure inside the viewer, and a later step that succeeds clears the message.

### Requirement: accessibility baseline on primary pages

The system MUST keep the primary workspace pages free of serious and critical axe violations, including the media viewer and the Inspector preview poster.

#### Scenario: audit of the primary pages

- Given the rich fixture scenario signed in at 1440×900
- When axe runs on each primary page and on the open viewer
- Then it reports no serious or critical violations.

### Requirement: list pages put the first result on a phone's first screen

The system MUST show the first result of the task, asset, request and reminder lists within the first 400 pixels of a 390×844 viewport, MUST keep page context, notices and filters reachable from a single expandable line or a filter drawer, and MUST leave the desktop layout unchanged.

#### Scenario: task list on a phone

- Given a 390×844 viewport and a scope with tasks and a stale-data notice
- When the user opens the task center
- Then the first task row starts above y=400, the notice shows as one expandable line, and the page description and source cards appear after the user expands the status line.

#### Scenario: filters in a drawer

- Given a 390×844 viewport on the asset library
- When the user opens the filter drawer and picks a source
- Then the drawer closes on done, the list is filtered, the filter button shows one active filter, and the same URL parameter is written as on desktop.

### Requirement: Focus returns to the button that opened the viewer, also inside a detail panel

The system MUST keep a result's preview and download buttons mounted and focusable while their request is in flight. It MUST show progress on such a button and ignore repeated presses. When the full-screen viewer closes, by Escape, the close button or browser Back, focus MUST return to the button that opened it, including when that button sits inside a detail panel.

#### Scenario: closing a viewer opened from the task inspector

- Given the task inspector is open and the user pressed its 预览 button to open a result in the viewer
- When the user closes the viewer with Escape, the close button or browser Back
- Then the inspector stays open and focus is on the same 预览 button.

#### Scenario: downloading from the keyboard

- Given focus is on a result's 下载 button
- When the user presses Enter and the download handle is being requested
- Then the button shows progress, ignores further presses, and keeps focus after the download starts.

### Requirement: Open tools are read through a fixed, read-only projection

The control center MUST read DriveBridge and the personal MCP Gateway only through fixed GET routes, with a 0600 bearer credential named in its own configuration, a 5 second timeout per call, redirects refused and responses over 1 MiB dropped. It MUST NOT call tools, write, cancel or follow addresses supplied by the tool. Each reading MUST be projected to `yeisme.open_tool_projection.v1`, which keeps states, counts, sizes, times and codes and drops file paths, file names, digests, public or backend addresses, owner error text, environment variable names and process details. Open tools MUST be visible only to personal sessions whose scope lists them.

#### Scenario: a DriveBridge run fails with an owner message

- Given DriveBridge reports a failed download whose `error` is a sentence naming a file path
- When the services page reads DriveBridge
- Then the run shows as 下载 · 失败 with no error code, and neither the sentence nor the path appears in any response to the browser.

#### Scenario: the credential is refused

- Given every DriveBridge route answers 401
- When the services page reads DriveBridge
- Then DriveBridge shows 无读取权限 with the reason that the credential was not accepted, and the work queue has one 来源受阻 item for it.

### Requirement: Open tool readings are cached and kept truthful while a tool is down

A reading MUST be cached per tool for 60 seconds and shared between concurrent requests, and a forced refresh MUST be honoured at most every 15 seconds. When a tool stops answering after a good reading, the projection MUST keep the last good runs, backends and usage, marked stale, while stating that the tool is unavailable now; refusals (forbidden, missing routes) MUST NOT fall back to old data.

#### Scenario: DriveBridge stops answering

- Given a good DriveBridge reading a minute ago
- When the next forced reading cannot reach DriveBridge
- Then the card shows 来源不可用 with the earlier runs and says which time they are from.

### Requirement: The workbench raises open tool failures

The work queue MUST add an `operation_failure` item for each open tool run that failed or ended unknown in the last 7 days (at most 10 per tool), a `service_blocked` item when a tool cannot be read or a Gateway backend it reports enabled is down, and a `contract_gap` item when a route the projection relies on is missing. Run states the adapter does not recognise MUST be shown as unknown but MUST NOT be raised. The workbench 服务状态 panel and the 来源覆盖 bar MUST list configured open tools with their state.

#### Scenario: an unknown upload outcome

- Given DriveBridge reports an upload in `submission_unknown`
- When the home page loads
- Then the queue has a 运行失败 item titled DriveBridge 上传结果未知, and 服务状态 lists DriveBridge with the number of runs to handle.

### Requirement: The tool catalog lists the Gateway's tools when it is configured

When the scope lists the Gateway, the tool catalog MUST replace the Gateway placeholder with the tools the Gateway lists, each with its backend, title, description, annotations and input fields, and MUST record drift in the change ledger like other owners. Listing a tool MUST NOT make it callable from the control center.

#### Scenario: filtering the catalog by Gateway

- Given the Gateway lists tools for two backends
- When the reader opens 模型与工具 and filters by MCP Gateway
- Then only the Gateway's tools are listed, and none offers a way to call it.

### Requirement: A page whose code is already loaded opens without a loading placeholder

The system MUST render a route page directly when its code has already been loaded, whether by the idle prefetch after sign-in or by an earlier visit. It MUST show the page-shaped loading placeholder only while the page's code is still loading. It MUST NOT remount a page that is already on screen when its code finishes loading.

#### Scenario: first visit after the idle prefetch

- Given the user signed in and the page chunks were prefetched while the browser was idle
- When the user opens a page from the sidebar for the first time
- Then the page renders without the page-shaped placeholder appearing.

#### Scenario: a cold deep link

- Given the user opens a link straight to a page before its code has loaded
- When the page code is still loading
- Then the page-shaped placeholder is shown until the page renders.

### Requirement: The guide is a public page

The system MUST serve the usage guide at `guide.html` to visitors without a session. The page MUST NOT call the control-center API, read account, owner or tool-catalog data, or set cookies. It MUST keep the chosen tool and client in its address. A signed-out visit to the in-app guide address MUST land on the public page with the same choices, and the sign-in screen MUST link to it.

#### Scenario: a visitor without an account

- Given a browser with no session
- When it opens `guide.html?tool=sonora&client=codex`
- Then the full guide shows with Sonora and Codex selected, and no request goes to `/api/`.

### Requirement: Static files serve media correctly

The server MUST serve guide media with its media type and MUST honour a single byte range (206, or 416 when unsatisfiable). It MUST answer a missing file that has an extension with 404 rather than the app's HTML. Only content-hashed assets MAY be cached long term, and the content policy MUST forbid plugins and foreign form targets.

#### Scenario: a video seeks

- Given a video file in the built guide
- When the browser requests `Range: bytes=0-99`
- Then the server answers 206 with exactly those bytes and `Content-Range: bytes 0-99/<size>`.

### Requirement: Only the served entries are sent, built and released

The control center MUST send only the files named in `servedEntries` (`index.html`, `guide.html`, `favicon.svg`, `favicon.ico`, and the subtrees `assets/`, `guide/`, `v18/`) from its built directory, and MUST answer every other real file there with 404, whether it is asked for directly or through dot segments or encodings. A page address that is not a file SHALL still fall back to the app's index page. The production build MUST NOT copy `docs/` into `dist/` and MUST remove every top-level entry of `dist/` that is not served, without deleting anything in `public/`. Release preparation and deployment preparation MUST copy only the served entries. The public-surface check MUST fail when an existing `dist/` holds an entry outside the list.

#### Scenario: a source archive and the docs sit in the built directory

- **WHEN** the built directory contains `source.zip` and `docs/README.md` and a client asks for `/source.zip`, `/docs/README.md`, `/assets/../source.zip` or `/docs/third-party/geist-LICENSE`
- **THEN** every answer is 404 with no file, and `/`, `/guide.html` and files under `assets/`, `guide/` and `v18/` are still served

#### Scenario: the build is checked

- **WHEN** `vite build` finishes with an ignored `public/source.zip` present and `check:public-surface` runs
- **THEN** `dist/` holds no `source.zip` and no `docs/`, `public/source.zip` itself is untouched, and the check passes; with a stray `dist/docs/README.md` it fails with `unserved-dist-entry`

### Requirement: A release candidate is built here, from a recorded commit

`prepare-intranet-release.ts` MUST run the production build itself instead of copying an existing `dist/`, and MUST record `source_commit`, `dirty`, `dirty_allowed` and `changed_files` in its evidence. It MUST refuse to build when tracked files differ from HEAD unless `YEISME_RELEASE_ALLOW_DIRTY=1` is set; untracked and ignored files MUST NOT count as dirty. A refusal MUST leave a failed summary with `failure: dirty_working_tree` and MUST NOT build or copy anything.

#### Scenario: a tracked file is modified

- **WHEN** the working tree has a modified tracked file and the candidate is prepared without the allowance
- **THEN** the summary is `failed` with `dirty_working_tree`, the number of differing files is recorded, and no build runs

#### Scenario: only untracked files exist, or the allowance is given

- **WHEN** the tree holds untracked files only, or has tracked changes and `YEISME_RELEASE_ALLOW_DIRTY=1` is set
- **THEN** the candidate builds; in the second case the evidence records `dirty: true` and `dirty_allowed: true`

### Requirement: Releases are read back as a viewer

The authenticated read-back MUST sign in exactly once per run, using an access key from a private (0600) probe file, and MUST NOT retry the login. It MUST check that the session's role is viewer; that `/services` without `observe=1` contains no `credential_ref`, key or password hash reference and no home directory path; that `/notifications` answers 200; that `/observation/status` answers 200 or 404, recording 404 as absent; that `/admin/personal-users`, `/audit` and a preview of `admin.user.revoke` are refused with 403; and that logout succeeds and ends the session. Its result and evidence MUST NOT contain the access key, the session cookie, the address or any response body. When `YEISME_RELEASE_PROBE_FILE` is set, `control-release.ts` MUST read the probe file before changing anything, run the read-back after activation and the static checks, and record `verification.authenticated_read`; any 5xx answer MUST take the existing rollback path, while a refused login (401), a rate-limited one (429) or any other failed check MUST mark the read-back failed without rolling back.

#### Scenario: the viewer read-back passes

- **WHEN** the read-back runs against a release with a viewer account
- **THEN** one login is made, every check passes or is absent, the session is closed, and the evidence has statuses and short codes only

#### Scenario: the server fails or refuses the probe

- **WHEN** the release answers 5xx during the read-back, or answers the login with 401 or 429
- **THEN** a 5xx rolls the release back, while 401 and 429 leave it in place with `authenticated_read` false and the failure code recorded

### Requirement: Candidates are verified apart from live services

`verify-release-component.ts` MUST start the candidate on `YEISME_RELEASE_VERIFY_PORT` or 4380 and MUST NOT default to 4313. It MUST run the candidate with `YEISME_CONTROL_BACKGROUND=off` and with observation disabled in its isolated configuration, MUST confirm that `/source.zip` and `/docs/README.md` are 404, and MUST run the viewer read-back against the candidate with a throwaway viewer created only in the isolated configuration. It MUST NOT write the live configuration.

#### Scenario: a candidate is verified

- **WHEN** the component verification runs for a candidate
- **THEN** the candidate listens on the verification port only, background reads are off, the unserved files are refused, the throwaway viewer's read-back passes, and the isolated directory is removed afterwards

### Requirement: Account commands keep keys off the screen and end old sessions

`personal-config user add` MUST write the one-time access key to a new 0600 file named by `--key-file`, MUST NOT print it, and MUST refuse a key file that already exists before writing anything; without `--key-file` it SHALL keep printing the key once. `user rotate` MUST replace the account's key digest atomically so that the account's existing sessions stop working on their next request and only the new key signs in. `user enable` MUST restore a revoked account. `observe on|off` MUST write `config.observation` and MUST reject an interval below 5 minutes, an `open_tools_every` below 1, and malformed recipients without rewriting the file; the defaults are 10 and 3.

#### Scenario: a key is issued to a file

- **WHEN** an operator adds a viewer with `--key-file` naming a new path
- **THEN** the file exists with mode 0600 and holds a key that matches the stored digest, the command output contains no key, and naming an existing file fails with nothing written

#### Scenario: a key is rotated

- **WHEN** an account with a live session is rotated
- **THEN** the session's next request is 401, the old key no longer signs in, the new key does, and the configuration file is unchanged

### Requirement: Account changes through the server touch only the account list

When an administrator creates or revokes a personal account through the server, the server MUST read the configuration file again, MUST replace only `personal.users`, and MUST write the result through a temporary file renamed over the original with mode 0600. It MUST NOT write values that came from the environment, and MUST keep edits made to the file and accounts added with `personal-config` since the server started. When the file cannot be read, creating an account MUST fail with 503 and leave no account and no key digest behind, and a revocation MUST still take effect in memory at once.

#### Scenario: the file was edited while the server ran

- **WHEN** `observation` and an extra account were written to the file after start and the server then creates another account
- **THEN** the file keeps `observation` and both accounts, holds no environment-derived provider or bind value, and has no temporary file left beside it

### Requirement: Workflows match the scripts they call

The CI workflow MUST run `test:server-boot` and, after the production build, `test:public-guide`. The Provider canary workflow MUST take only USD budgets (`total_usd`, `image_usd`, `video_usd`, `audio_usd`) with `run_label` and `modality` required, MUST pass every input to the script through `env:` and MUST NOT place an expression inside a `run:` step. The script's arguments MUST be parsed by one module that rejects CNY flags, unknown flags, repeated flags and a flag without a value. Every `bun run` script named by a workflow MUST exist, and the retired `test:task-visibility` MUST NOT remain.

#### Scenario: the canary workflow is dispatched

- **WHEN** the workflow's inputs are filled in and expanded the way the shell expands them
- **THEN** the script's argument parser accepts the result, and an input whose value looks like a flag is rejected rather than read as one

### Requirement: A handled reminder stays handled across server restarts

The system MUST identify a failure reminder by the task's identity (scope, connection, owner task reference and family) and the failure version. It MUST NOT use the signed task key, whose signature may change between server processes. It MUST keep the task-key signing key with its database. After a restart, a failure the user already acknowledged, muted or archived MUST NOT reappear as unread.

#### Scenario: a release restarts the server

- Given the user acknowledged every open failure reminder
- When the control center restarts and observes the same failures again
- Then no new reminder is created, the reminders stay acknowledged, and the unread count does not rise.

#### Scenario: reminders duplicated by earlier releases

- Given the database holds several reminders for one failure version, written under different task-key signatures
- When the control center starts with this change for the first time
- Then those reminders are rewritten in place under the task identity, keep their ids, and all take the furthest-handled state among them.

### Requirement: One unread count for the badge, the bell and the reminders page

The system MUST count a reminder as unread only when it is unread and not yet read, handled, snoozed or recovered. It MUST compute that count over every reminder, not just the loaded page. The sidebar badge, the bell and the reminders page MUST show the same count.

#### Scenario: acknowledging a reminder

- Given the sidebar badge, the bell and the reminders page all show the same unread count
- When the user acknowledges one reminder
- Then all three show a lower count.

### Requirement: Lasting mute rules

The system MUST let the user mute later failure versions of one task, or of one owner's error code. Matching failures MUST be recorded as muted and never counted. The rules MUST be listed and removable, and after removal later failures MUST notify again.

#### Scenario: muting a task that keeps failing

- Given the user chose "此任务以后都免提醒" on a reminder
- When the same task fails again with a new revision
- Then the new reminder is recorded as muted and the unread count does not change.

### Requirement: source status is stated once in the top bar and at most one line per page

The system MUST derive task source status from one shared reading of the scope's connections, MUST show it in the top bar on every viewport width, MUST limit each page's notices to one line that names what the page lacks, MUST NOT repeat the same cause in more than one notice on a page, and MUST let the user reach 服务与连接 from that line or the page's connection tile in one step.

#### Scenario: some connections cannot be read

- Given a scope where two of five task connections are unreadable and the others return tasks
- When the user opens the task center, the asset library or the review page on a desktop or a phone
- Then the page shows one line naming the two connections and saying the list may be incomplete, the line has a 服务与连接 button that opens the services page, the top bar shows 3/5 连接可读, and no notice says the data may be stale.

#### Scenario: the home page already lists the blocked sources

- Given the same scope
- When the user opens the home page
- Then no source notice line is shown, the work queue lists the blocked sources, and the 可读连接 tile opens the services page in one click.

### Requirement: a failed read keeps the last batch and says it may be old

The system MUST keep the last observed tasks when both task lanes fail in transit, MUST mark them as possibly stale with the time they were observed, MUST still clear tasks when a read is refused, and MUST re-read immediately when the user asks to read again.

#### Scenario: the control center becomes unreachable

- Given the asset library showing results
- When both task reads fail with a network error
- Then the results stay on screen, the page shows one line saying the data may be stale with 重新读取 and 服务与连接, and the top bar says 数据可能已过期.

#### Scenario: the connection comes back

- Given the stale state above
- When the network recovers and the user clicks 重新读取
- Then the next read happens at once instead of reusing the failed result, and the stale line disappears.

### Requirement: Every readable tool project can be bound, several per tool

The system MUST offer as binding options every tool project a source scope of the organization's tenant reads: the scope's default project for each tool, and the project of each of its connections. A shared project MUST be able to bind up to ten tool projects, several of the same tool. It MUST NOT bind the same project twice. The server MUST rebuild each binding's connection ids from its own view, and project-wide delegated reads MUST only reach projects the shared project binds.

#### Scenario: binding two projects of one tool

- Given a scope reads Eikona projects A (default), B and C
- When an administrator creates a shared project bound to B and C
- Then the shared project reads tasks of B and C, and no delegated read reaches A.

#### Scenario: generation needs a target project

- Given a shared project binds two Eikona projects
- When a creator prepares a generation item without naming one of them
- Then the server rejects it with `generation_target_project_required`; naming one routes every owner call of that item to it.

### Requirement: An administrator connects a tool project by reference

The system MUST let an administrator, in a personal session, connect another project of a tool by entering its reference, reusing an enabled connection configured for the same scope. Before saving, the server MUST ask the owner once through a throwaway connection. A refusal MUST be reported without blocking the configured connection. A connected project MUST be readable without a restart and MUST NOT be able to cancel tasks. Only connected projects MAY be disconnected.

#### Scenario: the owner refuses the project

- Given the configured credential does not cover project P
- When the administrator tries to connect P
- Then the preview fails with `owner_project_not_accessible` and the configured connection keeps reading.

#### Scenario: the owner accepts the project

- Given the configured credential covers project Q
- When the administrator connects Q
- Then Q appears among the tool projects and binding options at once, and its tasks are read on the next refresh.

### Requirement: One place for shared projects and tool projects

The system MUST present shared projects and tool projects as two tabs of the projects page. It MUST group tool projects by tool and show which ones are the default, which were connected here, and how many shared projects use each. Each tool project's menu, and its context menu, MUST offer creating a shared project from it and adding it to an existing shared project.

#### Scenario: starting a shared project from a tool project

- Given a tool project in the tool-projects tab
- When the user chooses "用它新建共享项目"
- Then the shared-project form opens with that tool project already selected.

### Requirement: Only admins run admin, owner and paid actions

The control center MUST refuse, with 403 `control_center_admin_required`, every action preview and confirm that is not a collaboration action unless the session's role is admin, and MUST re-check the role at confirm. Account actions (`admin.*`) MUST additionally require a personal session. Provider run submit and reconcile MUST require an admin before the request body or the run is read. Collaboration actions MUST keep their project grants.

#### Scenario: viewer tries an admin or paid action

- **WHEN** a viewer previews `admin.user.create`, `admin.user.revoke`, `provider_runs.create`, `task.cancel` or `project.metadata.*`, or posts to `/provider-runs` or a run's reconcile route
- **THEN** the response is 403 `control_center_admin_required` and nothing is created, revoked, submitted or changed

#### Scenario: role downgraded after a preview

- **WHEN** an admin previews an action and is downgraded to viewer before confirming
- **THEN** the confirm is refused with 403 `control_center_admin_required`

### Requirement: A table's main column stops growing on wide screens and never widens the table

The system MUST fix a table's main column (the column that names the row) at 560px once the table is wide enough that a wider main column would only add empty space before the next column, MUST let the other columns share the remaining width, and MUST keep a single long line in the main column from widening the table beyond its container at any width.

#### Scenario: the task list on a 1920px screen

- Given the task center is shown on a 1920px-wide screen
- When the task list renders
- Then its main column is 560px wide and the other columns share the rest of the table.

#### Scenario: stacked catalog tables line up

- Given the tools tab of models and tools is shown on a screen at least 1536px wide
- When the MCP tool and action tables render one above another
- Then every table's main column is 560px wide, so the columns after it start at the same position.

#### Scenario: a long owner description

- Given an owner returns a one-line description far longer than the main column
- When the catalog table renders it
- Then the description is truncated within the column and the table does not scroll horizontally.

### Requirement: Rows of an asset list keep one rhythm across media kinds

The system MUST give audio and video rows in the asset lists a media slot the same size as an image thumbnail, so that names start at the same position and rows keep the same height regardless of media kind.

#### Scenario: a compact list mixing images and audio

- Given the asset library shows the compact list with image, audio and video results
- When the rows render
- Then every result name starts at the same horizontal position and every row has the same height.

### Requirement: The services directory folds registered-only entries into one closed group

The services page MUST list the directory entries that are integrated, or that someone configured, in the directory table, and MUST fold every other entry whose `integration` is `not_integrated` into one group titled 「未接入」 that is closed by default. The group's title MUST be a heading that holds a button carrying `aria-expanded` and `aria-controls`, the panel it controls MUST stay in the page and be `hidden` while the group is closed, and the title MUST show how many entries the group holds (`17 项`, or `3 / 17 项` while a filter or a search keeps only some of them). Whether the group is open SHALL be remembered in this browser (local storage key `yeisme.control.services.unintegrated-open`, `1` for open), be closed until someone opens it, and an unusable storage MUST NOT break the page. While a search text is entered or the 缺口 filter is chosen, the matching entries of the group MUST be listed at once under a title that is not a button, and the remembered choice MUST be left as it was. The rows of the group MUST NOT repeat the integration line or a status pill, because its title already says so. An entry whose `integration` is `not_integrated` but whose `configuration` is `configured` MUST stay in the directory table.

#### Scenario: the default view

- **WHEN** the directory has 8 integrated entries and 17 registered-only entries and nothing was remembered
- **THEN** the directory table lists the 8, the group 「未接入」 shows `17 项` with its button reporting `aria-expanded="false"`, and the 17 entries are not visible

#### Scenario: opening is remembered

- **WHEN** the button is pressed with Enter, the page is reloaded, and the button is pressed again
- **THEN** the group opens and lists the 17 entries, it is still open after the reload, and it is closed again after the second press, with the value `1` and then `0` kept under the storage key

#### Scenario: a search asks for the entries

- **WHEN** 「pinax」 is typed into the directory search while the group is closed
- **THEN** the group lists the one matching entry under the title `1 / 17 项` with no button, the directory table does not claim there is no match, and clearing the search returns the group to the remembered closed state

#### Scenario: a registered-only entry that was configured

- **WHEN** an entry whose `integration` is `not_integrated` has `configuration` `configured`
- **THEN** it is listed in the directory table and is not counted in the group

### Requirement: One short label names the state of waiting for an owner contract

Every chip, pill, column value and metric hint that shows the state `needs_contract`, meaning the source is known to exist but its owner has not provided an interface the control center can use, MUST use the one word 「待补齐接口」, taken from `needsContractLabel` in `src/shared/read-model/labels.ts`, and MUST NOT spell it 「待接入」, 「待接口」 or 「待合同」. The word 「未接入」 belongs only to the services directory's group of entries the control center has no contract for, so that no page shows both words for one state. Sentences that explain the gap MAY keep their own words.

#### Scenario: the same state reads the same everywhere

- **WHEN** the request coverage, the read status, the open tool state and its read checks, the process timeline, the catalog coverage, the provider readiness, the source coverage strip, the drama stage rail, the work queue inspector, the catalog's pending panel and the MuWeave hand-off row show `needs_contract`
- **THEN** each of them says 待补齐接口, and none of them says 待接入, 待接口 or 待合同

### Requirement: The guide's pickers are radio groups that the keyboard can drive

The guide's pickers (选择工具, 选择 Agent 客户端, 选择回放的客户端) and the public guide page's theme switch MUST follow the WAI-ARIA radio group pattern: the checked radio, or the first when none is checked, SHALL be the one tab stop of its group (`tabindex` 0, the others −1); ← and ↑ MUST move to the previous radio and → and ↓ to the next, moving focus to it and checking it, going round from the last to the first and back; Home and End MUST go to the first and the last. A key pressed with Ctrl, Alt, Meta or Shift, and a key the group does not use, MUST be left to the browser. The movement MUST be computed with `moveIndex` from `src/shared/keyboard.ts`. The chapter bar `nav[aria-label="指南章节"]` MUST stay a list of real links, each an ordinary tab stop, the current one marked `aria-current="page"`.

#### Scenario: arrow keys inside a picker

- **WHEN** focus is on the checked tool and → is pressed, then End, then ↓
- **THEN** the next tool is checked and focused, then the last, then the first, and the address names the chosen tool each time

#### Scenario: Tab passes through a picker once

- **WHEN** focus is on the checked tool and Tab is pressed
- **THEN** focus moves out of the tool picker to the client picker's checked radio, not to the next tool

#### Scenario: the keys are wired in the browser

- **WHEN** the public guide is opened and the keyboard drives the tool picker, the client picker and the theme switch
- **THEN** each group has one tab stop on its checked radio, →, ←, ↑, ↓, Home and End move focus and the choice (wrapping at the ends), Shift+→ does nothing, and Tab leaves the group

#### Scenario: keys the group does not use

- **WHEN** Alt+→, Enter or Tab is pressed on a radio, or End is pressed on the last radio
- **THEN** the choice does not change and the key's default is not prevented

### Requirement: A credential that does not expire is recorded as never

`credential_expires_at`, and `flow_credential_expires_at` for Auctra's reader key, MAY hold the exact lowercase word `never`. `credentialStatuses()` MUST judge a slot with that record by everything else first (an unreadable file, a refusal and a limited read keep their place in the fixed order) and otherwise as `ok`, with no `expires_at`, `days_left` or `stage`, and with `never_expires: true` on its row; its chip MUST read 「不过期」, and it MUST NOT count as a slot with no recorded expiry. `parseRfc3339` MUST keep refusing everything that is not an RFC 3339 time with seconds and a zone; any other value that is not such a time, including `Never`, `NEVER`, `forever`, `none`, a padded `never` and a bare date, MUST still be a recorded expiry that cannot be read (`unknown_expiry` with reason `invalid_expiry`).

#### Scenario: a never-expiring key

- **WHEN** a connection's `credential_expires_at` is `never` and its file is a private, non-empty file that the owner accepts
- **THEN** its row is `ok` with `never_expires` true and without `expires_at` or `days_left`, at any later date, and its card footer and panel row say 不过期

#### Scenario: something else is wrong with it

- **WHEN** the file is group-readable, or the owner denies the credential, or only content access is denied
- **THEN** the row is `unreadable` with reason `permissions`, `rejected`, or `limited`, and keeps `never_expires`

#### Scenario: only the exact word

- **WHEN** the record is `Never`, ` never`, `forever` or `9999-12-31T23:59:59` (no zone)
- **THEN** the row is `unknown_expiry` with reason `invalid_expiry`

#### Scenario: Auctra's two keys

- **WHEN** the collector key records `never` and the reader key records a date three days away
- **THEN** the collector slot is `ok` and the reader slot is `expiring` at stage `7d`

### Requirement: personal-config records never for an expiry only

`personal-config` MUST accept the exact word `never` as an expiry and store it as the string `"never"`: as `--expires-at never` on `connect`, `open-tool`, `provider`, `auctra` (for both of its keys) and `credential replace`, and as `credential <config-file> expiry <slot> never`. It MUST refuse every other value that is not a strict RFC 3339 time (`Never`, `forever`, a bare date, an empty value) and MUST refuse `never` as `--issued-at`, as `--expires-in`, or together with `--expires-in`, leaving the configuration file byte for byte unchanged and its inode as it was; an issue time MUST NOT make `never` invalid. A re-run or `--replace` that names the same credential file MUST keep a recorded `never` unless a new expiry is given, one that names another file MUST clear it with the usual notice, and `credential list` MUST print `expires_at: "never"` and no `days_left` for such a slot. The error for a refused expiry MUST name the word `never` as acceptable, and the error for a refused issue time MUST NOT.

#### Scenario: never in every command that takes an expiry

- **WHEN** `connect`, `open-tool`, `provider` and `auctra` are run with `--expires-at never`, then `credential … expiry open_tool:gateway never` and `credential … replace connection:<id> <file> --expires-at never`
- **THEN** each stores `"never"` next to its credential reference (both Auctra keys for `auctra`), `connect` says the credential never expires, and `replace` prints no notice

#### Scenario: nothing else passes for it

- **WHEN** `Never`, `NEVER`, ` never`, `forever`, `infinite`, `2026-11-30` and the empty string are given as an expiry, and `never` is given as `--issued-at` or `--expires-in`
- **THEN** every command exits with an error and the configuration file is unchanged

#### Scenario: the same file keeps it

- **WHEN** `open-tool … --replace` is run with a new address and the same credential file, and then with another file
- **THEN** the first keeps `never` and reports `expiry_kept`, and the second clears it and reports `expiry_cleared`

### Requirement: observe refuses what the server would treat as invalid

`personal-config observe` MUST take its bounds from `observationBounds` in `server/observation-config.ts` and MUST check the whole `observation` block it is about to write with `observationProblems`, refusing a block that the server would treat as invalid and writing nothing: an interval outside 5 to 1440 minutes, `open_tools_every` outside 1 to 1000, more than 100 recipients, a recipient longer than 200 characters, or a problem an earlier hand edit left in the block. The refusal MUST name the problem codes and MUST NOT print any value from the block. The most the server accepts MUST be accepted: exactly 100 recipients, and a recipient of exactly 200 characters.

#### Scenario: the limits are the server's

- **WHEN** `observe on --recipients` is given 100 entries, then 101, then one entry of 200 characters, then one of 201
- **THEN** the first and third are written and pass `observationProblems`, and the second and fourth are refused with the file unchanged

#### Scenario: a block that a hand edit made invalid

- **WHEN** the configuration holds an `interval_minutes` of 3 and `observe on --recipients <entry>` is run
- **THEN** it is refused with `observation_interval_out_of_range` and writes nothing, and `observe on --interval-minutes 10 --recipients <entry>` repairs it

### Requirement: observe refuses an existing observation block that is not an object

When the configuration's `observation` is present and is not an object (a string, a number, a boolean or an array; `null` counts as absent, as on the server), `personal-config observe` MUST refuse with `observation_not_an_object`, MUST write nothing and MUST NOT spread the value into the new block; no flag can repair it, so the message tells the operator to correct or remove the block in the file.

#### Scenario: a hand-edited block

- **WHEN** `observation` is the string `yes` and `observe on`, `observe off`, `observe on --interval-minutes 10` or `observe on --recipients <entry>` is run
- **THEN** each exits with an error that names `observation_not_an_object` and says nothing was written, and the file and its inode are unchanged; with `observation` null, `observe on` writes a fresh block

### Requirement: The services page opens the credential a deep link names

`#/services?ref=<slot>` MUST open the credentials panel's row whose slot id is exactly `<slot>`: the row SHALL be highlighted (`data-linked`), scrolled into view and focused, and when it is among the folded healthy rows the group MUST be open from the first render. This SHALL happen once per link: a later reload of the page's data MUST NOT reopen a group the reader folded, move focus again or scroll again. A missing, empty, unknown or near-miss slot (a prefix, a different case, surrounding spaces) MUST name no row and MUST leave the page as it opens without the parameter, without an error.

#### Scenario: a refused credential and a healthy one

- **WHEN** the page is opened with `ref` set to a refused credential, and then to a credential in the folded group
- **THEN** the first row is highlighted, in view and focused with the group still folded, and the second opens the group and is highlighted, in view and focused; folding the group afterwards and re-reading the data leaves it folded

#### Scenario: nothing to find

- **WHEN** `ref` is empty, names an unknown slot, or differs from a slot only by case or by a missing suffix
- **THEN** no row is highlighted or focused, the healthy group stays folded and the page shows no error

### Requirement: The reminder list is re-read while a page is open

The browser MUST re-read the first page of reminders from the control center's own ledger every 60 seconds, without asking any owner. It MUST NOT re-read on a timer while the page is hidden, unless desktop notifications are switched on, and MUST re-read at once, and count the next minute from then, when the page comes into view or its window gains focus. A re-read MUST NOT run while another is still running, MUST keep rows the person loaded beyond the first page, and MUST be discarded when the person changed the list after it began: a change begins when a reminder action starts (not only when it has finished), when a new sync is asked for, and on a scope change. The server leaves a snooze's end time in the row, so the same rows come back when it ends: the browser MUST work the quiet group, the tab counts and the home attention list out against a clock that moves on at the end of each snooze and whenever the rows change (so a snooze that ended is never taken for one still running), MUST wait in steps for a snooze further off than a timer can wait, and SHOULD re-read when one ends instead of waiting for the next minute.

#### Scenario: the loop wrote a reminder while the page was open

- **WHEN** the background loop writes a reminder and the page is in view
- **THEN** within about a minute the sidebar badge, the bell and the reminders page include it, with no owner request made by the page

#### Scenario: the tab was hidden

- **WHEN** the tab is hidden for an hour with desktop notifications off, and the person then focuses it
- **THEN** no re-read ran while it was hidden, and one runs at the moment it is focused

#### Scenario: an action is made while a read is in flight

- **WHEN** the person archives a reminder after a re-read began and before it answered, or mutes one in the bell, which asks for a new sync
- **THEN** the answer is dropped from the moment the action starts, and the reminder does not come back for a moment as unread, nor stay unread if the page's own follow-up read fails

#### Scenario: a snooze ends while the page is open

- **WHEN** a reminder is snoozed for a few seconds while the reminders page shows the quiet group
- **THEN** with no click and no reload, when the snooze ends the row leaves the quiet group, the quiet tab's count drops and the new tab's count rises, the sidebar badge and the bell count it again, and the row reads as an ordinary new reminder

### Requirement: Desktop notifications are opt-in and say nothing about the work

Desktop notifications MUST be off until the person turns on a switch in the reminders toolbar, and the browser MUST be asked for permission only by the click that turns it on. When the browser has no notification support, the page is not a secure context, or the permission is denied, the switch MUST be off and disabled and MUST say why in Chinese. While on, the page MUST notify only reminders that became unread after the switch was turned on: a reminder that was unread then, or that the page showed while it was in view, is a baseline that never notifies, and a reminder leaves the baseline once it stops being unread, so one reopened later is new again. It MUST show nothing while the page is visible and its window has focus. It MUST notify a reminder once per incident, using the reminder's id as the notification `tag`: once more when a snooze on it ends, and once more when a condition that ended comes back (the ledger reopens the same reminder with a new first-seen time), but not when the person reopens it. Everything unread that the page showed while it was in view MUST be in the baseline, those notified before included, and the memory of what was notified MUST be limited, forgetting reminders that are no longer unread before ones that still are; a reminder in the baseline MUST NOT be notified because its entry was forgotten. A batch MUST show at most three notifications and one summary notification for the rest. What a notification says MUST be limited to the tool or owner name, the kind of reminder and counts; it MUST NOT contain a task title, a prompt or any text an owner wrote. The ids already notified MUST be kept per account, in storage that every tab of the account shares, and so is the switch: when it is turned off in one tab, every other tab, including one that is out of sight and still reading, MUST follow at once (its switch shows off, it stops reading while hidden and notifies nothing), and each pass MUST read the switch from storage rather than trust what the tab last heard. When the browser's permission comes back by itself while the switch is stored on, the next pass MUST take what is unread then as the baseline and show nothing. Clicking a notification MUST focus the page and open `#/reminders?focus=<id>` (the summary opens `#/reminders`). The page MUST NOT use a service worker or any push service.

#### Scenario: the switch is turned on

- **WHEN** the person turns the switch on
- **THEN** the browser is asked for permission by that click and not before, the reminders that are unread at that moment are the baseline, and nothing is shown for them

#### Scenario: a burst arrives while the page is hidden

- **WHEN** six new unread reminders reach the page while it is hidden
- **THEN** three notifications are shown, newest first, each tagged with its reminder's id, and one summary says three more; a re-read a minute later shows nothing

#### Scenario: the same reminder in another account

- **WHEN** one account was notified about a reminder and another account on the same browser is not yet
- **THEN** only the second account is notified about it, because notified ids are kept per account

#### Scenario: a snooze ends

- **WHEN** a reminder that was already notified is snoozed and its snooze ends while the page is hidden
- **THEN** it is notified once more, and not again until another snooze on it ends

#### Scenario: a credential problem comes back

- **WHEN** a credential reminder that was notified recovers, and later the same problem opens the same reminder again with a new first-seen time while the page is hidden
- **THEN** it is notified once more, with the reminder's id as tag; seeing it again with nothing changed, or the person reopening it, shows nothing

#### Scenario: the switch is turned off in another tab

- **WHEN** the person turns the switch off in one tab while another tab of the account is hidden and has it on
- **THEN** the hidden tab's switch shows off without a reload, and a reminder that becomes unread afterwards is not notified by it

#### Scenario: the permission is denied

- **WHEN** the browser has denied notifications for the site
- **THEN** the switch is off and disabled, and the page says that notifications are blocked and where to allow them

### Requirement: A reminder can be snoozed and reopened

`POST /notifications/:id/snooze` with a body that is exactly `{ "until": <time> }` MUST put an unread, unrecovered reminder aside until `until`, which MUST be an RFC 3339 time with a zone, in the future and at most 30 days away. The reminder MUST stay `unread`; until the time passes it MUST NOT count as unread anywhere (the sidebar badge, the bell, the reminders page, the home attention count) and MUST be listed with the quiet reminders; when the time has passed it MUST count again without any further action. A reminder that is not unread, or has recovered, MUST be refused with 409 `notification_not_snoozable`; an invalid `until` with 400 `invalid_snooze_until`; a body of another shape or over 256 bytes with 400 `invalid_request`. The route MUST require a CSRF token and MUST refuse a reminder of another account or another scope with 404, exactly as the other reminder actions do, and MUST change nothing but the reminder ledger. A later snooze MUST replace an earlier one. Observing the same failure again MUST NOT end a snooze, and a new failure version MUST open a reminder that is not snoozed. `POST /notifications/:id/reopen` MUST return an archived, acknowledged, muted or snoozed reminder to unread and clear its archive and snooze times. The choices the page offers ("1 小时后", "明天上午", "下周一上午") MUST be turned into a time when the person chooses one, not when the menu was built, so a page left open overnight never sends a time in the past or the wrong day.

#### Scenario: an hour of quiet

- **WHEN** an unread failure reminder is snoozed for an hour
- **THEN** the unread count drops by one everywhere, the row shows with the quiet ones with its end time, and an hour and a minute later the count includes it again with nothing done to it

#### Scenario: an invalid time

- **WHEN** `until` is missing, not a time, has no zone, is in the past, or is 31 days away
- **THEN** the request is 400 `invalid_snooze_until` and the reminder is unchanged

#### Scenario: a handled reminder

- **WHEN** an archived reminder is snoozed
- **THEN** the request is 409 `notification_not_snoozable`; reopening it makes it unread again, and reopening a snoozed one makes it count at once

### Requirement: Reminders are labelled by what they are

The bell and the reminders page MUST label a reminder of category `operation` as an open-tool run and one of category `credential` as a credential, each with its tool or owner name, and MUST NOT call either "项目协作". Only a reminder about a task failure MAY show a failure version (revision, error code, owner state) and offer muting by task or by error code; reminders of the other categories MUST NOT. A credential reminder MUST show the credential's state in the words the services page uses and, when it has one, the reason.

#### Scenario: a credential reminder in the bell and on the page

- **WHEN** an unread credential reminder for the Gateway is in the list
- **THEN** the bell names it as the Gateway's credential, the page shows no revision or error-code line and no "此任务以后都免提醒", and it offers "稍后提醒", "确认" and "归档"

### Requirement: The reminders page says what background observation did

The reminders page MUST show one line from `GET /observation/status` for the current scope: whether observation is on, how often it runs, how long ago the last cycle ended and how many pages it read and reminders it opened and recovered, when the next cycle is, and whether the signed-in account is a recipient. The line MUST contain counts and times only and MUST NOT appear when the server does not have the route.

#### Scenario: observation is off

- **WHEN** the status says observation is not enabled
- **THEN** the line says that no reminder is created while nobody has a page open

#### Scenario: a cycle has run

- **WHEN** the last cycle read nine pages, opened two reminders and recovered one, and the signed-in account is a recipient
- **THEN** the line says so with those numbers and when the next cycle is, and names no connection, address, path or error code

