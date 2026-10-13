## Why

现有右侧展开仍为1120px加宽面板，左右侧栏的对象图标、类别提示和动作反馈不足。需要保留AdminCN六入口，同时将右侧详情升级为可还原的全屏工作区。

## What Changes

- 六入口图标使用语义明确的Lucide，左侧展开/收起使用现有React Spring。
- 右侧显示对象图标，直接提供全屏展开/还原，并保留固定面板与草稿。
- 媒体使用低饱和类别色，控件与导航维持中性风格。
- 普通列表及权限逻辑保持，范围失效立即清除旧内容。

## Capabilities

### New Capabilities
- control-center-sidebar-motion：统一侧栏、类别图标与全屏详情。

### Modified Capabilities
无owner领域合同变更。

## Impact

fit：本轮能力属于客户端展示。领域身份、正文、资产与账本继续split-owner；不增加真实管理写入或生产部署。
