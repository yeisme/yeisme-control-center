# Control Center Frontend Backend Specification

## ADDED Requirements

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
