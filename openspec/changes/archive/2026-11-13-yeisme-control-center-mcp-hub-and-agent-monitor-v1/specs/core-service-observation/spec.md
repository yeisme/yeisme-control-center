## ADDED Requirements

### Requirement: Typed Agent actor and gateway origin lineage in task observation
When an owner task or request snapshot provides a validated `actor_type: "agent"` or `origin_refs.gateway_call_ref`, the control center SHALL preserve those typed fields in task details, the `agents` monitor, and the `activity` timeline without inferring agent identity from free-text actor names.

#### Scenario: Owner reports typed agent initiator
- **WHEN** a task snapshot carries `actor_type: "agent"` and `actor: "coding-agent"`
- **THEN** the activity timeline renders `发起：Agent · coding-agent` with `data-actor="agent"`
