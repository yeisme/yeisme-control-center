# Auctra collection consumer

## ADDED Requirements

### Requirement: Control Center SHALL keep Auctra separate from media owners

The Control Center SHALL bind Auctra through a dedicated collection scope and SHALL NOT treat Auctra as a media request, Provider task, or usage owner.

#### Scenario: collection service directory

- **WHEN** the current scope includes an Auctra collection binding
- **THEN** the service directory reports `collection_projection` and does not add Auctra to media request owners

### Requirement: Browser clients SHALL not hold Auctra credentials

The browser SHALL call only same-origin Control Center endpoints. Auctra origin, bearer, credential ref, local path, and raw provider payload MUST remain server-side.

#### Scenario: collection sync

- **WHEN** a user explicitly starts a collection sync
- **THEN** the browser receives only refs, statuses, digests and timestamps through the same-origin Control Center API

### Requirement: Unknown owner state SHALL remain visible

When Auctra is unavailable, forbidden, stale, or missing an event contract, the Control Center MUST render the typed state and MUST NOT infer success from fixtures, counts, or an old snapshot.

#### Scenario: missing collection contract

- **WHEN** Auctra has no published collection contract
- **THEN** the service detail shows `needs_contract` and preserves the previous index without claiming freshness
