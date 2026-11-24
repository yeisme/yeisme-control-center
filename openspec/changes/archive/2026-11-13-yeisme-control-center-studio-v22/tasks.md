# 实施任务

- [x] 0.1 基线：工作区状态、受保护文件的指纹，记在 `temp/integration-test-runs/studio-v22-<ts>/v0/`。
- [x] 0.2 设计文档 `docs/design/studio-v22.md` 与本变更；`openspec validate yeisme-control-center-studio-v22 --strict --no-interactive`。
- [x] 1.1 纯函数分析：混音、桶、静音、削波、电平、FFT 频谱、`levelsAt`；可取消、分批让出主线程。
- [x] 1.2 缓存：离线解码、LRU 24、身份变化时清空、`useTrackAnalysis`。
- [x] 1.3 播放器在 Blob 读完后交给缓存，身份变化时清空。
- [x] 2.1 `AudioWaveform`：双层 canvas、`--played` 裁切、主题与尺寸重画、静音与削波标记。
- [x] 2.2 进度条换成波形；跳动条用真实电平；舞台的波形 / 频谱切换、事实行和标记跳转；减少动效时静止。
- [x] 3.1 声音站音频行与整列播放；资源库卡片、结果查看器的迷你波形与「播放后显示波形」。
- [x] 3.2 fixture：带静音和削波的 WAV，接到 Sonora 的一条结果并归到 ep-01。
- [x] 4.1 面板：切换后列表行跟随、保留阅读的那一节、节导航位置修正。
- [x] 4.2 `M` 最大化快捷键（可改键）；按钮提示与 `aria-keyshortcuts`。
- [x] 4.3 调宽读数与 ±12px 吸附到默认宽度。
- [x] 4.4 按测量打磨 7 项（设计文档 §5）；切换时没有测到闪空，P3 不做。
- [x] 5.1 单测：分析、缓存、fixture、keymap、吸附；旅程追加 4 项检查。
- [x] 6.1 回归、文档、视觉矩阵；受保护文件未改动。

```bash
cd client/yeisme-control-center
bun run typecheck
bun run test
bun run build
bun run test:app
I1_UI_PORT=4340 I1_API_PORT=4341 I1_OWNER_PORT=4342 bun run test:browser-journey   # 在私有网络命名空间里单独跑
bun run test:public-guide
CONTRACT_OWNER_PORT=4370 CONTRACT_API_PORT=4371 bun run test:contract-integration
bun run check:public-surface
VISUAL_LABEL=v22 bun run test:visual-matrix
openspec validate yeisme-control-center-studio-v22 --strict --no-interactive
```
