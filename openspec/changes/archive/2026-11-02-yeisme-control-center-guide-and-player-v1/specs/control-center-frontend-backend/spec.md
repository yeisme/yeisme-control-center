# Control Center Frontend Backend Specification

## ADDED Requirements

### Requirement: CLI and MCP guide replaces the creation workbench

The system MUST present a 使用指南 page in place of the AI 创作 workbench that teaches installing, checking and connecting the owner CLIs and MCP servers, MUST show only commands documented by each owner, and MUST NOT offer any generation submit from the guide.

#### Scenario: old creation links land on the guide

- Given a user in a personal scope opens `/creation?owner=sonora`
- When the page resolves
- Then the client lands on `/guide?tool=sonora`, the sidebar lists 使用指南 and no AI 创作 entry, and shared-project batch generation stays reachable at `/creation` inside a project scope.

#### Scenario: commands follow the chosen tool and client

- Given the guide is open
- When the user picks Sonora and then Codex
- Then the connect step shows `codex mcp add sonora -- sonora mcp serve --stdio`, notes that the published binary lacks the `mcp` command, and keeps internal hosts as `<lan-host>:<port>` placeholders.

### Requirement: audio plays in a global floating player

The system MUST start audio playback directly from any audio result's play control in a floating player with a seekable progress bar, MUST NOT open the Inspector for it, and MUST stop and release playback when the scope, session or epoch changes.

#### Scenario: play from the asset gallery

- Given an authorized audio result in the asset gallery
- When the user clicks its play control
- Then a short-lived preview handle is requested, playback starts in the floating player, the Inspector stays closed and no `preview` query is written.

#### Scenario: a refused or expired transfer recovers

- Given the media proxy refuses the first two transfers
- When playback starts
- Then the player falls back from the in-memory read to a stream, re-grants the handle a bounded number of times and resumes from the last position.
