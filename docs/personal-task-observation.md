# 个人任务观测：本地配置与独立激活

此文档是执行手册，不表示已部署或已授权。真实owner升级、observer签发、TLS入口和付费调用仍须单独授权。控制中心不签发owner权限、不复用Agent管理员凭据、不建立远程Shell。

## 本地空配置

从 `client/yeisme-control-center` 执行。以下只创建控制中心本地文件；运行密码命令前由操作者决定密码，不要把密码写到命令参数或脚本。

```bash
bun scripts/personal-config.ts init "$HOME/.config/yeisme-control-center/config.json"
bun scripts/personal-config.ts password "$HOME/.config/yeisme-control-center/config.json"
bun scripts/personal-config.ts status "$HOME/.config/yeisme-control-center/config.json"
```

密码交互隐藏输入；配置和秘密文件为0600。无默认密码、无注册。密码更改撤销已有个人会话；进程重启要求重新登录。配置改动在控制中心重启后生效。

### 具名管理员与旧配置迁移

新配置可同时指定入口和控制中心管理员用户名；以下地址是示例，不代表已部署：

```bash
bun scripts/personal-config.ts init "$HOME/.config/yeisme-control-center/config.json" https://control.example.test yeisme
```

`init` 拒绝覆盖已有配置。已有未具名个人配置继续支持旧的 password-only 登录，但默认角色为 `viewer`；需要取消操作时，应由操作者显式设置账号和 `admin`，不能依赖历史隐式权限：

```bash
bun scripts/personal-config.ts account "$HOME/.config/yeisme-control-center/config.json" yeisme admin
```

`account` 拒绝替换不同的既有用户名；可对同一账号显式设为 `viewer`。最高管理员只属于此控制中心，连接范围、内容授权和 owner 的取消权限仍逐项检查。浏览器不能自报角色，错误用户名和错误密码使用相同错误。旧 OIDC 默认 `viewer`，不会自动升级。

健康端点 `GET /api/control-center/v1/health` 只返回进程存活状态；`GET /api/control-center/v1/services?scope=<id>` 返回已登录身份当前范围内的产品目录与非秘密配置投影。`configured` 不是已授权或实时健康，目录不会探测上游。

## 登记已有的受限连接

示例地址和项目必须替换成操作者确认的真实值。`credential-file` 必须是该owner签发的observer文件，不是Provider key、OIDC token或Gateway管理员凭据。连接命令只登记引用，不发送网络请求或改授权。

```bash
bun scripts/personal-config.ts connect "$HOME/.config/yeisme-control-center/config.json" eikona-home eikona https://eikona.example.test/mcp project-a "$HOME/.config/yeisme-control-center/eikona-observer"
```

确需明文个人内网时，MCP endpoint只允许显式 `--private-http` 加数字RFC1918/loopback地址；浏览器远程访问仍必须HTTPS。不要将内网明文例外扩展到公网或metadata地址。

连接参数尾部 `--content` 只开启控制中心调用内容合同的本地意愿。Eikona凭据还必须具有独立的 `personal-observer-content-v1` purpose；单纯 `personal-observer-v1` 不能预览。Sonora另需owner显式内容开关，Scaena另需对应content purpose。此flag不能代替owner授权。三个来源都校验固定同源grant和任务结果归属，上游链接与凭据仅留同源服务端。

```bash
bun run build
YEISME_CONTROL_CONFIG="$HOME/.config/yeisme-control-center/config.json" bun run serve
```

默认仅监听 `127.0.0.1:4312`。多设备模式用已有HTTPS ingress代理loopback，配置origin为HTTPS入口且保留精确Host；不相信客户端 `X-Forwarded-*` 来扩大权限。这里不自动部署ingress或打开防火墙。

## Owner准备（在owner机器执行，不在浏览器执行）

