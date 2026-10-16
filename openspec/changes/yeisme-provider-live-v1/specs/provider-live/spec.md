## ADDED Requirements

### Requirement: Scoped provider capability projection
The control center SHALL expose configured Provider capabilities with transport, modality, model reference, readiness state, and live-submit support without exposing credentials.

#### Scenario: Provider is configured
- **WHEN** an authenticated user reads capabilities for an authorized scope
- **THEN** the response contains the owner, modality, model reference, observed time, and configured state

#### Scenario: Provider contract is unavailable
- **WHEN** the MCP transport does not expose the explicit execute contract
- **THEN** the capability is marked `needs_contract` and `supports_live_submit` is false

### Requirement: Idempotent live provider run
The control center SHALL submit at most one Provider operation for an idempotency key and SHALL return a stable `run_ref`, `trace_ref`, and source reference when the owner accepts the request.

#### Scenario: Duplicate submission
- **WHEN** the same scope submits the same idempotency key again
- **THEN** the original run projection is returned and no second Provider submission is made

#### Scenario: Scope mismatch
- **WHEN** a request uses a project outside the current scope
- **THEN** the request is rejected with `scope_mismatch` before any Provider call

### Requirement: Unknown result recovery
The control center SHALL preserve unknown Provider outcomes and reconcile the original source reference without creating a new attempt.

#### Scenario: Polling timeout
- **WHEN** status polling reaches its bounded timeout without a terminal owner state
- **THEN** the run becomes `unknown`, retains its source reference, and does not resubmit

#### Scenario: Reconcile original operation
- **WHEN** a user requests reconcile for an unknown run with a source reference
- **THEN** the server queries that source reference and updates the same run projection

### Requirement: Owner receipt usage accounting
The usage view SHALL deduplicate by owner and source reference and SHALL keep estimated, confirmed, and unknown costs separate.

#### Scenario: Confirmed owner receipt
- **WHEN** a Provider receipt includes an upstream cost
- **THEN** the usage projection records that amount and marks it `confirmed`

#### Scenario: Missing owner cost
- **WHEN** a Provider receipt omits cost information
- **THEN** the usage projection marks cost `unknown` and does not insert zero
