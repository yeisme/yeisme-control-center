# 会话稳定性

## ADDED Requirements

### Requirement: Explicit remembered-device sessions remain bounded

服务端 SHALL accept an optional boolean `remember` on personal login. When true, it SHALL issue only an opaque HttpOnly session cookie, keep the session in the server-side SQLite session store, enforce a maximum absolute lifetime of 30 days and an idle lifetime of 7 days, and continue enforcing revocation, credential-version, epoch, per-account session-count and login-rate limits.

#### Scenario: Remembered login does not persist credentials

- **WHEN** a user submits valid personal credentials with `remember: true`
- **THEN** the response sets an HttpOnly session cookie, the session is marked remembered in the server store, and neither the password nor access key is returned to or stored by the browser

#### Scenario: Remembered session expires after idle period

- **WHEN** a remembered session receives no request for seven days
- **THEN** the next authenticated request returns `login_required` and the session is removed

### Requirement: Visible pages keep active sessions alive

The frontend SHALL issue a single in-flight `/session` heartbeat at most every five minutes while an authenticated page is visible, and SHALL issue one after focus or visibility restoration. It SHALL not continuously wake a hidden page.

#### Scenario: Heartbeat touches a visible session

- **WHEN** an authenticated visible page reaches its heartbeat interval
- **THEN** it reads `/session` and the server can update `last_seen` without reloading owner data or changing the selected scope

#### Scenario: Network failure does not log the user out

- **WHEN** a heartbeat encounters a transient unavailable/network error
- **THEN** the frontend keeps the current session and read model, retries at the next interval, and only enters login-required state when the server explicitly returns `login_required`

### Requirement: Session-scoped caches do not cross identity boundaries

The frontend SHALL key owner/read-model caches by the selected scope and session epoch, and SHALL clear media and observation caches on logout, scope change, epoch change, or replacement of the current session.

#### Scenario: Permission epoch invalidates old reads

- **WHEN** the server returns a newer session epoch
- **THEN** the frontend discards the old scoped cache and reloads under the newer session without showing old authorized content as current
