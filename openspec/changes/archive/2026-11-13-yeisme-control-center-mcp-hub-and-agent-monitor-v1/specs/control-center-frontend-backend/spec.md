## ADDED Requirements

### Requirement: Gateway management credential slot isolation
When `open_tools.gateway.management_credential_ref` is configured on an enabled gateway open tool for a bound scope, `credentialStatuses` SHALL expose a dedicated `open_tool:gateway:management` slot for personal administrators, evaluated independently from the read-only `open_tool:gateway` slot and never exposing file paths or secret contents.

#### Scenario: Read-only token valid while management token expires
- **WHEN** `open_tools.gateway.credential_ref` is valid and accepted, while `management_credential_ref` is within 7 days of `management_credential_expires_at`
- **THEN** `open_tool:gateway` reports `ok` and `open_tool:gateway:management` reports `expiring` with stage `7d`
