# Work Queue Specification

## ADDED Requirements

### Requirement: scope-bound derived queue

The system MUST derive `yeisme.work_queue.v1` from currently authorized task, notification, service and authoring projections. It MUST NOT create a second owner task source.

#### Scenario: scope and epoch

- Given a valid session and scope
- When the client requests `/work-queue`
- Then the response includes the current epoch, scope, coverage and only safe references within that scope.

### Requirement: risk-first ordering

The system MUST order blocked, unknown, unavailable and conflict items before review, contract-gap, handoff and low-freshness items. Equal-priority items MUST use observed time, owner and source reference as stable tie breakers.

#### Scenario: unknown before handoff

- Given an unknown task observed before a handoff-ready task
- When the queue is built
- Then the unknown task appears first.

### Requirement: explicit gaps

The system MUST preserve `needs_contract`, `forbidden`, `unavailable`, `partial` and `stale` states. It MUST NOT infer successful owner access from a configured connection, an empty page or a fixture.

#### Scenario: Muweave direct read missing

- Given a handoff target for Muweave without a published owner read contract
- When the queue item is opened
- Then the item exposes a controlled LaunchContext and displays `needs_contract`.

### Requirement: preview-only actions

The system MUST expose only allowlisted action Preview metadata. Preview MUST NOT Confirm an owner mutation or create a Provider request.

#### Scenario: preview does not execute

- Given an available queue action
- When the user presses Preview
- Then the client receives a normalized preview or blocker and no Confirm request is sent.
