# 正式只读接入运行说明

本文聚焦只读接入。当前完整同源路由与本地协作写动作见 [接口说明](interfaces.md)，后续合同/证据缺口见 [完成方案](completion-roadmap.md)。文中原始最小读取列表不代表全部现行路由；真实组织委托、Provider 和部署验收各自独立。

启动默认没有身份或管理权限。先通过 `node scripts/configure-server.mjs` 生成0600本地配置；正式oidc配置由运行owner提供，禁止把测试站点Cookie当作此客户端会话。

配置形状由 server/contracts.ts 的 ServerConfig 定义：origin/port、oidc(issuer/clientId/clientSecretRef)、principals(issuer/subject/name/scopes)、owners(origin/audience)。SecretRef为0600文件引用；授权配置没有演示默认principal。用户访问通过scope.id选择已绑定范围，不能自报actor或owner地址。

OIDC发现仅接受与issuer同源的端点，非loopback要求HTTPS；不跟随重定向。回调为 `/api/control-center/v1/auth/callback`。访问token只在服务端保留；不支持的opaque token或owner token exchange保持delegation_unavailable，不能改用全局服务Key。Aigora现有Operator认证不等于已支持该委托，必须独立验证。

应用同源 API：

- GET `/api/control-center/v1/auth/methods`：非敏感登录配置状态。
- GET `/api/control-center/v1/auth/login` 和 `/auth/callback`：OIDC。
- GET `/api/control-center/v1/session`：可信身份和可用范围。
- GET `/api/control-center/v1/requests?scope=...`：来源分批列表。
- GET `/api/control-center/v1/requests/summary?scope=...`：各来源完整筛选汇总。
- GET `/api/control-center/v1/requests/{owner}/{id}?scope=...`：请求详情。
- POST `/api/control-center/v1/requests/{owner}/{id}/content:read?scope=...`：用途、方向和CSRF保护的读取。
- GET `/api/control-center/v1/organization?scope=...`：当前来源成员投影。
- POST `/api/control-center/v1/auth/logout`：撤销本地会话。

不提供任意 HTTP 转发或远程 Shell。具名生成、取消与管理 action 受当前 descriptor、角色、owner 权限和提交门限制，不能因登录或只读可用推断已授权。内容、身份与查询响应均 no-store；重启后的会话与回执恢复以当前 SQLite/服务实现验证，不把历史进程内会话说明当作多副本生产保证。

## 验收分层

本地单元与浏览器fixture只证明控制台合同；owner测试只证明对应本地实现；真实MCP发现只证明该连接可响应。日常四服务验收必须使用既有正式授权，记录安全引用/状态与覆盖度，不保存正文、Cookie、token或Provider原始载荷。部署、IdP新注册、grant变更及归档采集启用未包含在本轮只读接入授权中。

## 媒体与过程观察

媒体预览使用控制中心短期 artifact grant 和同源 `/media/` 代理。浏览器只在当前会话内缓存已授权的 Blob/Object URL，按 scope、session epoch、task、artifact 和 MIME 隔离，并在 grant 到期、登出或 scope 切换时清理。大音视频优先走代理的 Range 流式播放；原生播放失败时才回退到 Blob。服务端继续使用 `Cache-Control: no-store`，每次传输重新做 owner 授权和审计。

过程时间线只显示 owner 明确返回的 `process`、`prompt_capture` 和 `events`。没有提示词采集字段时显示“来源没有提供提示词采集观察”，没有检查点时显示“来源尚未返回中间检查点”；`needs_contract`、`forbidden`、`unavailable`、`stale` 保持独立状态，不使用本地任务或演示数据补齐。
