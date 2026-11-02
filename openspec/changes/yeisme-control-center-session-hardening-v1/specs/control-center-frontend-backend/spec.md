# Control Center Frontend Backend Specification

## ADDED Requirements

### Requirement: A running server follows the accounts in the configuration file

Before it handles a request that needs the account list, and before each background observation cycle, the server MUST compare the configuration file with the version it last took the accounts from (one `stat`: inode, size, modification and change time). When it changed, the server MUST read the file again and replace only `personal.users`, in one assignment, and MUST NOT take any other value from it. A file that cannot be read, is not valid JSON, has no `personal` block, or whose `users` is not a list MUST leave the accounts in memory as they are and MUST be tried again at the next request. Accounts that stop being enabled MUST lose their sessions at once, and a change to the list MUST move every live session to a new epoch. `personal-config user add|revoke|enable|rotate` MUST report `restart_required: false`.

#### Scenario: an account is revoked with the command line while the server runs

- **WHEN** an operator runs `personal-config user revoke` for an account that has an open session and the key it signed in with
- **THEN** the session's next request is 401, signing in with that key is 401, and no restart was needed

#### Scenario: accounts are added, enabled and rotated while the server runs

- **WHEN** an operator adds an account, revokes and enables it, and then rotates its key
- **THEN** each change applies to the next request: the new account signs in, the enabled account's old key works again, and after the rotation only the new key signs in and the open session is 401

#### Scenario: the file is damaged

- **WHEN** the configuration file is replaced by invalid JSON, or by a file whose `users` is not a list
- **THEN** the accounts in memory are unchanged, and once the file is valid again the next request takes the list from it

### Requirement: A revocation made through the server is never undone by a later write or reload

A revocation made through the server MUST take effect in memory at once, and MUST be remembered as pending until the configuration file holds it or the account is gone from the file. While it is pending, every write of the account list MUST include it and every list taken from the file MUST have it applied, so no write, reload or creation of another account brings the account back. Once the file holds the revocation, the file MUST decide again, so that `personal-config user enable` restores the account.

#### Scenario: the revocation could not be saved

- **WHEN** a revocation fails with 503 because the configuration directory is read-only, and an administrator later creates another account successfully
- **THEN** the revoked account's key is still refused, and the file written by the creation records the account as disabled

#### Scenario: another writer replaces the file

- **WHEN** a revocation is pending and another process rewrites the file with the account still enabled
- **THEN** the next sign-in with the account's key is refused and the account is listed as disabled

### Requirement: Account routes are matched exactly

`/admin/personal-users` MUST accept GET (list) and POST (create) and answer any other method with 405. `/admin/personal-users/{username}/revoke` MUST accept POST only, MUST NOT read the request body, and MUST answer any other method with 405. Any other path under `/admin/personal-users/` MUST answer 404 `not_found`. All of them MUST require a personal administrator before the route is looked at.

#### Scenario: revoke with no body, an empty object or an account-shaped body

- **WHEN** an administrator posts to the revoke route of an existing account with no body, with `{}`, or with a body shaped like a new account
- **THEN** the account is revoked, the response is 200, and no account is created

#### Scenario: a revoke route for an account that does not exist

- **WHEN** an administrator posts an account-shaped body to the revoke route of a username that does not exist
- **THEN** the response is 404 `user_not_found` and no account and no key digest is created

### Requirement: A personal session ends 30 idle minutes after its last request

A personal session MUST end when 30 minutes have passed since its last request, not 30 minutes after sign-in. The session store MUST record the last request time with `touch(id, now)`, writing at most once per minute per session and reporting whether it wrote; the 12-hour absolute expiry MUST NOT change.

#### Scenario: a session in use

- **WHEN** a session signs in and is used at 20, 35 and 55 minutes, and then not used for 31 minutes
- **THEN** the requests at 20, 35 and 55 minutes are 200 and the next one is 401

#### Scenario: requests within one minute

- **WHEN** a session is used twice within a minute
- **THEN** its stored last-seen time is written once

### Requirement: Refused sign-ins are counted by client address and by account, and only refused ones

