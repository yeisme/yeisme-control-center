# v18.1 浏览器验收

脚本：`scripts/verify-design-v18.mjs`。

覆盖：

- 工作台 → 项目 → AI 图像 → 演示任务 → 任务状态 → 资源 → 版本审阅 → 交付清单。
- 项目六个 URL tab、四类能力表单和授权演示下载。
- 模型与工具目录的分类、接入状态和详情。
- 用量与成本的统一筛选、Recharts 趋势、项目归因和原始记录下钻。
- 1440、1280、768、390 像素宽度。
- 明暗主题、键盘焦点、移动端导航、减少动态效果和横向溢出。
- 无 POST、PUT、PATCH、DELETE 请求。
- 用量页面不显示发票、支付、余额或客户收费动作。
- 未采用版本不能自动显示为交付内容；结果未知保持未知。

```bash
cd /home/yeshugen/workplace/yeisme-agent/client/yeisme-control-center
bun run build
bun run serve:v18
```

另开终端执行：

```bash
cd /home/yeshugen/workplace/yeisme-agent/client/yeisme-control-center
bun run typecheck
bun run test
V18_URL=http://127.0.0.1:4313/workspace-v18.html bun run test:v18
```
