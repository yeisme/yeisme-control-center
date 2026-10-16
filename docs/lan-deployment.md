# 控制中心运行与部署边界

正式入口统一由 `YEISME_CONTROL_ORIGIN` 管理。默认本地配置为：

```bash
export YEISME_CONTROL_ORIGIN=http://127.0.0.1:4312
export YEISME_CONTROL_BIND=127.0.0.1
```

loopback 本地测试允许 HTTP；任何可被其他设备访问的入口必须使用 HTTPS。`0.0.0.0` 只能作为显式监听地址用于受控联调，不能写入浏览器 URL，也不能绕过 HTTPS 要求。

## 本地验证

```bash
bun install --frozen-lockfile
bun run build
YEISME_CONTROL_ORIGIN=http://127.0.0.1:4312 YEISME_CONTROL_BIND=127.0.0.1 bun run serve
curl --fail "$YEISME_CONTROL_ORIGIN/api/control-center/v1/health"
```

v18.1 使用同一根入口：

```bash
curl --fail -I "$YEISME_CONTROL_ORIGIN/"
```

未登录的业务读取应返回 `401 login_required`。健康端点只证明控制中心进程响应，不证明 owner、Provider 或真实业务数据可用。

## 真实开发预览

需要在本机浏览真实 owner 读取时，使用临时配置启动预览；不会覆盖用户配置，也不会启动写操作：

```bash
export YEISME_PREVIEW_PASSWORD='仅用于本次预览的临时密码'
bun run preview:real
```

预览 UI 使用 `http://127.0.0.1:4298/`，控制中心 API 使用 `http://127.0.0.1:4312`。启动器复制现有连接定义到临时目录，退出后清理临时配置和登录密码。浏览器验收使用：

```bash
bun run test:preview:real
```

这条路径只验证真实只读合同；它不替代外部 HTTPS 部署，也不触发 Provider 生成、取消或账务操作。

受控局域网开发联调可以显式绑定 `0.0.0.0`：

```bash
YEISME_PREVIEW_BIND=0.0.0.0 YEISME_PREVIEW_UI_HOST=0.0.0.0 bun run preview:real
```

该模式只用于开发预览；正式外部入口仍必须使用 HTTPS，且不把实际机器地址提交到仓库。

## 外部 HTTPS 部署契约

部署前必须提供一个由部署环境负责解析和签发证书的 HTTPS origin，并通过环境变量传入：

```bash
export YEISME_CONTROL_ORIGIN=https://<internal-control-center-host>
export YEISME_CONTROL_BIND=127.0.0.1
bun run build
bun scripts/prepare-intranet-release.ts
```

仓库不保存实际主机名、IP、证书、账号、密码、observer token 或 Provider 凭据。反向代理只转发到 loopback 应用端口，并阻断 `/docs/`、`/source.zip` 和源码路径。

## 运行命令

```bash
systemctl --user status yeisme-control-center.service
systemctl --user restart yeisme-control-center.service
journalctl --user -u yeisme-control-center.service --since today
```

停止控制中心不会停止 owner 服务，也不会删除任务、资产或凭据。发布切换必须先通过候选构建和组件验证；失败时恢复 `previous_release`，不得覆盖开发目录。

## Provider 与 owner 状态

Provider transport、action contract、任务观测、内容读取和真实生成分别验收。`configured`、`transport verified` 或 `tools/list` 成功都不能直接推导业务 ready。真实 canary 只允许在明确预算和 owner 授权下运行：

```bash
bun run test:provider-live -- --confirm-live --total-cny 30 --image-cny 15 --video-cny 10 --audio-cny 5
```

当前状态以 [当前实现状态](current-status.md) 为准；本文件不记录真实部署地址或秘密配置。
