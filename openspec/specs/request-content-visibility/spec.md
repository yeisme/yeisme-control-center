# request-content-visibility Specification

## Purpose
TBD - created by archiving change yeisme-request-content-visibility-v2. Update Purpose after archive.
## Requirements
### Requirement: Owner service-credential delegation

控制中心 SHALL 在会话缺少 OIDC 委托时，使用每个 owner 显式配置的服务凭据（`credential_ref`，0600 用户级文件）发起只读请求；两种委托都不可用时返回 `delegation_unavailable`，不得伪造成功或回退演示数据。

#### Scenario: personal 会话读取请求列表

- **WHEN** personal 内网会话发起 `/requests` 且对应 owner 配置了 `credential_ref`
- **THEN** 服务端以服务凭据调用 owner，scope binding 的 tenant/project/actor 照常传递，列表正常返回

#### Scenario: 完全无委托

- **WHEN** 会话无 OIDC 委托且 owner 未配置 `credential_ref`
- **THEN** 该来源 coverage 为 `forbidden`/`delegation_unavailable`，其余 owner 不受影响

### Requirement: Attachment content with audit-first

附件正文读取 SHALL 走与文本正文相同的审计先行语义：先写 `requests.attachment_read` 审计行再访问 owner；审计写失败返回 503 `audit_unavailable` 且零 owner 调用。

#### Scenario: 读取图片附件

- **WHEN** 用户以声明的用途请求读取一个图片附件
- **THEN** 控制中心先写审计行，再向 owner 读取字节；mime 通过白名单且 ≤8MB 时返回短期媒体句柄，预览经 `/media/{handle}` no-store 输出

#### Scenario: owner 未实现附件合同

- **WHEN** owner 对 `attachments:read` 或附件 `content:read` 返回 404/405 或合同不符
- **THEN** 控制中心如实返回 `needs_contract`，不显示成功或空内容

### Requirement: In-memory only content

附件字节与正文文本 SHALL 只存在于当前会话内存与短期句柄（≤120 秒）；不写入 localStorage、服务端持久化、日志或证据目录。

#### Scenario: 关闭详情或切换范围

- **WHEN** 用户关闭详情工作区、切换 scope 或注销
- **THEN** 附件预览与正文立即清除，句柄随会话/scope/过期失效，不触发重新读取

