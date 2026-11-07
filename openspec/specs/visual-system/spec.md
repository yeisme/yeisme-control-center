# visual-system Specification

## Purpose
TBD - created by archiving change yeisme-control-center-visual-system-v1. Update Purpose after archive.
## Requirements
### Requirement: readable source facts

The system MUST render owner and catalog enums through a shared label dictionary. The system MUST NOT show raw snake_case enums or JSON bodies as primary content. Raw JSON MAY appear only inside an explicit, collapsed disclosure.

#### Scenario: work item stage

- Given a work queue item whose stage is a snake_case code
- When the Inspector renders it
- Then the user sees a readable label.

### Requirement: container-driven lists

List tables MUST choose visible columns from their own container width, not from the viewport. The system MUST hide lower-priority columns before wrapping text one character per line.

#### Scenario: docked inspector

- Given a 1440px viewport with the right Inspector docked
- When the task or catalog list renders
- Then lower-priority columns are hidden and metadata does not wrap one character per line.

### Requirement: validated chart identity

Owner chart series MUST use the validated categorical palette in fixed order, both in light and dark themes. Status colors MUST NOT be reused as series colors, and chart text MUST stay in ink colors.

#### Scenario: four owners

- Given usage rows from Eikona, Scaena, Sonora and Aigora
- When the usage chart renders
- Then each owner keeps its own series color regardless of filtering.

### Requirement: accessible overlays

When the Inspector is modal (drawer or maximized), focus MUST move into the panel and Tab MUST cycle within it. Disabled actions MUST expose their reason to hover and keyboard focus.

#### Scenario: disabled submit

- Given the Provider submit gate is closed
- When a keyboard user focuses the disabled submit action
- Then the reason is announced through a tooltip.

### Requirement: v20 令牌沿用原名
视觉系统 SHALL 在 `src/styles/tokens.css` 原有变量名与 hex 格式上提供亮色「暖纸」与暗色「片场夜」两套值，并新增语义令牌；亮色状态色与其 soft 背景 MUST 保持原值，状态文字在 soft 背景及其悬停混色上 MUST 不低于 4.5:1。

#### Scenario: 对比度回归
- **WHEN** 运行令牌对比测试
- **THEN** 两套主题的 neutral、warning、info、danger、review 文字在静止与悬停时都不低于 4.5:1

### Requirement: 强调色只表达一件事
lime SHALL 只用于主行动的填充与品牌，暖色 SHALL 只表示「人的下一步」，状态色 SHALL 只表示状态；lime MUST NOT 作为浅色背景上的小号文字。

#### Scenario: 亮色主按钮
- **WHEN** 亮色主题渲染主按钮
- **THEN** 主按钮使用森林绿填充与白字，而不是 lime 文字

### Requirement: 动效可关
入场、悬停缓推与 hero 推近 SHALL 在 `prefers-reduced-motion: reduce` 下直接呈现最终状态；胶片颗粒 MUST NOT 拦截指针事件。

#### Scenario: 减少动态效果
- **WHEN** 系统开启减少动态效果
- **THEN** 页面没有位移动画，内容与状态更新不被动画延迟

