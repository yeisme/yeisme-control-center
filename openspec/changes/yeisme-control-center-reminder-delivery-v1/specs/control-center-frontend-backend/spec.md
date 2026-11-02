# Control Center Frontend Backend Specification

## ADDED Requirements

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
