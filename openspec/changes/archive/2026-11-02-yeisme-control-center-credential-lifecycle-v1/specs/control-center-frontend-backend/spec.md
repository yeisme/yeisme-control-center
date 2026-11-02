# Control Center Frontend Backend Specification

## ADDED Requirements

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
