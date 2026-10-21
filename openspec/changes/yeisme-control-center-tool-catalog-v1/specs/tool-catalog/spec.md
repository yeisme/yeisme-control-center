# Tool Catalog Specification

## ADDED Requirements

### Requirement: read-only cross-owner catalog

The system MUST project `yeisme.tool_catalog.v1` from owner read-only discovery surfaces only. The system MUST NOT call any catalog entry. Discovery MUST reject any owner `tools/call` outside the documented read-only diagnostics allowlist.

#### Scenario: no mutating owner calls during discovery

- Given configured Eikona, Scaena and Sonora provider connections
- When the client requests `/tool-catalog`
- Then the server issues only initialize, tools/list, resources/read and allowlisted diagnostic calls
- And the response contains no credentials.

### Requirement: owner-declared model status

The system MUST pass through only owner-declared model statuses (`latest_ready`, `latest_unverified`, `unavailable`, `historical`, `drifted`, `unknown_cost`). When an owner does not declare a status, the system MUST report `unknown` and MUST NOT infer `latest_ready`.

#### Scenario: undeclared model

- Given an owner model snapshot row without a status field
- When the catalog is built
- Then that model reports status `unknown` with status source `undeclared`.

### Requirement: honest coverage and freshness

The system MUST report each owner's coverage as `readable`, `partial`, `forbidden`, `needs_contract`, `unavailable` or `not_configured`. On a transient owner failure, the system MUST serve the last successful observation marked `stale` and MUST NOT report it as fresh.

#### Scenario: observer credential cannot read model snapshots

- Given an Eikona credential that may read runtime capabilities but not model snapshots
- When the catalog is built
- Then Eikona coverage is `partial` with a model-snapshot reason and no Eikona models are listed.

### Requirement: baseline-first change ledger

The system MUST record catalog entry changes by digest per scope, owner and kind. The first complete read of a kind MUST be a baseline that reports no additions. Removals MUST be recorded only from complete reads.

#### Scenario: owner adds a model

- Given a baseline catalog
- When a later complete read contains a new model
- Then `changes` includes that model as `added`.

### Requirement: derived creative contract

The system MUST derive AI creation input modes from discovered owner capabilities: enabled Scaena bindings, and Eikona or Sonora actions that are not unavailable or blocked. The system MUST NOT read undeclared owner resources for this purpose.

#### Scenario: disabled binding

- Given a Scaena binding that is disabled
- When the capability projection is built
- Then that binding's mode is not offered as an input mode.
