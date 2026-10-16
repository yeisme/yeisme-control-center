# Changelog

## 0.2.0-rc.1

- 统一控制中心 origin 与 bind 配置，loopback HTTP 与外部 HTTPS 边界明确。
- 增加公开面隐私扫描和 CI 浏览器验证入口。
- 增加受控的 `test:owner-live-read` 只读验收，记录真实 owner 能力、任务、事件和内容授权结果，不调用 Provider、不执行写操作。
- 保持 Provider、owner、fixture-only 和部署候选状态分层记录。
- 发布候选包含构建校验和、SBOM 与 provenance 证据入口。
