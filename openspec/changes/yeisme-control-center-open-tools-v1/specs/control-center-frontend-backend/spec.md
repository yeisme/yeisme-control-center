# Control Center Frontend Backend Specification

## ADDED Requirements

### Requirement: Open tools are read through a fixed, read-only projection

The control center MUST read DriveBridge and the personal MCP Gateway only through fixed GET routes, with a 0600 bearer credential named in its own configuration, a 5 second timeout per call, redirects refused and responses over 1 MiB dropped. It MUST NOT call tools, write, cancel or follow addresses supplied by the tool. Each reading MUST be projected to `yeisme.open_tool_projection.v1`, which keeps states, counts, sizes, times and codes and drops file paths, file names, digests, public or backend addresses, owner error text, environment variable names and process details. Open tools MUST be visible only to personal sessions whose scope lists them.

#### Scenario: a DriveBridge run fails with an owner message

- Given DriveBridge reports a failed download whose `error` is a sentence naming a file path
- When the services page reads DriveBridge
- Then the run shows as 下载 · 失败 with no error code, and neither the sentence nor the path appears in any response to the browser.

#### Scenario: the credential is refused

- Given every DriveBridge route answers 401
- When the services page reads DriveBridge
- Then DriveBridge shows 无读取权限 with the reason that the credential was not accepted, and the work queue has one 来源受阻 item for it.

### Requirement: Open tool readings are cached and kept truthful while a tool is down

A reading MUST be cached per tool for 60 seconds and shared between concurrent requests, and a forced refresh MUST be honoured at most every 15 seconds. When a tool stops answering after a good reading, the projection MUST keep the last good runs, backends and usage, marked stale, while stating that the tool is unavailable now; refusals (forbidden, missing routes) MUST NOT fall back to old data.

#### Scenario: DriveBridge stops answering

- Given a good DriveBridge reading a minute ago
- When the next forced reading cannot reach DriveBridge
- Then the card shows 来源不可用 with the earlier runs and says which time they are from.

### Requirement: The workbench raises open tool failures

The work queue MUST add an `operation_failure` item for each open tool run that failed or ended unknown in the last 7 days (at most 10 per tool), a `service_blocked` item when a tool cannot be read or a Gateway backend it reports enabled is down, and a `contract_gap` item when a route the projection relies on is missing. Run states the adapter does not recognise MUST be shown as unknown but MUST NOT be raised. The workbench 服务状态 panel and the 来源覆盖 bar MUST list configured open tools with their state.

#### Scenario: an unknown upload outcome

- Given DriveBridge reports an upload in `submission_unknown`
- When the home page loads
- Then the queue has a 运行失败 item titled DriveBridge 上传结果未知, and 服务状态 lists DriveBridge with the number of runs to handle.

### Requirement: The tool catalog lists the Gateway's tools when it is configured

When the scope lists the Gateway, the tool catalog MUST replace the Gateway placeholder with the tools the Gateway lists, each with its backend, title, description, annotations and input fields, and MUST record drift in the change ledger like other owners. Listing a tool MUST NOT make it callable from the control center.

#### Scenario: filtering the catalog by Gateway

- Given the Gateway lists tools for two backends
- When the reader opens 模型与工具 and filters by MCP Gateway
- Then only the Gateway's tools are listed, and none offers a way to call it.
