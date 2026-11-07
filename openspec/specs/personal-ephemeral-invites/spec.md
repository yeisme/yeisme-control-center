# personal-ephemeral-invites Specification

## Purpose
TBD - created by archiving change control-center-one-time-invite-and-token-login-v1. Update Purpose after archive.
## Requirements
### Requirement: Single-use invite token issuance, redemption, and revocation
管理员 SHALL 能够为已启用的个人账号创建带有效期的 `yki_live_*` 一次性邀请票据；服务端仅存储 SHA-256 摘要，首次通过 `POST /api/control-center/v1/auth/invite` 兑换时原子标记已消费并建立 HttpOnly 会话，二次兑换必须以 401 拒绝；管理员吊销票据后，该票据及其已建立的会话立即失效。

#### Scenario: Redeem once, survive refresh, reject second use, and revoke session
- **WHEN** 管理员为 `lin.zhou` 生成一次性邀请链接，受邀人首次打开该链接
- **THEN** 受邀人无需输入用户名与 Key 即进入授权工作台且刷新保持登录；另一浏览器再次打开同一链接被 401 拒绝；管理员吊销该邀请记录后受邀人下一请求立即变为未登录

### Requirement: Zero-leak URL scrubbing and smart invite paste on LoginScreen
前端在检测到 URL 含 `?token=` 或 `?invite=` 时 SHALL 在首帧通过 `history.replaceState` 擦除该参数后再执行会话兑换；在登录表单粘贴包含直连链接或多行「用户名 + 访问 Key」邀请卡片的文本时 SHALL 自动解析并填充或触发兑换。

#### Scenario: Multi-line invitation card pasted into login form
- **WHEN** 用户在登录页粘贴控制中心复制出的多行邀请口令文本（含用户名与访问 Key，或含 `?token=yki_live_*` 链接）
- **THEN** 登录框自动识别出用户名与访问 Key（或识别出一次性票据直接发起兑换），且地址栏与浏览器存储不留存任何明文密钥

