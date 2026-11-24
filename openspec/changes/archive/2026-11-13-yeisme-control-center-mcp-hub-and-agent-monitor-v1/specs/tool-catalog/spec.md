## ADDED Requirements

### Requirement: Gateway catalog entries link exposure and compact mode footprint
When the scope binds the personal MCP Gateway open tool, `/tool-catalog` entries for `owner: "gateway"` SHALL reflect the gateway's exposed tool metadata and allow navigating from a catalog inspector entry to `#/mcp-gateway?tab=tools` without invoking any tool.

#### Scenario: Inspecting a gateway tool in CapabilityHub
- **WHEN** a user opens the catalog inspector for a `gateway` tool
- **THEN** the inspector displays its backend namespace, read-only schema summary, and a safe link to `#/mcp-gateway?tab=tools`
