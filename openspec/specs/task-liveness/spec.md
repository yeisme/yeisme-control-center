# task-liveness Specification

## Purpose
TBD - created by archiving change control-center-task-liveness-notifications-v1. Update Purpose after archive.
## Requirements
### Requirement: local freshness projection
The control center SHALL expose a local freshness projection for active owner tasks without changing the owner task state.

#### Scenario: stale owner update
- **WHEN** a queued or running task has no valid owner update for at least 15 minutes
- **THEN** the control center labels it `stale`
- **AND** the owner `state`, revision, operation identity and cancellation contract remain unchanged

#### Scenario: expired owner update
- **WHEN** an active task has no valid owner update for at least 2 hours
- **THEN** the control center labels it `expired`
- **AND** it offers reread and only owner-authorized safe cancellation
- **AND** it does not retry, delete or auto-cancel the task

### Requirement: task notification deep link
The control center SHALL preserve a signed task key in task notifications and open the original task detail from the notification surface.

#### Scenario: task is outside the first page
- **WHEN** a user clicks a task notification whose task is not in the current observed batch
- **THEN** the app reads the original task by its signed task key and opens the Inspector
- **AND** a failed read leaves a retryable deep-link notice

### Requirement: prompt history coverage state
The prompt library SHALL distinguish incomplete history indexing from an owner contract that is not configured.

#### Scenario: incomplete history
- **WHEN** an owner returns `index_more=true`
- **THEN** the page labels that owner history as incomplete and offers a bounded owner-specific retry

#### Scenario: missing owner contract
- **WHEN** an owner returns `source_not_configured` or a missing contract
- **THEN** the page labels it `needs_contract` and does not repeatedly invoke history indexing

### Requirement: guide origin injection
The public guide SHALL allow a user to inject the control center origin through `YEISME_CONTROL_ORIGIN`.

#### Scenario: shell command examples
- **WHEN** a user exports `YEISME_CONTROL_ORIGIN` in the current shell
- **THEN** every control center curl example uses that variable for the URL and Origin header
- **AND** the guide source contains no real deployment address, credential or token