The sign-in limit MUST count the sign-ins whose credentials were checked and refused, in four buckets over 15 minutes: 5 per known account and client address, 20 per client address whatever the name, 50 per known account across addresses, and 500 for the whole server. A sign-in that names no account MUST count only against its client address and the server bucket. Every bucket MUST be asked before any credential work and before the busy flag is taken, and a full bucket MUST be answered 429 `login_rate_limited`. A successful sign-in, and a failure on the server's side such as an unreadable credential file, MUST NOT count. A sign-in that arrives while another is being checked MUST be answered 429 `login_busy`, which is not a failure and is not counted; the sign-in page MUST describe `login_busy` and `login_rate_limited` differently. Each of the limiter's tables MUST hold at most 10,000 keys however many addresses a flood comes from.

#### Scenario: many successful sign-ins

- **WHEN** the same account signs in successfully seven times in a row
- **THEN** every sign-in is 200, and five refusals from one address are then needed before the next attempt from it is 429 `login_rate_limited`

#### Scenario: two sign-ins at once

- **WHEN** two sign-ins arrive together
- **THEN** one is 200 and the other is 429 `login_busy`, and the next sign-in is not limited

#### Scenario: unknown names from one address do not lock the administrator out

- **WHEN** twenty sign-ins from one address name accounts that do not exist
- **THEN** the twenty-first from that address is 429 `login_rate_limited`, the administrator's correct key from another address is 200, and five unknown names from one address are only five refusals

#### Scenario: guesses at one account from one address

- **WHEN** five wrong keys for one account arrive from one address
- **THEN** that account from that address is 429, while the same account from another address, and other accounts from that address, sign in

#### Scenario: many addresses

- **WHEN** fifty wrong keys for one account arrive from fifty addresses, or five hundred refused sign-ins arrive from five hundred addresses
- **THEN** the next attempt for that account, or for anyone, is 429 `login_rate_limited`, and an account that was not guessed at is not limited by the first case

#### Scenario: limits come before the password work

- **WHEN** a bucket is full while the busy flag is set, and a sign-in arrives
- **THEN** it is answered `login_rate_limited` and not `login_busy`, and no password check ran for it

### Requirement: The client address of a sign-in comes from the connection, and a forwarding header only when the connection is from this machine

`server/index.ts` MUST hand the connection's peer address to the request handler. The server MUST take the client address from the last entry of `X-Forwarded-For` only when the peer is a loopback address (127.0.0.0/8, `::1`, or an IPv4-mapped form) and that entry is a valid IP address; in every other case, including an absent or malformed header, it MUST use the peer address. A handler called without a peer MUST count every sign-in as coming from `unknown`.

#### Scenario: behind the proxy on this machine

- **WHEN** the peer is `127.0.0.1` and `X-Forwarded-For` is `203.0.113.5, 198.51.100.7`
- **THEN** the sign-in is counted against `198.51.100.7`

#### Scenario: a header from another machine

- **WHEN** the peer is `203.0.113.9` and each request carries a different `X-Forwarded-For`
- **THEN** every request is counted against `203.0.113.9`, and the twenty-first refused one is 429

#### Scenario: a header that is not an address

- **WHEN** the peer is loopback and the header is `not-an-address`, `198.51.100.7:4433` or empty
- **THEN** the peer address is used

### Requirement: Input the caller got wrong is a 400 and not a 503

A path parameter with an invalid percent escape MUST be answered 400 `invalid_request`. A request body that must be a JSON object MUST be answered 400 with the route's own error code when it is `null`, an array or a scalar. Two simultaneous creations of one username MUST end with one account and one 409 `user_exists`. None of these MAY be answered 5xx, because a release read-back rolls back on any 5xx answer.

#### Scenario: a malformed escape

- **WHEN** a signed-in caller requests `/projects/%E0%A4%A`, `/tasks/%ZZ`, `/organizations/%ZZ/members` or `/auctra/collection/records/%ZZ`
- **THEN** the answer is 400 `invalid_request`

#### Scenario: a body of `null`

- **WHEN** a caller posts `null` to a content read, an attachment content read or `/auctra/collection/sync`
- **THEN** the answer is 400 and nothing is read or synced

### Requirement: Accounts are not created through actions

The action catalog MUST list `admin.user.create` as `unavailable`, with a reason in Chinese that names `personal-config user … add --key-file`. A preview or a confirm of an action the catalog marks unavailable MUST be refused with 422 `action_unavailable`, before any account or key file is made. `admin.user.revoke` MUST stay available.

