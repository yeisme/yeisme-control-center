# Control Center Frontend Backend Specification

## ADDED Requirements

### Requirement: source status is stated once in the top bar and at most one line per page

The system MUST derive task source status from one shared reading of the scope's connections, MUST show it in the top bar on every viewport width, MUST limit each page's notices to one line that names what the page lacks, MUST NOT repeat the same cause in more than one notice on a page, and MUST let the user reach 服务与连接 from that line or the page's connection tile in one step.

#### Scenario: some connections cannot be read

- Given a scope where two of five task connections are unreadable and the others return tasks
- When the user opens the task center, the asset library or the review page on a desktop or a phone
- Then the page shows one line naming the two connections and saying the list may be incomplete, the line has a 服务与连接 button that opens the services page, the top bar shows 3/5 连接可读, and no notice says the data may be stale.

#### Scenario: the home page already lists the blocked sources

- Given the same scope
- When the user opens the home page
- Then no source notice line is shown, the work queue lists the blocked sources, and the 可读连接 tile opens the services page in one click.

### Requirement: a failed read keeps the last batch and says it may be old

The system MUST keep the last observed tasks when both task lanes fail in transit, MUST mark them as possibly stale with the time they were observed, MUST still clear tasks when a read is refused, and MUST re-read immediately when the user asks to read again.

#### Scenario: the control center becomes unreachable

- Given the asset library showing results
- When both task reads fail with a network error
- Then the results stay on screen, the page shows one line saying the data may be stale with 重新读取 and 服务与连接, and the top bar says 数据可能已过期.

#### Scenario: the connection comes back

- Given the stale state above
- When the network recovers and the user clicks 重新读取
- Then the next read happens at once instead of reusing the failed result, and the stale line disappears.
