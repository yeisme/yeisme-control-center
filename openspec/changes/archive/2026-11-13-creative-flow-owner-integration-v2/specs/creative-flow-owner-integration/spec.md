# Creative flow owner integration

## ADDED Requirements

### Requirement: owner-derived creative flow
Control Center SHALL build `yeisme.creative_flow.v1` only from Auctra `creative.flow.read` and Scaena `storyboard_workspace_projection.v1`.

#### Scenario: owner contract unavailable
- **WHEN** either owner contract is missing, forbidden, unavailable or malformed
- **THEN** source coverage and queue state remain explicit (`needs_contract`, `forbidden` or `unavailable`)
- **AND** the flow is not reported as complete

### Requirement: episode-safe lineage
Control Center SHALL not merge different episodes into one flow.

#### Scenario: project request with multiple episodes
- **WHEN** no episode ref is supplied and more than one episode is observed
- **THEN** the response contains `episode_ref_required` attention and does not guess stage refs

### Requirement: safe launch
LaunchContext SHALL contain only server-generated routes, safe object refs, scope-bound identity and return path.

#### Scenario: tampered launch context
- **WHEN** scope, epoch, origin or route data is changed by the client
- **THEN** the request is rejected and no arbitrary URL or media route is opened
