# Drama Board Specification

## ADDED Requirements

### Requirement: episode universe from the owner's own episode test

The system MUST list episodes from the local Auctra collection index using only screenplay text units, and MUST NOT assume that Auctra, Scaena breakdown and Scaena projection episode references are the same namespace.

#### Scenario: non-episode units are excluded

- Given a synced collection containing screenplay units, a character profile, an outline and a review record
- When the client requests `/drama/episodes`
- Then only the screenplay units are returned, in natural order, and archived units are omitted.

#### Scenario: Scaena names the episode differently

- Given an Auctra episode `ep-3` whose Scaena breakdown is stored as `episode:03`
- When the client requests `/drama/episode?episode_ref=ep-3&scaena_episode_ref=episode:03`
- Then the Scaena stage is read for `episode:03`, the Auctra stages for `ep-3`, and nothing is written to any owner.

### Requirement: bounded, identity-scoped owner reads

The system MUST NOT read an owner flow without an episode reference, MUST bound live reads per request, and MUST NOT serve a cached flow across session, epoch, scope or binding.

#### Scenario: read budget

- Given twelve episodes on one page
- When the list is requested without `read=all`
- Then at most eight episodes are read live, the rest are marked `deferred`, and no more than four reads run concurrently.

#### Scenario: no cross-identity cache

- Given a cached flow for one session
- When another session, a newer epoch or another scope requests the same episode
- Then the owners are read again.

### Requirement: honest stage state

The system MUST NOT present an unreadable episode as progressing, MUST show stages nobody has started as not started, and MUST present Auctra's `partial` flow coverage as pipeline progress rather than a data gap.

#### Scenario: total owner outage

- Given both owners are unavailable
- When the board renders the episode
- Then the row reports a read failure and no stage is shown as accepted or finished.

#### Scenario: screenplay awaiting acceptance

- Given Auctra reports the screenplay as blocked with `source_not_accepted`
- When the board and the work queue are built
- Then the board shows it as waiting for acceptance in a neutral tone and the work queue omits it.

### Requirement: structure-only storyboard outline

The system MUST expose only scene headings and shot size, angle, movement and duration for the head breakdown, and MUST NOT expose action summaries, prompts, candidate bodies, media bindings or credentials.

#### Scenario: owner payload carries extra fields

- Given a Scaena projection containing action summaries, media bindings and a raw prompt
- When the client requests the episode detail
- Then none of those values appear anywhere in the response.

### Requirement: refs are not sent to an owner that does not know them

The system MUST NOT query Auctra for an episode reference that a synced collection does not contain, and MUST treat owner-supplied refs and blocker tokens as untrusted text.

#### Scenario: a Scaena-style ref from a task

- Given a synced collection that contains `ep-3` but not `episode:03`
- When the board reads `episode:03`
- Then Auctra is not queried, the Auctra stages report that the collection does not contain the episode, and Scaena is read normally.

#### Scenario: malformed task ref

- Given recent tasks where one episode ref contains a control character
- When the list is requested with that ref among the requested refs
- Then the malformed ref is ignored and the rest of the list is returned.

### Requirement: owner outages are visible in the attention queue

The system MUST NOT hide an owner whose flow read failed, and MUST NOT report full coverage when only the most recently updated episodes were checked.

#### Scenario: Auctra is down

- Given Auctra cannot be read while Scaena has a breakdown
- When the work queue is built
- Then Auctra appears in the queue coverage as unavailable and as one queue item.

#### Scenario: more episodes than the queue checks

- Given nine episodes and a queue that checks the three most recently updated
- When the work queue is built
- Then the Auctra coverage is `partial` with reason `episodes_sampled`.

### Requirement: a breakdown from an older screenplay is not current

The system MUST mark a Scaena breakdown as not current when its source shares Auctra's reference but carries a different digest, and MUST NOT let it consume the production handoff.

#### Scenario: screenplay revised after breakdown

- Given an accepted handoff and an accepted breakdown whose source digest differs from Auctra's current screenplay digest
- When the flow and the work queue are built
- Then the breakdown reports `screenplay_revision_mismatch` and the handoff is still offered.

