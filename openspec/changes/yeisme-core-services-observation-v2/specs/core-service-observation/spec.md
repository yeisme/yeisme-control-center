## ADDED Requirements
### Requirement: Scoped connection observation
The control center SHALL distinguish configured connections, protocol reachability, task authorization, contract support and content capability.

#### Scenario: Partial source failure
- **WHEN** one owner fails or lacks a capability
- **THEN** other authorized owners remain visible and missing facts are not replaced with demo data

#### Scenario: Authorization is revoked
- **WHEN** an owner denies a read in either task lane
- **THEN** its task rows and successful capability projection are cleared without repeated upstream reads

### Requirement: Original-task investigation
The workspace SHALL link a service instance and project to its original tasks and existing results.

#### Scenario: Return from a task detail
- **WHEN** the user closes a detail or returns through the service/overview navigation
- **THEN** task filters and history mode are restored within the current session

#### Scenario: Historical failures remain visible
- **WHEN** a task has left the active list with a failed or review-pending state
- **THEN** its authorized history snapshot remains eligible for overview attention

### Requirement: Bounded task event coverage
The workspace SHALL distinguish recorded events from families that have no reconstructable history.

#### Scenario: Recorded run events
- **WHEN** a Scaena run has persisted project events for that exact run
- **THEN** the timeline shows only sanitized ordered events and continues from the returned cursor

#### Scenario: Current workflow state
- **WHEN** a Sonora workflow-run has a persisted state but no full event journal
- **THEN** the timeline shows one current-state event and marks a historical gap when the prior cursor no longer matches

#### Scenario: Unsupported family
- **WHEN** the owner reports `gap=true` and `state=not_recorded`
- **THEN** the workspace keeps the task snapshot and does not infer missing progress


