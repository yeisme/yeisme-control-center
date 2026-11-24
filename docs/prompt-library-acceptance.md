# 提示词库本地验收

本次交付为本地实现候选，覆盖 Eikona、Sonora、Scaena 与控制中心。未部署日常实例，未签发或扩大来源授权，未调用真实 Provider。

## 通过项

- 控制中心 102 个测试文件、968 项测试通过；类型检查与生产构建通过。
- 三套真实 owner handler、隔离 SQLite、真实控制中心与 Chromium 联调：三来源目录及全文；创建、编辑、版本回看、标签筛选；收藏、归档；TXT/Markdown 导入、全文搜索、批量标签；手机宽度与键盘关闭通过。
- 控制中心应用壳浏览器检查 4 项通过。首次运行遇到 ERR_NETWORK_CHANGED，复跑通过；失败证据保留。
- Eikona prompts、prompt API、controlplane、runtime 包测试与相关 go vet 通过；生成合同校验通过。
- Sonora promptasset、API、jobs、music 与其他相关 services 包通过；更新后的 SFX 正文隔离测试通过，OpenAPI 平价通过，相关 go vet 通过。
- Scaena repository 全包、application、HTTP、OpenAPI、registry 测试通过；提示词与 task observation 聚焦测试、路由兼容测试、架构测试和相关 go vet 通过。
- 四个新增 OpenSpec change 均通过严格校验。

## 扩大检查的未通过项

- Sonora services 全包的 context policy 检查被现有未提交 `episode/episode_edit.go` 两处 Background 用法阻塞；该文件不在本次修改范围。
- Scaena 全局 check:fast 扫描现有 `temp/vendor-sonora-audio-sync`，产生 internal import 错误。没有删除或改动该临时副本。
- Scaena 全包还出现 DirectorWorkspace executor 断言、既有 artifact-files 冻结路由断言、ffmpeg 缺少 libass 的渲染失败。前两项涉及其他未完成工作区变更，未在本次绕过；媒体失败为环境能力缺口。提示词引入的 legacy alias 与查询参数断言失败已修复并定向复验。

不得将聚焦通过替代全局全绿。所有系统验收均使用合成内容和测试身份，不能证明生产权限、真实历史覆盖、组织委托或付费 Provider 验收。

## 运行与证据

在控制中心目录运行 `bun run test:prompt-library`。系统结果及各 owner 证据位于各自 `temp/integration-test-runs/prompt-library-system-<时间>/`；每轮保留 summary、命令、环境描述、stdout、stderr 和 artifacts。

日常实例接入需要升级四个服务至该候选，并核对现有项目绑定与内容/写入权限。只读连接保持只读，不能通过控制中心项目成员身份替代 owner 授权。旧内容缺失、digest-only 或权限不明时保持缺口。
