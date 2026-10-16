# 控制中心内网部署与 Provider 接入状态

## 可访问入口

- URL：**http://10.10.1.101:51873**
- v18 入口：**http://10.10.1.101:51873/workspace-v18.html**
- 用户名：**yeisme**；密码不写入本文。
- 应用仅监听 `127.0.0.1:4312`，内网 HTTP 网关绑定 `10.10.1.101:51873`。
- 原 `8443` HTTPS 入口已停止监听；旧证书和旧发布快照仅作为回退资料保留。
- HTTP 入口只用于受信任内网，不提供公网安全边界。

Provider MCP 配置仍由服务端通过 user-level `credential_ref` 读取；浏览器不会接触明文密钥。Eikona、Scaena、Sonora 的 Provider transport 已完成真实 `initialize/tools-list` 只读探测，任务观测和真实生成结果仍按各 owner 合同独立核验。

## 访问与验证

在 `10.10.1.101` 上执行：

```bash
curl --fail http://10.10.1.101:51873/api/control-center/v1/health
curl --fail -I http://10.10.1.101:51873/
curl --fail -I http://10.10.1.101:51873/workspace-v18.html
curl --silent -i http://10.10.1.101:51873/api/control-center/v1/workspace-v18/state
```

未登录的最后一条应返回 `401 login_required`。登录仍使用控制中心个人账号；HTTP origin 会让会话 Cookie 保持 `HttpOnly`、`SameSite=Lax`，不设置 `Secure` 属性。

## 运行命令

```bash
systemctl --user status yeisme-control-center.service yeisme-control-center-tls.service
systemctl --user restart yeisme-control-center.service
systemctl --user restart yeisme-control-center-tls.service
journalctl --user -u yeisme-control-center.service -u yeisme-control-center-tls.service --since today
```

虽然 systemd unit 名称保留了 `-tls` 以兼容已有部署脚本，但该单元当前运行的是纯 HTTP Caddy 网关，不启用 TLS。

完全停用入口但保留账号、配置与发布快照：

```bash
systemctl --user disable --now yeisme-control-center-tls.service yeisme-control-center.service
```

用户级配置位于 `~/.config/yeisme-control-center/config.json`，权限为 `0600`。控制中心重启会撤销旧会话，不会停止 Eikona、Scaena 或 Sonora。

## 当前 Provider 状态

| Owner | 接入 | 当前状态 |
| --- | --- | --- |
| Eikona | public HTTPS MCP，图像模型 | configured；已有成功 canary |
| Scaena | public HTTPS MCP，视频模型 | transport configured；历史提交曾被 Provider `InvalidApiKey` 拒绝 |
| Sonora | public HTTPS MCP，音频模型 | transport configured；下游 `openai-tts` credential 缺失 |

这些状态只说明 transport、授权和 action contract 的观察结果，不等于三模态生成都可用。本项目只做用量、成本统计和可视化，不做发票、付款、余额扣减或客户收费。

## 证据

- HTTP 切换备份：`~/.local/state/yeisme-control-center/transport-http-<timestamp>/`
- 当前发布 manifest：`~/.local/state/yeisme-control-center/deployment.json`
- 当前应用配置：`~/.config/yeisme-control-center/config.json`
- HTTP 验收证据写入 `temp/integration-test-runs/lan-<run-id>/`。

其他设备只需访问 `http://10.10.1.101:51873` 并确认能够到达该内网地址；不需要导入证书。
