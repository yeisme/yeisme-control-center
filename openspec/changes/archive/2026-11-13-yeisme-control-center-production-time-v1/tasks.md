# 实施任务

- [x] 1.1 `ProcessTiming` 类型；`server/task-connections.ts` 保留 `timing`
- [x] 1.2 `src/shared/production-time.ts`：汇总、`as_of`、剧集分组、最慢的 run；`formatSpan`
- [x] 1.3 制作线 `station.time` 和 `line.time`；缓存键 `production_line.v3`
- [x] 1.4 解析 Scaena 按集摘要的 `timing`，作为 `owner_total`
- [x] 2.1 `ProductionTime.tsx` 组件和 `production-time.css`
- [x] 2.2 接入单集工作台、工位卡、工位面板、剧集列表页、项目「制作」页
- [x] 3.1 夹具：三个 Scaena 任务带计时（停滞、等人、失败后重试）；ep-01 摘要带 `timing`，ep-02 不带
- [x] 3.2 单测：解析、汇总、`as_of`、制作线、按集摘要解析
- [x] 3.3 Scaena 本地变更 `scaena-control-center-production-timing-observation-v1`
- [x] 4.1 浏览器旅程加入耗时检查：108/111 通过（基线 106/110；新检查通过；3 项失败是已知的其他工作流问题：网关监控 1 项、桌面通知 2 项）
- [x] 4.2 截图：浅色和深色 × 390/1440（`temp/v25-shots/out/`）
- [x] 5.1 发布到内网：控制中心 2026-11-12 `control-release-2026-11-12T11-54-29-409Z`（迁移仍为 17，演练无变化，认证读取通过）；Scaena 未部署，真实环境的整集合计保持待接通
