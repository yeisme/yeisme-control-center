# 跨项目交接：请求信息与授权读取

## Why

控制中心原型只有任务状态与演示统计，不能证明真实请求输入、输出、附件和多租户授权可用。需要将客户端展示和 owner 真源读取分开交付，并保持源码、部署、授权、实际读取四级证据。

## What Changes

- 新增范围绑定的请求历史、详情与全查询汇总；未知值不得补零。
- 业务正文按需读取、独立授权、先审计后读取；不新增生成或管理写操作。
- 控制中心导航、固定工作区和多租户界面遵循 AdminCN 与 Aigora 交互。
- 已有接口保持兼容；未记录的历史信息明确 not_recorded/needs_contract。

## Capabilities

### New Capabilities
- `control-center-request-visibility`: 授权请求投影与独立内容读取。

## Impact

归属 split-owner。跨项目交接 仅维护自己的应用合同、类型与验证。控制中心不访问 owner 私有数据库，不持有领域状态、Provider adapter 或账本，不发布真实正文。

