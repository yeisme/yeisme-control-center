# Yeisme Control Center 文档

- [当前实现状态](current-status.md)
- [内网运行与 HTTPS 部署边界](lan-deployment.md)
- [真实读取接入](live-read-integration.md)
- [Provider live 门禁](provider-live.md)
- [接口与 owner 边界](interfaces.md)
- [剧本到分镜控制中心接入](creative-flow-integration.md)
- [creative-flow owner integration v2](../openspec/changes/creative-flow-owner-integration-v2/README.md)
- [工作队列与跨项目交接 OpenSpec](../openspec/changes/yeisme-control-center-attention-handoff-v1/README.md)
- [前后端合同与阶段任务](../openspec/changes/yeisme-control-center-frontend-backend-v1/design.md)

Yeisme Control Center 是唯一正式前端产品。默认真实只读，读取失败不会静默回退到样例，owner 未提供的字段保持未知。
