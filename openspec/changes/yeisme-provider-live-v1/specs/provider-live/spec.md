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

#### Scenario: Cost without a currency
- **WHEN** a Provider receipt reports a cost but no currency
- **THEN** the usage projection marks the cost `unknown` and does not record it as yuan or dollars

### Requirement: Budget caps stay in the owner's currency
Live provider runs SHALL carry their budget cap in USD, the currency the owners cap a run in, and SHALL hand it to the owner unconverted. No exchange rate is assumed anywhere in the run path.

#### Scenario: Cap in another currency
- **WHEN** a live run request carries a cap in CNY or any currency other than USD
- **THEN** the Control Center refuses it with `provider_budget_currency_mismatch` before any owner call and reserves nothing

#### Scenario: Owner without a cost cap parameter
- **WHEN** an owner's submit action accepts no cost cap
- **THEN** the Control Center reservation alone does not count as an owner-enforced cap, and that modality's canary is not admitted until the owner accepts one

#### Scenario: Owner that ignores undeclared arguments
- **WHEN** Eikona's discovered `generate` action does not declare `max_cost_usd`
- **THEN** the image capability is `needs_contract` with blocker `owner_cost_cap_undeclared` and does not support live submit
- **AND** a live run request ends `failed` with `provider_cost_cap_unsupported` before any submit call, releasing its reservation

#### Scenario: Owner contract unreadable at submit
- **WHEN** the Control Center re-reads Eikona's runtime capabilities right before a live submit and cannot read them
- **THEN** the run ends `failed` with `provider_cost_cap_unverified` before any submit call, releasing its reservation

#### Scenario: Owner refuses the run for cost
- **WHEN** Eikona refuses a submit with `COST_LIMIT_EXCEEDED` or `UNKNOWN_COST_REJECTED`
- **THEN** the run ends `failed` with that code and its reservation is released, because the refusal happens before any provider call

### Requirement: Per-modality canary admission
Image, video and audio canaries SHALL be admitted and evidenced separately: channel and model, authorization, an owner-enforced USD cap, the original idempotency key, a downloaded result that decodes or plays, and an actual cost with its currency.

#### Scenario: Video without a known quote
- **WHEN** Scaena has not published the fixed video plan and known-cost quote contract
- **THEN** the video canary is not admitted and stays pending whatever the image and audio results are