#### Scenario: an administrator previews account creation

- **WHEN** a personal administrator previews `admin.user.create`
- **THEN** the answer is 422 `action_unavailable`, no account exists afterwards, and no key digest file was written

### Requirement: A new session starts above earlier ones and a stale page reloads its session

A new session's epoch MUST be the larger of the current time in milliseconds and the highest stored epoch plus one. When the server refuses a request with 403 `csrf_denied`, the page MUST read `/session` again and tell the reader that the sign-in changed elsewhere, and MUST NOT report the refusal as missing permission.

#### Scenario: a second sign-in

- **WHEN** a second session is created in the same millisecond as the first, or after a bump of every session's epoch
- **THEN** its epoch is higher than every earlier session's

#### Scenario: another tab signed in as someone else

- **WHEN** a tab sends a write with the CSRF token of a session that is no longer the cookie's
- **THEN** the server answers 403 `csrf_denied`, the page reads `/session`, and shows the identity now signed in

### Requirement: A failed sign-out is reported and leaves the page signed in

The page MUST end its local session only after the server confirmed the sign-out, or answered 401 because the session was already gone. When the request fails, the page MUST stay signed in, say that the sign-out did not succeed and the session is still valid, and offer to try again.

#### Scenario: the server cannot be reached

- **WHEN** the sign-out request fails with a network error or a 5xx answer
- **THEN** the page keeps its session, shows a message with a retry button, and a retry that succeeds signs the page out

### Requirement: Usage rows belong to the scope whose run made them

`GET /usage` MUST return the usage rows of the runs created in the requested scope, found through the run with the same owner and source reference, and MUST NOT filter by the scope's own `project` label or list the rows of another scope, whatever the scopes are called.

#### Scenario: a personal-config scope

- **WHEN** a scope whose `project` is `personal` created a run against an owner project named `project-1`
- **THEN** `/usage` for that scope lists the run's usage row

#### Scenario: two scopes that label themselves alike

- **WHEN** two scopes with the same `project` label each created a run against different owner projects
- **THEN** each scope lists only the usage row of its own run

### Requirement: A detached task cannot end the process

The provider status monitor MUST NOT reject when the run ledger cannot be read; the run keeps its last stored state. The server process MUST install an `unhandledRejection` handler that logs a short error code, never the message, and keeps running.

#### Scenario: the ledger fails during monitoring

- **WHEN** the run ledger throws while a status monitor is waiting to poll
- **THEN** the monitor ends without an unhandled rejection

#### Scenario: a rejection nobody handled

- **WHEN** a promise is rejected with no handler in a server process
- **THEN** a line with the error code is logged, the message is not, and the process keeps running

### Requirement: Every writer of the configuration file takes one exclusive lock and never writes an older copy