- **Eikona**：部署带 `control_center.tasks.*` 的版本；独立project-scoped `personal-observer-v1`。内容可另加 `personal-observer-content-v1`，当前artifact动作需operator展示lane，但purpose限制仍禁止生成、resume和通用读取。必须配置owner已有 `public_base_url` 为连接同源，以便图片能力链接不跨域。禁止用 `service-api` 组合observer。
- **Sonora**：现有MCP执行token保持原用途；另配32字节以上observer token与实际workspace ProjectRef。服务入口支持 `--mcp-observer-token-file <0600-file> --mcp-observer-project <ref>`；环境变量 `SONORA_MCP_OBSERVER_TOKEN` / `SONORA_MCP_OBSERVER_PROJECT` 仅用于临时覆盖或服务环境。token不可与执行、service或provider凭据相同。音频另需 `--mcp-observer-content --project-id <同一ProjectRef> --public-base-url <MCP同源origin>`；默认关闭，媒体GET/HEAD仍带当前observer授权，只转发任务明确audio-asset，不内联音频。
- **Scaena**：已有access-key project/actor绑定加 `personal-observer-v1` purpose；默认仅四项观测动作；另加 `personal-observer-content-v1` 才开放任务结果grant及专用GET/HEAD，不开放通用asset读取或生成。固定公开origin必须与MCP连接同源。直接视频任务沿用原actor约束，不把项目成员权自动提升为另一个actor的直接视频任务读取权。

已连接MCP不代表这些新动作已部署；缺合同时控制中心显示 `needs_contract`。401/403显示 `needs_authorization` 并停止该连接的上游请求；修正授权后重启本地控制中心，不自动改用更高权限key。

## 有限取消：默认关闭，独立授权

本地开关不会给owner增加权限：

```bash
bun scripts/personal-config.ts cancel "$HOME/.config/yeisme-control-center/config.json" eikona-home on
```

- Eikona：另需`personal-observer-cancel-v1`＋metadata purpose及operator/admin，仅尚未领取的queued run；有worker证据或运行中不调用provider cancel。
- Sonora：另需服务显式`--mcp-observer-cancel`，仅local-job；pending直接取消，running置协作标志并回`requested`，实际停止以原任务终态为准。
- Scaena：另需`personal-observer-cancel-v1`＋metadata purpose及operator/admin，仅delegation尚未发送项；已发送项和结果引用保留。

POST须明确确认、当前revision及稳定idempotency_key。`control_center.tasks.cancel_receipt`只查同一回执。`cancelled|requested|already_terminal|not_supported|unknown`分别显示；不能把受理当已停、不能保证退款。网络丢回包后当前标签页sessionStorage保留非秘密取消身份，刷新后只查询，不自动重投。Eikona采用文件claim fence与写前unknown回执，不承诺跨文件原子事务；持久unknown须回owner检查，不能删除回执来盲目重试。关闭本地意愿用同命令`off`，配置修改后重启控制中心。

## 固定作品返回入口

控制中心登记已存在的Scaena连接对应的Studio origin（只写本地配置，不改owner）：

```bash
bun scripts/personal-config.ts studio "$HOME/.config/yeisme-control-center/config.json" scaena-home https://studio.example.test
```

只接受HTTPS或本机loopback origin，不接受路径、query、fragment或凭据。任务必须明确返回episode_ref才产生返回链接。Studio构建侧配置 `VITE_CONTROL_CENTER_ORIGIN` 与 `VITE_CONTROL_CENTER_CONNECTION_ID`，详见片场docs/task-observation.md。链接不包含token/正文，目标重新登录和授权；新标签页保留原页草稿，不能取代保存。系统通知需页面点击开启，本会话有效，无后台推送或默认权限请求。

## 验收与回退

先隔离测试，再由操作者授权日常只读验收：读capabilities，列出一个已知原任务，比较其状态/产物引用。此过程不得调用generate、wait、resume、reconcile或管理操作。未找到记录不能自动重投。

```bash
bun scripts/personal-config.ts disable "$HOME/.config/yeisme-control-center/config.json" eikona-home
```

停止控制中心不会删除owner任务、账本或资产。有限取消已实现但日常未激活，付费重试留原工具。每项启用应单独报告：代码版本、部署状态、凭据范围、只读结果、内容结果，不以页面打开代替接通证据。
