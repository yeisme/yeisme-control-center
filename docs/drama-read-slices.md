# 做剧只读切片：实现与验证边界

## 当前结论

本轮完成了集级媒体代理的可注入接口、同源 HTTP 入口和模板目录的窄只读投影。**没有完成真实 Scaena grant 接入，也没有新增浏览器预览按钮。** 不得将本地测试成功解释为可生产、可发布或已上线。

## 集级媒体入口

`POST /api/control-center/v1/episode-production/artifacts/:artifact_ref/access?scope=<scope>` 使用已有会话、scope、CSRF 和 audit-first 机制。请求仅接受 `episode_ref`、`connection`、`expected_revision`、`digest`、`purpose`；purpose 为 `preview` 或 `download`。服务端只接受当前 scope 的已启用 Scaena 连接，且连接不能禁止内容访问。

`ControlCenterDeps.episodeArtifacts` 是进程内可选的 `EpisodeArtifactAccessPort`，不是浏览器可配置的 owner 地址，也不是新 Provider 协议。默认未注入时返回 `409 needs_contract`，不创建句柄。测试中的 fake port 不会自动注入实际应用。

`MediaBridge.issueEpisode` 不伪造 task key。句柄绑定稳定 session 身份、epoch、scope 授权字段、episode/artifact、revision/digest 和原 grant。每次转发重新授权；撤销、过期、原 grant 的身份/URL/期限/媒体元数据变化均拒绝。复用现有 Range、MIME、大小限制、审计和 `no-store` 流式转发。

当前 port 的媒体请求没有 owner 鉴权头；仅适用于经适配器验证的同源签名 URL。若 Scaena 的 content route 要求 bearer，后续必须通过服务端适配器扩展凭据转发边界并测试，不能把凭据交给浏览器，也不能以永久公开链接替代 grant。

## 模板目录

`src/shared/template-catalog.ts` 是 `template-registry.catalog.v1` 的**窄安全投影**，不是完整 catalog、renderer 或 registry。

- 保留允许的目录身份、版本、摘要、来源和发布状态；不从 `release_state` 推导 maturity 或授权。
- `preview.body` 必须为 `none`；未知字段、正文、用户值和执行动作不投影。
- 本切片不投影完整 snapshot、subtitle、visibility、solution 和 slots，也不支持 resolve/render；这些不是已交付能力。
- 游标只做大小/控制字符检查，内部语义归 Registry；409 按受信任错误码区分 cursor conflict 与 release unavailable。
- 三个 cell 仅是本地参考目标描述，均不可执行。`drama-30-60s-experiment` 的设计成熟度为 exploratory；其余两项实际成熟度 unknown。三者当前 catalog availability 均为 needs_contract。没有匹配 owner 证据时不能显示为可执行计划。

## 已运行验证

从本项目执行：

```bash
bun scripts/verify-drama-read-slices.ts
```

脚本复用 Vitest、typecheck 和 build，保存六件套到 `temp/integration-test-runs/drama-read-slices-<run-id>/`。本轮主工作树结果：

- `drama-read-slices-2026-11-10T17-18-09-711Z`：168 项测试通过，typecheck/build 通过。
- 媒体的成功场景使用 fake port；路由使用真实应用 handler。
- 没有 live owner、Provider、付费、部署或 race 检测。

## 仍需推进

1. 核实 Scaena 中 episode→assembly artifact 的权威来源，不能要求前端造 receipt 或猜引用。
2. 明确 observer 的临时 grant 签发和 content 访问合同；复用 Scaena 既有 artifact access store。
3. 实现并注入真实 owner adapter，测试 bearer 转发、撤销、映射漂移及 signed URL 脱敏。
4. 在成片站接入明确的 availability/阻塞状态，再接浏览器预览/下载和视觉验收。
5. 模板只读 projection 接上已授权目录读取；完整 slots/render 仍归公共模板 owner。

## 旧读回结论的限定

旧脚本读取 `rows` 符合当前 `DramaEpisodesResponse`，但没有核对 `universe.bound`、`coverage`、`complete`，并曾把请求失败错误地写为 passed。此前的 `episode_count=0` 只能说明那次脚本没有获得可验证剧集，不能证明 owner 没有剧集。后续读回必须验证响应 schema、范围绑定、覆盖和分页，失败不能转成空数组成功。
