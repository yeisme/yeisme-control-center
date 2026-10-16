import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, join } from "node:path";
import { homedir } from "node:os";
import { spawnSync } from "node:child_process";

const runId = process.argv[2];
if (!/^lan-[0-9T-]+Z$/.test(runId || "")) throw new Error("Usage: bun scripts/record-lan-delivery.ts <lan-run-id>");
const root = resolve(import.meta.dirname, "..");
const state = join(homedir(), ".local/state/yeisme-control-center");
const manifestPath = join(state, "deployment.json");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const summary = JSON.parse(readFileSync(resolve(root, "temp/integration-test-runs", runId, "summary.json"), "utf8"));
if (summary.status !== "passed" || summary.origin !== manifest.origin || !summary.real_control_center || summary.certificate_validation_disabled !== false || manifest.origin !== "http://10.10.1.101:51873")
  throw new Error("Verified LAN evidence is required.");
const check = spawnSync("systemctl", ["--user", "is-active", "yeisme-control-center.service", "yeisme-control-center-tls.service"], { encoding: "utf8" });
if (check.status !== 0) throw new Error("Control center units are not both active.");
writeFileSync(manifestPath, JSON.stringify({ ...manifest, activated: true, verified_at: new Date().toISOString(), evidence: runId, owner_integration: "pending_authorization_and_runtime_contract", owner_configuration_changed: false }, null, 2) + "\n", { mode: 0o600 });
const document = `# 控制中心内网部署与三服务接入待办

## 可访问入口

- URL：**${manifest.origin}**
- 用户名：**yeisme**；初始密码使用用户在对话中指定的值，不回显、不写入本文。
- 角色：控制中心最高管理员。owner 的项目/内容/动作权限仍独立检查。
- 状态：控制中心已部署、真实浏览器登录与重启恢复已验证；三服务未接入，不代表整体目标已完成。
- 端口：应用仅 127.0.0.1:4312；HTTP 仅 10.10.1.101:51873；既有443未修改。
- systemd 用户服务已 enabled，用户 linger=yes；验证了控制中心进程重启，未重启物理主机。
- 发布快照：${manifest.release}。独立复制应用资源并 bundle 服务端，不从可变开发目录运行；不部署内部docs、源码压缩包或测试证据。

## 访问方式

当前入口是内网 HTTP，不需要导入证书：

\`\`\`bash
curl --fail ${manifest.origin}/api/control-center/v1/health
\`\`\`

## 运行命令

以下命令在10.10.1.101的当前用户会话执行，仅操作控制中心：

\`\`\`bash
systemctl --user status yeisme-control-center.service yeisme-control-center-tls.service
systemctl --user restart yeisme-control-center.service
journalctl --user -u yeisme-control-center.service -u yeisme-control-center-tls.service --since today
systemctl --user stop yeisme-control-center-tls.service yeisme-control-center.service
systemctl --user start yeisme-control-center.service yeisme-control-center-tls.service
\`\`\`

完全停用入口且保留账号、CA与快照：

\`\`\`bash
systemctl --user disable --now yeisme-control-center-tls.service yeisme-control-center.service
\`\`\`

这不会停止Scaena/Eikona/Sonora或删除任务、资产。当前为首个独立部署快照，无旧版本可自动回滚；如需回退本次部署先停用两个unit，保留状态供恢复，不删除数据或覆盖开发工作区。

用户级配置位于 ~/.config/yeisme-control-center/config.json，密码哈希引用为config.json.password，均为0600。配置/身份继续通过personal-config CLI维护；改密失效旧会话。新版本部署前需独立验证，不能直接覆盖运行快照。

## 实际验证

证据：temp/integration-test-runs/${runId}/，包含summary.json、command.txt、stdout.log、stderr.log、env.json和artifacts/。

${summary.results.map((r: {name:string;status:string})=>`- ${r.status}: ${r.name}`).join("\n")}

这证明同一主机经真实内网 HTTP 地址完成浏览器和服务行为；没有从另一台物理设备实测，其他设备的网络可达性仍需确认。

## 三服务：需要独立确认的接入变更

只读核验发现：现行三个 yeisme-lan-*.service 运行，但二进制中未找到control_center.tasks.list/personal-observer-v1合同标记；Sonora实际serve帮助没有observer参数。不能只凭源码文档签发凭据后宣称可用。没有读取/复用现有Agent或Provider秘密，没有执行任何owner升级、重启或签发。

| 服务 | 现状证据 | 建议最小变更（尚未授权/执行） |
| --- | --- | --- |
| Eikona | 18976；lan-http配置；当前启动兼容api-key-file；旧二进制无observer合同标记 | 验证含新观测合同的构建；保留已有执行入口与数据根；签发明确项目的personal-observer-v1及结果读取purpose，禁止生成/取消purpose；配置与固定origin一致；健康检查后才切换 |
| Scaena | 18979；gateway模式配置，当前只有scaena入口，未发现scaena-api可执行文件；旧二进制无observer合同标记 | 在owner内准备匹配版本及scoped access-key管理面；复用现有actor/project绑定，reader+metadata/content目的；不得把gateway静态密钥升级成全局浏览器凭据 |
| Sonora | 18980；workspace=data/sonora-lan-mcp，project-id=lan-media；serve帮助无observer参数 | 验证新版本，生成独立0600 observer token，绑定lan-media；仅开启metadata/content；保留现有执行token；部署需要短暂重启，默认不启用cancel |

执行顺序建议：各owner读取指令并检查源码/二进制兼容→保存现有二进制/非秘密配置恢复点→隔离测试和迁移风险评估→确认可用项目/现存任务→在明确维护窗口逐服务切换与健康核验→签发受限凭据→控制中心connect登记文件引用→真实列表/详情/结果/拒绝读取验收。任何数据库迁移、不可逆变更或未知任务风险先停止，不能静默执行。旧执行入口应保持兼容；同一数据目录不得同时运行两个写入daemon。

签发命令的现行文档入口为 cli/eikona/docs/commands/service.md、cli/eikona/docs/interfaces/task-observation.md、cli/sonora/docs/protocols/task-observation.md、agent/scaena/docs/design/task-observation.md。具体项目与actor尚未全量核实，不编造可执行签发参数。

建议授权范围仅为：三服务观测合同版本升级、必要短暂重启、独立项目限定metadata/content凭据；不授权付费生成、真实取消/重试、自动任务恢复、扩大Provider权限或数据迁移。用户确认后才进入各owner实施。
`;
writeFileSync(resolve(root, "docs/lan-deployment.md"), document);
const tasks = resolve(root, "openspec/changes/yeisme-personal-daily-management-v1/tasks.md");
writeFileSync(tasks, readFileSync(tasks, "utf8") + `\n阶段记录：INTEGRATION INTEGRATION_PENDING；控制中心专项部署准入已获用户确认；真实内网HTTP/登录/重启通过，证据=${runId}；三owner旧运行版本与独立observer尚缺，完整5.1/6.1/7.1仍未完成。\n`);
console.log(JSON.stringify({ origin: manifest.origin, deployed: true, observer_integration: "pending", http_lan_only: true, document: "docs/lan-deployment.md" }, null, 2));
