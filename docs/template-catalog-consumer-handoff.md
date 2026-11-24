# 模板目录消费者 owner handoff

## 目的

本文件是 `yeisme-control-center-drama-template-consumer-v1` 的最小 owner 交接，不是模板目录的第二份实现。Control Center 只消费公开的 body-free projection，并把 ref/plan 展示或复制给用户。

## 责任矩阵

| 项目 | canonical owner | Control Center 依赖 | 本项目禁止 |
| --- | --- | --- | --- |
| 公共模板 list/inspect/resolve/validate/preview；schema、revision、digest、snapshot、selector fail-closed | `shared/promptrepo` (`github.com/yeisme/promptrepo`) | 稳定的 body-free DTO、错误 code、selector 与 snapshot 语义 | 重建 resolver、validator、digest、TTL、stale 或 preview renderer |
| 发行、CAS、组织目录、审计 | `backend-server/template-registry` | 公开 HTTP/read adapter、分页、权限和 cursor 合同 | 读 `.template-registry`、CAS、私有目录或 Registry DB |
| production binding/review/readiness | Scaena | 只读 binding/ref/readiness projection | 创建 binding、提交 review、改变 owner 状态 |
| 消费和展示 | Control Center | 既有同源 API client、scope/epoch/error mapping | 持久化正文、prompt、artifact bytes、owner status |

## 需要 owner 明确的字段

Control Center 的 cell projection 需要 owner 合同明确下列字段来源和稳定语义：

- `template_ref`、`schema`、`version`、`revision`、`digest`、`snapshot`；
- `maturity`（首批三项逐项固定：30–60 秒漫剧实验为 `exploratory`，单场景冲突与角色一致性 demo 为 `needs_contract`，除非 owner 提供可证明的 body-free projection）；
- `compatibility`（schema、consumer、原因）；
- `rights`（scope、expiry、原因，或安全未知）；
- `status`、`stale`、`blockers`、`next_action`；
- body forbidden、permission denied、registry unavailable、cursor conflict、schema mismatch 的稳定 code 和安全 message；
- 有限 slot override 的允许键、类型、数量、长度及与单一 ref/revision/digest/snapshot 的绑定方式。

当前读取证据表明 promptrepo 已有 discovery / inspect / validate / preview 的实现基础，Registry 已有 `/v1/catalog` 只读路由和模板发现文档；但本 checkout 未发现用户所列的 `docs/template-catalog-http.md`、`internal/service/template_catalog.go`，也未确认公共 projection 已完整表达上述字段。因此以下项目保持 blocker：

1. promptrepo owner 需要发布或确认供消费者使用的 body-free schema 和错误合同；
2. Registry owner 需要发布稳定的 HTTP catalog read contract（分页、scope、权限、revision/snapshot/digest、cursor conflict）；
3. Scaena owner 需要说明 binding/review/readiness 的只读引用，不由 Control Center 推导；
4. Control Center 在上述合同就绪前不得实现 adapter/page 或复制缺失语义。

## 首批做剧 cell

每个首批 cell 只允许一个唯一 maturity。未得到 owner 公共合同的稳定 body-free 字段前，不实现或展示为可用。

| id | label | 唯一 maturity | 允许的展示/动作 | 生产含义 |
| --- | --- | --- | --- | --- |
| `drama-30-60s-experiment` | 30–60 秒漫剧实验 | `exploratory` | 仅 preview/plan；可复制安全 ref/版本化元数据 | 非 canonical、非 production |
| `drama-single-scene-conflict` | 单场景冲突 | `needs_contract` | 仅展示 blocker/next_action；不可用 | 在 owner 提供可证明的 body-free maturity projection 前，不实现 |
| `drama-character-consistency-demo` | 角色一致性 demo | `needs_contract` | 仅展示 blocker/next_action；不可用 | 在 owner 提供可证明的 body-free maturity projection 前，不实现 |

若 owner 合同已明确返回后两项的 body-free maturity projection，必须先更新本 change 的合同证据，再逐项固定为 owner 返回的唯一值；不得在 Control Center 推导。目录缺项时 Control Center 显示 `needs_contract` 或 owner 明确的 `unavailable`/`forbidden`，不内置正文、补推 maturity 或自行补项。

## 消费安全门

任何 list/inspect/resolve/validate/preview 消费都必须满足：

- `provider_calls=0`；
- `durable_writes=0`；
- 不触发付费、生成、accept、export、publish；
- 只展示或复制 refs/plan；
- 不保存正文、prompt、artifact bytes 或 owner 状态；
- stale、权限、cursor、schema 或正文禁止时 fail-closed。

## 交接后的验证边界

Control Center 仅负责本项目既有 Bun/TypeScript 测试、合同 fixture、浏览器 journey 和 `check:public-surface`。Owner 的 conformance、HTTP、发行、CAS、审计、binding/review/readiness 验收仍由各 owner 自己运行并交付证据；Control Center 不用假命令代替这些证据。本 change 不包含 Scaena、Registry、Provider、真实发布、部署、凭据、付费或真实联调。

本文路径相对于仓库根为 `client/yeisme-control-center/docs/template-catalog-consumer-handoff.md`；相对于 Control Center 项目根为 `docs/template-catalog-consumer-handoff.md`。
