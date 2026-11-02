# Control Center Frontend Backend Specification

## ADDED Requirements

### Requirement: Anatomia is observed like other task owners

The control center MUST accept `anatomia` task connections that read Anatomia's `anatomia.execute` observation contract with a project-bound observer key, and MUST show its shot breakdowns (`decompose`) as 拉片分析 and its video questions (`understand`) as 视频问答. It MUST accept Anatomia frames only through an `anatomia.task_artifact_grant.v1` grant whose address is on the connection's own origin, is exactly `/api/v1/control-center/artifact-grants/<32 hex>`, carries no query or fragment and expires within 125 seconds, and MUST fetch it with the connection's own credential. It MUST refuse to cancel Anatomia tasks.

#### Scenario: a finished breakdown with frames

- Given an Anatomia connection with content allowed and a finished breakdown with three frames
- When the reader opens the breakdown and previews its second frame
- Then the frame streams through a same-origin media handle, and no Anatomia address or key reaches the browser.

#### Scenario: a grant that carries a query

- Given Anatomia answers an artifact request with a grant address that has a query string
- When the reader previews the frame
- Then the request is refused as `media_address_denied` and nothing is fetched from that address.

#### Scenario: cancelling a running breakdown

- Given a running breakdown on a connection whose local cancel preference is on
- When an administrator asks to cancel it
- Then the control center answers `cancel_not_supported` without calling Anatomia.
