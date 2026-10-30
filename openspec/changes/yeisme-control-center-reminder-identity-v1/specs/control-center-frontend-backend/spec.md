# Control Center Frontend Backend Specification

## ADDED Requirements

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
