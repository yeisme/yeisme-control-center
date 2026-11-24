# yeisme-control-center-studio-v22

Yeisme Studio v22 在 v21 的基础上补三件事：

- **音频可视化**：播放器解码已经读进内存的音轨，画出真实的波形和频谱，标出静音段和削波段，列出峰值和平均电平。跳动条跟着声音动。
- **音频进入各个界面**：声音站的音频结果改成可播放的行，资源库卡片和结果查看器显示迷你波形。
- **右侧面板（pane）**：切换上一项或下一项时，列表跟着滚动，阅读到的那一节保留；`M` 键最大化；拖宽时显示宽度，并吸附到默认宽度。

控制中心仍然只观察、决定、交接。音频分析只在本页内存里做，不额外读取，不持久化。

- 设计文档：[docs/design/studio-v22.md](../../../docs/design/studio-v22.md)
- 上一版：[yeisme-control-center-studio-v21](../archive/2026-11-07-yeisme-control-center-studio-v21/README.md)