The control center, when it creates or revokes an account, and `personal-config`, for every command that saves the configuration, MUST take the exclusive lock `<config>.lock` (created with `wx`, mode 0600, holding the holder's pid and time) before writing, wait up to about 5 seconds for it, and then give up: the control center with 503 `config_busy`, the command line with a Chinese error and nothing written. A lock whose holder is not running, or that is older than 30 seconds, MUST be broken. Slow work (hashing, key generation) MUST be done before the lock is taken. Under the lock the control center MUST read the file again, apply its change and its pending revocations to the accounts that file holds, and write through a temporary file renamed over the original. `personal-config` MUST record the version of the file (inode, size, modification and change time) before it reads it and MUST, under the lock, write nothing and fail with "配置文件在读取后被改动，请重新运行" when the file is a different version. A command that stops this way MUST remove the key file and key digest it had made.

#### Scenario: a revocation made while the command line works on an older copy

- **WHEN** `personal-config user add` has read the file and is hashing a key, an administrator revokes an account on the web and the revocation is stored, and the command then tries to save
- **THEN** the command writes nothing and fails, the revoked account is still disabled in the file, its key is still refused, and running the command again adds the new account

#### Scenario: the control center writes after a command-line revocation it has not noticed

- **WHEN** `personal-config user revoke` has changed the file and the control center, before any request noticed it, creates another account
- **THEN** the file written holds the revocation and the new account, and the revoked key is refused

#### Scenario: the lock stays held

- **WHEN** another process holds the lock for longer than the wait while an administrator revokes an account on the web
- **THEN** the answer is 503 `config_busy`, the account is revoked in memory at once, the file is unchanged, and the next successful write stores the revocation; creating an account in the same situation leaves no account and no key digest

#### Scenario: a crashed holder

- **WHEN** the lock file names a process that no longer runs, or is older than 30 seconds
- **THEN** the next writer breaks it and writes

### Requirement: One account cannot fill the session table or the sign-in path for everyone

The server MUST remove personal sessions that have been idle for 30 minutes before it checks the table's limit and on every request, MUST keep at most 8 sessions per account by ending the account's oldest when it signs in again, and MUST answer an account's 21st successful sign-in within 15 minutes with 429 `login_rate_limited` before any credential work and before the busy flag is taken, for that account only. Only successful sign-ins MUST fill an account's budget, and attempts naming a name that is not an account MUST NOT create an entry.

#### Scenario: one viewer signs in over and over

- **WHEN** a viewer signs in 25 times
- **THEN** the first 20 succeed, the rest are 429 `login_rate_limited`, the viewer holds 8 sessions, and the administrator signs in as usual

#### Scenario: forgotten sessions

- **WHEN** the table holds 100 personal sessions that have been idle for more than 30 minutes and an administrator signs in
- **THEN** the sign-in succeeds, and the idle sessions are gone

#### Scenario: guesses at an account

- **WHEN** someone who does not hold an account's key tries it several times
- **THEN** the account's sessions are kept, its budget is not used, and its next sign-in with the key succeeds

### Requirement: A sign-in that names no account is checked like a wrong key

When the name given is neither an enabled account nor the configuration's legacy owner, the server MUST check the secret against a decoy scrypt digest made once at startup, count the attempt as refused only against its client address and the server bucket (never against an account), and answer 401 `invalid_credentials`. It MUST NOT answer 503 because the legacy owner's digest file cannot be read.

#### Scenario: unknown names with the legacy digest missing

- **WHEN** twenty-one sign-ins from one address name accounts that do not exist while the legacy owner's digest file is missing
- **THEN** the first twenty are 401, the twenty-first is 429, none is 503, and a real name with a wrong key gets the same 401 body

### Requirement: A failed reload of the account list is logged once, and the command line writes only as the file's owner

When the configuration file cannot be read, is not JSON, has no `personal` block, or its `users` is not a list, the server MUST keep the accounts it has and MUST log `[control-center] account list reload failed: <code>` once per version of the file, never the path or the content. An explicit `users: null` MUST be read as an empty list. A `personal-config` command that writes MUST refuse, with a Chinese error and nothing written, when the effective user is not the owner of the configuration file, and MUST write the file with mode 0600.

#### Scenario: an unreadable or broken file

- **WHEN** the file is replaced by invalid JSON, or by a file the server cannot read, and several requests follow
- **THEN** the accounts in memory are unchanged and one line with the code (`invalid_json`, `EACCES`) is logged for that version

#### Scenario: root rewrites the file

- **WHEN** a command runs as a user who does not own the configuration file
- **THEN** it fails before writing anything

### Requirement: One rule decides whether an account is enabled

An account entry MUST count as enabled only when its `enabled` is `true` or absent; `false` and every other value (`"false"`, `0`, `null`) MUST mean disabled. When a username appears in more than one entry, every entry of that name MUST be disabled and the server MUST log that once per version of the file, without the name. The same rule MUST be used for sign-in, for the permissions of a signed-in session, for the members a shared project can offer, for the administrator check of the credential panel, for the recipients of background reminders and for what `personal-config user list` and `enable` report. A pending revocation MUST stay pending while any entry of its name is still enabled in the file.

#### Scenario: a hand-edited flag

- **WHEN** an account's `enabled` is edited to `"false"`
- **THEN** the account cannot sign in, is listed as disabled, and is not a reminder recipient or an offered project member

#### Scenario: a repeated name

- **WHEN** two entries share a username
- **THEN** neither can sign in until one is removed

### Requirement: A refused CSRF token is read once and never loops

When a request is refused with 403 `csrf_denied`, the page MUST ignore the refusal if the token that was refused is not the one the page holds now or if it already read the session for this reason less than 10 seconds ago; otherwise it MUST read `/session` once. If the server hands out a different token, the page MUST take the new session and say the sign-in changed elsewhere; if it hands out the token that was just refused, the page MUST NOT reload its data and MUST show that the server refuses its requests.

#### Scenario: a proxy strips the Origin header

- **WHEN** every write is refused with `csrf_denied` whatever the token
- **THEN** the page reads the session once, sees the same token, stops on a message that names the likely cause, and sends no further round of reads and writes

### Requirement: The audit of a refused sign-in names only configured accounts and is not written per refusal

For a refused sign-in the server MUST record the username only when it is exactly the name of a configured account (the legacy owner included) and MUST record `(unknown)` otherwise, so that a key pasted into the name box never reaches the audit. It MUST NOT write a row for a sign-in answered 429 `login_rate_limited` or `login_busy`; it MUST write one row when a bucket fills, naming the bucket in `meta.bucket`, once per bucket per window. A successful sign-in MUST be recorded as before, and a failure that needs no wrong credential (the legacy digest file unreadable) MUST be written at most once a minute per error code.

#### Scenario: names and keys in the name box

- **WHEN** refused sign-ins name a pasted access key, a configured account, the legacy owner, and a configured account in another letter case
- **THEN** the rows name `(unknown)`, the account, the owner and `(unknown)`, and the pasted key appears nowhere in them

#### Scenario: one row when a bucket fills

- **WHEN** an address makes thirty-five refused sign-ins with different unknown names
- **THEN** the audit holds twenty refusals and one row for the address bucket, none for the fifteen turned away, and the same holds for the account-and-address bucket after five guesses at one account

#### Scenario: told to wait, and successes

- **WHEN** five sign-ins arrive while another is being checked, and administrators sign in
- **THEN** the five leave no row, and the successful sign-ins are written as before

### Requirement: The deployment guide says what the holder of an account's key can do to that account's sign-in

`docs/lan-deployment.md` MUST state that anyone who holds an account's key can end that account's sessions (the cap of 8 per account) and use up its budget of 20 sign-ins in 15 minutes, which keeps the account's real user from signing in for 15 minutes; that while an account is at its budget a wrong key is answered 429 and the name of no account 401, so account names are not secrets; and that an account should be given to one person, and a key that several people share rotated.

#### Scenario: an operator plans accounts

- **WHEN** an operator reads the sign-in limits section of the guide
- **THEN** it says one account per person and rotate a shared key, and says why

### Requirement: A limited credential is shown on the Services credentials panel and is reminded of nowhere

Only the credential states `unreadable`, `rejected`, `expired` and `expiring` MUST raise a background reminder (category `credential`) and a `credential_renewal` work queue item. The state `limited` (the credential works, some reads are refused) MUST appear on the Services credentials panel only. The observation loop MUST end, at its next cycle, every open reminder whose key is a `limited` key, whatever the person had done with it, and MUST NOT hold a `limited` key as unknown when it has no reading of a slot. The work queue MUST NOT remove or add any other item because of a limited credential.

#### Scenario: a credential that is accepted but cannot read everything

- **WHEN** a tool accepts the token but refuses one of the reads it needs it for, and the observation loop runs
- **THEN** the Services panel row is `limited`, no reminder is opened, and the work queue holds no `credential_renewal` item for it

#### Scenario: a reminder that an earlier version opened

- **WHEN** an open `limited` reminder exists, acknowledged or not, and a cycle runs
- **THEN** it is marked recovered, no longer counts as unread, is not opened again by later cycles, and the credential is still `limited` on the panel

#### Scenario: a slot with no reading

- **WHEN** the keys a cycle holds as unknown are worked out for a slot that was never read
- **THEN** they are the keys of `rejected` and `unreadable` only

### Requirement: Hovering a button in a notice never takes its label below 4.5:1

A button inside a notice (`NoticeAction`) MUST show hover by lifting its background toward the panel colour, not by tinting it with its own text colour, so that its label keeps a contrast ratio of at least 4.5:1 against the notice's background in every tone, in both themes, hovered or not. The accessibility scan of the degraded notice MUST scan a button of the open notice with the pointer on it.

#### Scenario: the pointer is where the toggle was

- **WHEN** the notice stack is unfolded with a click on its toggle and the pointer is now over a button of the first notice, on a 390 px wide window
- **THEN** the button's label has at least 4.5:1 against its hovered background, and the scan reports nothing

