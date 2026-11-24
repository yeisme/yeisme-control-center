# Design · Yeisme Studio v22

完整设计见 `docs/design/studio-v22.md`，包括测量表和结果。这里只记录实现上的决定。

## 边界

- 职责不变，仍是「观察 · 决定 · 交接」。
- 服务端、媒体合同和 CSP 不改；不新增依赖。
- `InspectorShell` 的 props 只增不改（新增可选的 `followRow`），各页保持兼容。
- 证据只记命令和计数，不放音频样本或分析数值。

## 决定

### D1 只用解码数据驱动可视化

不调用 `createMediaElementSource`。它会把唯一的播放元素改道进实时音频上下文：上下文一旦被挂起（自动播放策略、iOS 打断），声音就会静默，而且改道无法撤销。

改为用 `OfflineAudioContext(1, 1, 44100).decodeAudioData` 解码播放器已经持有的 Blob，预先算好所有数值，播放时按播放头位置查表。

### D2 只分析已经在内存里的音轨

`audio-player.tsx` 读完 Blob 后调用 `audioAnalysisCache.offer(key, blob)`。

- 不另外申请媒体句柄，也不多占传输名额。
- 超过 16MB、走 Range 流式播放的文件不分析。
- 身份变化（范围、会话、epoch）时调用 `clear()`，丢掉结果，也让进行中的分析作废。

### D3 分析算法（`src/shared/audio-analysis.ts`，纯函数）

1. 先混成单声道，再分 1024 个桶，求峰值和 RMS；同一遍里找削波（连续 3 个以上样本 ≥ 0.999，间隔 50ms 内合并）。
2. 按 10ms 窗口求 RMS，低于 -50 dBFS 且持续至少 0.4 秒记为静音段。
3. 降采样到约 11kHz，1024 点 Hann 窗基-2 FFT，最多 2048 帧，从 60Hz 到奈奎斯特频率按对数分 24 个频带，映射到 -80…0 dB。
4. 每 2^18 个样本、每 128 帧让出一次主线程；可以通过 `AbortSignal` 取消。

### D4 缓存（`src/app/audio-analysis-cache.ts`）

- 内存 LRU，最多 24 条，进行中的不淘汰。
- `useTrackAnalysis(key)` 通过 `useSyncExternalStore` 订阅；没有结果时返回共享的 `idle` 常量，避免无谓重渲染。
- 状态：`idle`、`analyzing`、`ready`、`unsupported`、`failed`。

### D5 绘制（`AudioWaveform`）

- 两张 canvas，内容相同：底层用基色，上层用强调色，并按外层的 `--played` 变量裁切。播放时只改 CSS 变量，不重画。
- 颜色取 canvas 自己计算后的 `color`，主题变化（`data-theme`、配色方案）和尺寸变化时重画，适配 DPR（最高 3）。
- 图形只是装饰（`aria-hidden`），滑杆语义仍在外层轨道上。

### D6 跳动条

有分析结果时，4 根柱的高度由 `levelsAt(analysis, currentTime, 4)` 写进 `--level`，不触发 React 渲染。只在播放中、页面可见且未开启减少动效时更新；否则静止。

### D7 面板切换

- `readingSection` 记下正文滚动时所在的那一节（`scrollTop < 24` 视为在顶部）。
- 条目变化时：新项有同一节就滚到那一节，否则回到顶部。数据晚到时，1.5 秒内这一节一出现就补一次；用户滚轮或触摸就放弃。
- 下一帧把 `followRow`（未传时用 `returnFocus`）指向的行以 `block: "nearest"` 滚进视野，只在停靠和浮动布局下做。滚动边距临时设成顶栏高度和底部 dock 高度，避免被盖住。
- 节导航改用 `getBoundingClientRect` 差值加 `scrollTop` 计算位置：正文的 `offsetParent` 是固定定位的外壳，原来的 `offsetTop` 会跳过头。

### D8 最大化快捷键与调宽

- keymap 新增 `inspector-maximize`，默认 `M`，可改键，`held`。它和 `G M` 序列不冲突，因为外壳的分发器会先对第二个键调用 preventDefault。
- `snappedInspectorWidth(width, viewport)`：距默认宽度 12px 内返回默认宽度，并给出 `chosen: null`（保存为「跟随默认」）。
- 拖动或键盘调宽后 1.2 秒内显示读数，失焦时隐藏。

### D9 打磨（按测量）

见设计文档 §5，共 7 项：
- 波形和频谱底色的对比度提到 ≥3:1；
- 切换按钮、标题按钮、手机上播放按钮的尺寸；
- 短音频标记精确到 0.1 秒；
- WAV 按原采样率解码（`wavSampleRate`），避免重采样过冲和错误的采样率。

### D10 fixture

`scripts/fixtures/audio-world.ts` 生成一段同长度的 16kHz WAV：前 30% 是音、30–60% 静音、60–75% 削波、其余是音。它替换 Sonora mj-21 的「片尾环境音乐」，并把这一条归到 ep-01，让声音站有音频可列。`world.ts` 只追加。
