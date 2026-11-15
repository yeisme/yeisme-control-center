# Prompt recipes

## ADDED Requirements

### Requirement: refs-only recipe collection
The control center SHALL persist recipe metadata, provenance references, owner version and digest without persisting owner prompt bodies.

#### Scenario: collect an audited owner prompt
- **WHEN** an authorized user confirms `prompts.recipe.create` with an owner prompt ref, version and digest
- **THEN** the control center stores a local recipe and immutable revision containing only metadata and references
- **AND** the action receipt contains only the recipe ref and summary fields

### Requirement: scope-bound recipe browsing
The control center SHALL bind recipe reads and writes to the active identity, epoch and owner/project scope.

#### Scenario: foreign project is submitted
- **WHEN** a recipe create or revise action names an owner project not bound to the active scope
- **THEN** preview and confirm fail closed with `scope_mismatch`
- **AND** no recipe row is written

### Requirement: safe recipe reuse preview
The control center SHALL re-authorize and re-read the owner prompt before filling a draft, without submitting a Provider operation.

#### Scenario: current readable source
- **WHEN** a user requests use-preview with the current recipe revision and matching owner/project
- **THEN** the service verifies the owner version, source ref and content state, audits the owner read, and returns a draft preview
- **AND** the UI leaves the draft unsaved until the user separately previews and confirms a prompt save

#### Scenario: missing owner contract
- **WHEN** a recipe source is Scaena or its owner content state is `needs_contract`
- **THEN** use-preview returns `availability=needs_contract` with a stable blocker
- **AND** it does not fabricate body text, quote, Provider run or fallback owner

### Requirement: immutable revision and replay
The control center SHALL use conditional revision updates and idempotent local action receipts for revise and archive.

#### Scenario: stale revision
- **WHEN** a revise or archive action uses an older expected revision
- **THEN** it returns a conflict and leaves the current row and revision history unchanged

#### Scenario: repeated archive confirmation
- **WHEN** the same archive confirmation is replayed with the original preview digest and idempotency key
- **THEN** it returns the original receipt and does not create a second terminal mutation
