# 任务本地陈旧过期、通知直达和指南环境注入

## Why

网络中断或 owner 长时间没有更新时间时，控制中心会把任务一直显示为进行中；通知点击后也可能只打开任务列表，用户还要手动寻找。提示词历史整理还需要区分“未完成可重试”和“来源未配置”。

## What Changes

- 增加控制中心本地 freshness 投影：15 分钟 `stale`，2 小时 `expired`，不修改 owner 状态。
- 为 stale/expired 活动任务写入可恢复的 operation 通知，并保留原任务引用。
- 通知点击使用签名 task key 直达任务 Inspector；首批列表没有任务时按原 key 读取。
- 提示词历史整理按 owner 显示完成/未完成/未配置状态，并支持单 owner 重试。
- 指南中的控制中心命令统一使用 `YEISME_CONTROL_ORIGIN` shell 注入。
