# 其余工具的接入候选

三服务与片场之外只做合同/痛点清单，不表示真实接入、部署或后台管理已授权。此表不是完整资产目录；不把所有工具强行建成异步任务。

| Owner | 具体痛点 | 缺口/不能混同的事实 | 下一可验收切片 |
| --- | --- | --- | --- |
| `mcp/gateway` | Agent调用发生过，但浏览器不知道在哪个backend成功或失败 | MCP调用事实不等于领域任务完成；不共享Aigora企业权限 | 只读调用关联ref、backend健康与授权原因；无服务重启按钮 |
| `apigateway/aigora` | 请求和费用可查，但与作品任务无法确定关联 | 企业tenant/actor、request/job/attempt必须保留原粒度 | 用明确correlation ref连接已授权trace；未知关联不猜测 |
| `cli/auctra` | 长正文生成和审阅状态离开片场后不可见 | 草稿、已接受文本与任务完成是不同状态 | 已有异步operation的只读snapshot，返回固定draft/review ref |
| `cli/anatomia` | 视频分析耗时长，模态覆盖和缺口容易被当成失败 | 分析revision、证据覆盖、审阅各自独立 | 既有分析run阶段、按模态完成计数和证据ref |
| `cli/drivebridge` | 上传、下载、回存出现未知结果时容易重复操作 | 传输完成不等于domain接受；受管目录保护必须留owner | 原transfer/ref只读状态、字节进度、校验与回执；不任意浏览远端路径 |
| `cli/pinax` | 索引、同步和导入缺少后台任务视图 | vault写入门、冲突和发布不归控制中心 | 已有run的metadata进度及冲突ref；不读取笔记正文或自动发布 |
| `cli/quaestor` | 研究耗时与来源整理阶段不透明 | 检索结果、采纳证据、付费调用不能混为一项成功 | 只读research run状态、来源数量和报告ref；不自动续费搜索 |
| `cli/promptrepo` | 资源版本与同步结果无法从任务返回准确位置 | 公开目录不代表有正文权限；版本必须固定 | 同步/导入原receipt与目标ref，只读版本差异 |
| `backend-server/capsa` | 服务异常难区分连接、队列等待与worker失败 | 基础设施队列不替代领域任务真源 | 只读健康/容量和opaque关联ref，不提供通用SQL或Shell |
| `backend-server/template-registry` | 模板清单、同步或编译状态分散 | 模板许可/版本不能由控制中心决定 | 已有构建/导入receipt及固定版本ref |
| `mcp/gitea-mcp` | 外部issue/PR/CI进展分散 | 外部评论、合并、发布均有真实副作用 | 授权只读CI状态和PR定位；外部写入留原工具 |
| `mcp/blender-mcp` | 渲染长任务进度与成品散落 | Blender进程控制和场景写入不是通用管理动作 | 已有render job的帧计数、输出ref与能力禁用原因 |
| `agent/digital-human` | 音画合成中不同子阶段难追踪 | 真实人物授权与生成完成不可混同 | 使用既有授权合成run阶段，独立肖像/声音授权状态 |
| `tools/manju-hotlist` | 刷新是否成功、来源是否同口径难一眼判断 | 根工具例外，不创建服务/MCP/数据库；manual不升级live | 读取现有CLI快照/校验摘要与同口径比较，不虚构全网榜单 |

接入前每个owner应给出：唯一任务族、接受前持久化身份、纯读动作、分页/错误/权限合同、事件或阶段来源、内容grant、取消回执（若支持）、准确返回定位、隔离测试命令。缺少任一项可先展示接入缺口，但不得标记完整。
