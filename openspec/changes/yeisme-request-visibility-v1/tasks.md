# 实施与验收

## 1. 本地实现
- [x] 1.1 明确 split-owner、现有合同与范围边界
- [x] 1.2 实现本轮元数据、查询与界面变更
- [x] 1.3 编写聚焦验证与错误状态
- [x] 1.4 完成本轮聚焦测试及浏览器回归并登记证据

## 2. 后续合同与真实环境
- [ ] 2.1 补齐各任务族业务输入、输出、上传清单与附件授权读取
- [ ] 2.2 验证现有 OIDC 客户端注册与各 owner 用户委托
- [ ] 2.3 验证日常四服务范围化请求和内容读取
- [ ] 2.4 分别登记源码、部署、授权、实际读取证据，不升级证据等级

- [ ] 3.1 CONTRACT：对照已归档content-visibility-v2逐owner/任务族拆分输入输出上传清单及附件缺口；owner=Control Center；scope=本变更specs、docs/request-visibility.md与interfaces.md；依赖=既有归档合同与当前owners/app实现；lane=串行；验证=openspec validate yeisme-request-visibility-v1 --strict；预期=Eikona已有正文/附件与Scaena/Sonora缺附件分别记录，owner任务及用途/授权/审计清楚，不再重复实现已归档代码；失败=保留脱敏证据并归类，只重检失败切片，不改原键或升级证据
- [ ] 3.2 BACKEND：按owner新增附件合同补最小读取适配或明确needs_contract；owner=Control Center；scope=server/owners.ts、app.ts、media.ts与相关tests；依赖=3.1；Scaena/Sonora已发布且可测试的附件合同；lane=串行；验证=bun run test -- tests/attachments.test.ts tests/owners-delegation.test.ts tests/request-visibility.test.ts；预期=每次按用途鉴权与审计，缺少输入/输出归档显示not_recorded，禁止用Provider URL补齐；失败=保留脱敏证据并归类，只重检失败切片，不改原键或升级证据
- [ ] 3.3 INTEGRATION：补四owner真实请求/正文/附件与委托读取覆盖；owner=Control Center；scope=既有合法只读配置、现有验证runner与脱敏证据；依赖=3.1、3.2和各owner委托；不变更真实grant；lane=串行；验证=扩展既有bun run test:owner-live-read；bun run test:contract-integration；预期=源码/fixture/部署/授权/实际读取分别有据；原2.1-2.4据实关闭，未提供附件不能声明可读；失败=保留脱敏证据并归类，只重检失败切片，不改原键或升级证据
