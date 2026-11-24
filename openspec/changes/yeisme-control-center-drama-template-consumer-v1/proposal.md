# 漫剧模板只读消费者 v1

## 为什么

漫剧实验页需要能够看见公共模板目录中“可被本控制中心消费的引用”和首批做剧 template cells，但控制中心当前没有一份明确的消费者合同。若直接在 Control Center 里拼装模板注册表、Prompt profile、缓存、搜索或解析逻辑，会复制 canonical owner 的状态、权限和安全边界，也会把实验性 cell 误标为可生产内容。

本变更只冻结 Control Center 的 additive、read-only 消费合同与后续任务：从 `shared/promptrepo` 的公共 body-free projection 读取目录元数据，经过既有 Control Center 同源 API/adapter 交给页面展示和复制 refs/plan。它不实现业务代码，不改变既有页面和接口，不调用 Provider，也不读取 `.template-registry` 或 Scaena DB。

## 做什么

- 冻结 body-free template catalog projection：`template_ref`、schema、version、revision、digest、snapshot、maturity、compatibility、rights、status、stale、blockers、`next_action`。
- 冻结首批三个做剧 template cells 的唯一 maturity：30–60 秒漫剧实验为 `exploratory`（仅 preview/plan）；单场景冲突与角色一致性 demo 为 `needs_contract`，除非 owner 已提供可证明的 body-free maturity projection；后两者不得实现或展示为可用。三者都不是 canonical 或 production 模板。
- 允许有限的 slot override（只替换合同声明的有限槽位），禁止笛卡尔组合、任意 selector 拼接和客户端自行 resolve/validate。
- 明确每次消费 `provider_calls=0`、`durable_writes=0`，不触发付费、生成、accept、export 或 publish。
- 为 registry unavailable、permission denied、stale、cursor conflict、schema mismatch、body forbidden 定义安全降级；页面只展示诊断和复制安全 refs/plan。
- 通过 owner handoff 记录现有公共合同缺口；若 `shared/promptrepo` 尚不足以表达 maturity/rights/status 或稳定 catalog projection，Control Center 不复制实现，而是阻塞在 owner contract。

## 不做什么

- 不实现 API、adapter、页面、缓存、搜索、解析、validator、digest、TTL、preview renderer 或数据库迁移。
- 不创建或维护 registry/profile/cache/search/resolve/validator/digest/stale/TTL/preview renderer 的第二份实现。
- 不读取模板正文、prompt、artifact bytes、`.template-registry`、Scaena DB、Provider payload 或 owner 状态；Control Center 不保存这些内容。
- 不修改 `shared/promptrepo`、`backend-server/template-registry`、Scaena 或 Provider；不做真实发布、部署、付费和生成。

## Owner 与交接

- `shared/promptrepo`（`github.com/yeisme/promptrepo`）是 public canonical contract owner，负责 body-free list/inspect/resolve/validate/preview、schema/revision/digest/snapshot 与 selector fail-closed。
- `backend-server/template-registry` 负责发行、CAS、组织目录和审计；Control Center 只消费它公开的目录合同，不读私有存储。
- Scaena 只拥有 production binding/review/readiness；本变更不把 template cell 晋升为 Scaena production binding。
- Control Center 是只读消费者和展示层，只保留 refs/plan 的临时页面投影和复制动作。

本 change 只在 `client/yeisme-control-center/openspec/` 与必要 owner handoff 文档中新增内容。实现、测试和真实 owner 验收须在后续任务和各 owner 的公开合同就绪后另行授权。
