# 日常管理：本地实现、内网部署与待接入项

## 当前结论
本地代码与隔离验证通过。用户专项授权后，控制中心已部署到 **http://10.10.1.101:51873**，指定管理员真实登录及控制中心重启恢复已验证；访问设备直接使用内网 HTTP，见 [部署与接入说明](lan-deployment.md)。三服务真实接入仍待含观测合同的运行版本及独立受限凭据，整体目标不能标记完成。没有签发 owner 凭据、修改现有 owner 服务、付费生成、提交推送或运行 race。

## 本次变更
- 具名个人登录、可信 admin/viewer、旧配置兼容、统一登录错误、会话失效与退出；管理员也不能绕过 CSRF、scope 或 owner 权限。
- 26 项现存产品目录、范围化非秘密连接投影、搜索筛选与详情。目录登记、配置、授权和真实观测分开；退役 Yeitra 不恢复。
- 真实模式六入口、个人账号/角色、历史任务结果页、加载与失效状态；手机保留关键接入状态，不用设计样例回退。
- 配置 CLI 增加具名初始化和显式账号迁移；不覆盖已有配置或替换其他用户名。旧未具名配置默认 viewer，需操作者显式设置 admin 才能发起取消，详见 personal-task-observation.md。
- 健康端点只证明控制中心进程存活。有限取消仍需本地意愿与 owner 额外授权，未知回包只查询原回执。

## 验证事实
- 本项目 typecheck、85 项测试及 build 通过；保留已有约 722 kB 主 chunk 警告，没有把警告隐藏为通过。
- 网络合同 mock 下 8 组浏览器检查通过，覆盖 390/768/1440/1920 明暗、六入口、搜索/键盘/详情、错误、资产引用和会话退出。
- 真实控制中心服务加 fake MCP 的 11 组组件检查通过，覆盖受控媒体、取消 revision 冲突、丢回包恢复、目录和账号。不等于三个日常 owner 真实验收。
- 主动 LSP 检查 17 文件：7 确认 clean，5 无法确认，5 含辅助 ast-grep 规则发现；不能宣称静态检查全部 clean。辅助发现主要为既有 URL/JSON 抛错调用和 Error 构造风格，TypeScript 编译检查通过。
- 前端前两次失败是测试将表格行误当按钮、将底部设置误当主导航；选择器修正后通过，失败目录保留。

证据入口：
- temp/integration-test-runs/daily-local-gates-2026-10-07T16-43-44-346Z/summary.json
- temp/integration-test-runs/daily-frontend-2026-10-07T16-38-19-817Z/summary.json
- temp/integration-test-runs/task-visibility-2026-10-07T16-39-58-172Z/summary.json

每个目录均保留 command.txt、stdout.log、stderr.log、env.json 与 artifacts/。截图与测试数据均为隔离样例，不是生产内容。

## 部署结果与剩余授权
1. 控制中心专项部署与管理员初始化已获用户明确批准，准入例外已记录于 AGENTS.md；不扩大为 owner 服务变更权限。
2. 三服务当前二进制缺少观测合同标记，Sonora实际serve帮助也没有observer参数。现行源码合同不等于已部署，完整接入需要独立批准版本切换、必要重启与项目限定metadata/content凭据。具体方案见 lan-deployment.md。
3. 独立51873 HTTP入口与loopback4312已运行，既有443未修改。真实 Chrome 内网 HTTP 访问验证成功；其他设备无需导入证书，只需能够访问该内网地址。
4. 三服务真实读取还需要明确项目及现存任务/结果；没有样本时不自动创建付费任务。

真实控制中心证据：`temp/integration-test-runs/lan-2026-10-08T07-29-22-153Z/`。验证了 HTTP、登录、越权/CSRF、桌面/手机目录、应用重启与退出，`real_owner_reads=false`。

## 本地重验命令
在 client/yeisme-control-center 执行：

```bash
bun scripts/verify-daily-backend.ts --full
bun scripts/verify-daily-frontend.ts
bun scripts/verify-task-visibility.ts
openspec validate yeisme-personal-daily-management-v1 --strict
```

最后一项组件测试需要先完成 build；full 已包含 build。隔离脚本使用独立端口和临时凭据，退出后关闭自有进程。真实控制中心入口与运行命令见 lan-deployment.md；Open Design URL 仍仅为设计预览。
