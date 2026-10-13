import fs from "node:fs";
import path from "node:path";
const root = path.resolve("../..");
const entries = [
  [
    ".",
    "yeisme-request-visibility-v1",
    "Yeisme 控制中心",
    "docs/request-visibility.md",
  ],
  [
    "../..",
    "yeisme-control-center-request-visibility-v1",
    "跨项目交接",
    "docs/architecture/yeisme-control-center-request-visibility.md",
  ],
  [
    "../../apigateway/aigora",
    "aigora-control-center-read-projection-v1",
    "Aigora",
    "docs/observability/control-center-read-projection.md",
  ],
  [
    "../../agent/scaena",
    "scaena-control-center-read-projection-v1",
    "Scaena",
    "docs/design/control-center-read-projection.md",
  ],
  [
    "../../cli/eikona",
    "eikona-control-center-read-projection-v1",
    "Eikona",
    "docs/interfaces/control-center-read-projection.md",
  ],
  [
    "../../cli/sonora",
    "sonora-control-center-read-projection-v1",
    "Sonora",
    "docs/protocols/control-center-read-projection.md",
  ],
];
const capabilities = {
  Aigora: [
    "GET /operator/v1/control-center/scope",
    "GET /operator/v1/observability/requests",
    "GET /operator/v1/observability/requests/summary",
    "POST /operator/v1/request-traces/{request_id}/archive:read",
  ],
  Scaena: [
    "GET /api/v1/projects/{project_id}/control-center/requests",
    "GET /api/v1/projects/{project_id}/control-center/requests/summary",
    "GET /api/v1/projects/{project_id}/control-center/requests/{request_id}",
  ],
  Eikona: [
    "GET /api/v1/control-center/requests",
    "GET /api/v1/control-center/requests/summary",
    "GET /api/v1/control-center/requests/{request_id}",
  ],
  Sonora: [
    "GET /api/v1/control-center/requests",
    "GET /api/v1/control-center/requests/summary",
    "GET /api/v1/control-center/requests/{request_id}",
  ],
};
const write = (name, content) => {
  fs.mkdirSync(path.dirname(name), { recursive: true });
  fs.writeFileSync(name, content + "\n");
};
for (const [relative, id, owner, doc] of entries) {
  const dir = path.resolve(relative),
    change = path.join(dir, "openspec/changes", id);
  if (!fs.existsSync(path.join(change, ".openspec.yaml")))
    throw Error(
      "Create the OpenSpec skeleton with openspec new change first: " + id,
    );
  write(
    path.join(change, "proposal.md"),
    `# ${owner}：请求信息与授权读取\n\n## Why\n\n控制中心原型只有任务状态与演示统计，不能证明真实请求输入、输出、附件和多租户授权可用。需要将客户端展示和 owner 真源读取分开交付，并保持源码、部署、授权、实际读取四级证据。\n\n## What Changes\n\n- 新增范围绑定的请求历史、详情与全查询汇总；未知值不得补零。\n- 业务正文按需读取、独立授权、先审计后读取；不新增生成或管理写操作。\n- 控制中心导航、固定工作区和多租户界面遵循 AdminCN 与 Aigora 交互。\n- 已有接口保持兼容；未记录的历史信息明确 not_recorded/needs_contract。\n\n## Capabilities\n\n### New Capabilities\n- \`control-center-request-visibility\`: 授权请求投影与独立内容读取。\n\n## Impact\n\n归属 split-owner。${owner} 仅维护自己的应用合同、类型与验证。控制中心不访问 owner 私有数据库，不持有领域状态、Provider adapter 或账本，不发布真实正文。\n`,
  );
  write(
    path.join(change, "design.md"),
    `# 设计与交接\n\n## Context\n\n正式客户端位于 client/yeisme-control-center；OpenDesign 始终为独立演示。浏览器通过同源服务端聚合层读取 owner 固定公开操作。\n\n## Decisions\n\n- 身份取 issuer+subject 的显式绑定，不按姓名或邮箱合并；owner 每次再次验证授权。\n- 默认近24小时，最多7天；分页与全范围汇总分离，游标绑定用户、项目及查询。\n- 网关调用、生成任务、执行尝试、产出分别统计。实际上传依 upload_ref 去重，引用资产不计上传字节；无法获取字节时返回 null。\n- 普通元数据不携带正文、密钥、内部提示、私有工具参数、Provider payload 或永久媒体地址。\n- 内容读取是带用途的受控操作，审计失败不得先读取内容；不采集、不回填历史正文。\n- 部分来源失败保留其他授权结果；来源覆盖与时间可见。\n\n## Current implementation boundary\n\n${owner === "Aigora" ? "复用已有调查、汇总与归档读取；新增只读 scope 对照端点。归档运行时、content grant 和委托认证需按实际部署验收。" : owner === "Sonora" ? "当前投影只覆盖可信 actor 所属 AudioJob；旧未绑定任务及其他音频任务族显式不计入全量。Sonora 当前无租户 claim，以 owner project 作为租户边界；控制中心维护显式租户映射。" : owner === "Eikona" ? "当前投影使用现有 run index，并要求 control-center.read purpose 和显式项目授权；最多扫描10000条索引记录，超限返回不可用而非伪全量。owner project 是此合同的租户边界。" : owner === "Scaena" ? "当前投影复用 ProjectForActor 和 ListRunsForActor；租户来自项目 OrganizationID，不接受浏览器自报租户。" : "完整交付须分别验收本地实现与日常内网。未配置 OIDC 和目标 owner 委托时 fail closed；不复制测试站点 Cookie。"}\n\n业务正文与附件传输需要 owner 明确的记录及授权合同。不存在的内容不从内部日志或文件系统猜取。缺口见本 owner 文档及客户端能力矩阵。\n\n## Rollout\n\n本地源代码和测试可先交付。日常服务部署、IdP 注册、授权与采集启用是独立操作，本轮未执行。回滚客户端可恢复上个 OpenDesign 入口；新增 owner GET 路由不改变旧接口。\n`,
  );
  write(
    path.join(change, "tasks.md"),
    `# 实施与验收\n\n## 1. 本地实现\n- [x] 1.1 明确 split-owner、现有合同与范围边界\n- [x] 1.2 实现本轮元数据、查询与界面变更\n- [x] 1.3 编写聚焦验证与错误状态\n- [ ] 1.4 完成全部聚焦测试及浏览器回归并登记证据\n\n## 2. 后续合同与真实环境\n- [ ] 2.1 补齐各任务族业务输入、输出、上传清单与附件授权读取\n- [ ] 2.2 验证现有 OIDC 客户端注册与各 owner 用户委托\n- [ ] 2.3 验证日常四服务范围化请求和内容读取\n- [ ] 2.4 分别登记源码、部署、授权、实际读取证据，不升级证据等级\n`,
  );
  write(
    path.join(change, "specs/control-center-request-visibility/spec.md"),
    `## ADDED Requirements\n\n### Requirement: Scoped request metadata\n系统 SHALL 仅展示当前可信身份在目标 owner 授权范围内的请求元数据，且原始状态与身份必须保留。\n\n#### Scenario: 同名成员跨租户\n- **WHEN** 两个租户存在同名成员或项目且调用者只获一个范围\n- **THEN** 搜索、分页、导出和详情均不得返回另一范围数据\n\n#### Scenario: 来源不可用\n- **WHEN** 一个 owner 读取失败\n- **THEN** 系统保留其他获授权来源，并显示失败来源与观察时间，不生成正常或零值\n\n### Requirement: Query-wide statistics\n系统 SHALL 使用完整授权筛选范围计算指标，不以当前分页替代全量。不同对象种类和币种分别统计。\n\n#### Scenario: 当前分页只有一条\n- **WHEN** 全查询匹配多条而第一页仅一条\n- **THEN** 汇总反映全查询范围；上传未知字节保持 null\n\n### Requirement: Controlled business content\n系统 SHALL 将业务正文读取与普通元数据查询分离，校验范围、用途、独立权限，并先持久化读取审计；没有合同或历史记录时保持明确缺失状态。\n\n#### Scenario: 内容读取权限失效\n- **WHEN** 权限被撤销或审计写入失败\n- **THEN** 不读取或显示正文，保留可理解的恢复状态，不重新生成请求\n\n### Requirement: Presentation and scope invalidation\n客户端 SHALL 在环境、租户、身份或权限改变时清除旧选择和内容，并拒绝旧范围迟到响应。\n\n#### Scenario: 工作区切换断点\n- **WHEN** 用户在右侧工作区查看对象并切换桌面到手机\n- **THEN** 同一合法对象可继续查看，关闭后恢复原列表位置；范围变化则立即清理\n`,
  );
  if (capabilities[owner])
    write(
      path.join(dir, doc),
      `# ${owner} 控制中心只读交接\n\n本轮变更：\`${id}\`。客户端只通过公开合同访问，不读取私有状态，不执行生成。\n\n## 接口\n\n${capabilities[owner].map((v) => "- `" + v + "`").join("\n")}\n\n## 证据与准入\n\n| 层级 | 当前状态 |\n| --- | --- |\n| 源码 | 本地新增元数据投影或 scope 核验；现有合同复用 |\n| 运行部署 | 本轮未部署 |\n| 用户授权 | 必须验证当前用户与目标 owner 的显式映射和权限 |\n| 真实读取 | 未作为已完成声明 |\n\n## 必须补齐\n\n1. 输入：用户业务文本、输入角色及附件列表；提交值与生效值分别提供。\n2. 关联：请求、任务、attempt、上传会话、资产均使用明确引用；禁止推断关联。\n3. 业务内容：需要独立授权及审计化读取；系统内部提示与 Provider 原始报文不得混入。\n4. 传输：附件需再次校验范围、类型、大小、有效期和完整性；不提供永久凭据。\n5. 组织：保留本 owner 角色与账号类型，现有事实不足时返回 needs_contract。\n\n## 客户端状态\n\ncomplete、partial、pending、unknown、not_recorded、forbidden、unavailable、expired、integrity_failed、needs_contract 不可混用。只读请求失败不重试生成。\n\n验收入口为当前 OpenSpec 的 tasks.md；运行测试与部署验证分开记录。\n`,
    );
}
console.log("Generated six owner-scoped OpenSpec artifact sets.");
