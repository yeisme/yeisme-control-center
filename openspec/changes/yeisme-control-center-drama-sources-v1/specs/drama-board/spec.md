# Drama Board Specification

## ADDED Requirements

### Requirement: the episode list says exactly why it is incomplete

The system MUST distinguish a server without an Auctra collection target, a scope without an Auctra binding, and a binding without a usable credential, decided from configuration without calling any owner, and MUST report the Scaena breakdown source the same way.

#### Scenario: scope without a binding

- Given a server with an Auctra collection target and a scope with no Auctra binding
- When the client requests `/drama/episodes`
- Then `universe.reason` is `collection_binding_missing`, `can_sync` is false, and `sources` reports Auctra as `binding_missing`.

#### Scenario: bound but no credential

- Given a bound scope whose session has no delegated token and whose server has no Auctra credential file
- When the client requests `/drama/episodes` before any sync
- Then `universe.reason` is `delegation_unavailable` rather than `collection_not_synced`.

### Requirement: a sync reads every page or says it did not

The system MUST keep reading Auctra collection pages until Auctra reports no further page, within a page cap and a time budget, and MUST record a sync that stopped early or failed after storing pages as partial.

#### Scenario: multi-page collection

- Given an Auctra collection larger than one page
- When the operator syncs
- Then every page is stored, the receipt reports `complete: true`, and the episode list includes the newest screenplays.

#### Scenario: stopped early

- Given a sync that reaches the page cap or a failing page after storing some pages
- When the episode list is requested
- Then the universe coverage is `partial` with reason `collection_partial`, and a first page that fails leaves the previous sync record unchanged.

### Requirement: each Auctra operation uses the key Auctra accepts for it

The system MUST send the collector credential to `collection.*` operations and the flow credential to `creative.flow.read`, falling back to the single credential when only one is configured, and MUST NOT send `project_ref` to `creative.flow.read`.

#### Scenario: two keys

- Given `credential_ref` and `flow_credential_ref`
- When the board syncs and then reads an episode
- Then the snapshot carries the collector key and the flow read carries the reader key with only `episode_ref` and `work_ref` as arguments.

### Requirement: episodes stay reachable without a full list

The system MUST let a person open any well-formed episode reference typed into the search, MUST list episodes opened earlier in the same tab for the same identity and scope, and MUST prefer the episodes mentioned by the most recently updated tasks when it cannot list them all.

#### Scenario: open by reference

- Given an unconnected scope
- When the person types `episode:07` into the search
- Then the board offers to open `episode:07`, the inspector opens it, and after returning to the board the episode is listed as recently opened.

#### Scenario: nothing connected is not a failure

- Given a scope where neither Auctra nor the Scaena breakdown source is connected
- When an episode row is read
- Then the row shows a neutral "not connected" state, and an owner that is actually unavailable still shows a read failure.
