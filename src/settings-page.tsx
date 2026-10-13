import { useState } from "react";
import { RadioGroup, Switch } from "./ui";
import {
  ArrowUpRight,
  Bell,
  Check,
  Monitor,
  Moon,
  Palette,
  Plug,
  Sun,
  BookOpen,
} from "./icons";
import { Button } from "./ui";
import { PageActions } from "./admin-ui";
import { CopyReference, PanelNotice } from "./workspace";

export function SettingsPage({
  theme,
  setTheme,
  collapsed,
  setCollapsed,
  onConnections,
}: {
  theme: string;
  setTheme: (v: string) => void;
  collapsed: boolean;
  setCollapsed: (v: boolean) => void;
  onConnections: () => void;
}) {
  const [tab, setTab] = useState("appearance");
  const entries = [
    { id: "appearance", label: "外观与浏览", icon: Palette },
    { id: "notifications", label: "通知", icon: Bell },
    { id: "connections", label: "连接与凭据", icon: Plug },
    { id: "about", label: "设计与交接", icon: BookOpen },
  ];
  return (
    <>
      <div className="settings-workbench">
        <nav aria-label="设置分组">
          {entries.map((e) => (
            <button
              key={e.id}
              aria-current={tab === e.id ? "page" : undefined}
              onClick={() => setTab(e.id)}
            >
              <e.icon size={16} />
              {e.label}
            </button>
          ))}
        </nav>
        <div className="settings-content">
          {tab === "appearance" && (
            <>
              <div className="settings-appearance">
                <div className="settings-section-heading">
                  <h3>外观</h3>
                  <p>选择适合当前环境的主题，修改即时生效。</p>
                </div>
                <RadioGroup.Root
                  className="theme-options"
                  value={theme}
                  onValueChange={setTheme}
                  aria-label="主题"
                >
                  {[
                    { id: "light", name: "浅色", icon: Sun },
                    { id: "dark", name: "深色", icon: Moon },
                    { id: "system", name: "跟随系统", icon: Monitor },
                  ].map((t) => (
                    <RadioGroup.Item
                      value={t.id}
                      className={"theme-option " + t.id}
                      key={t.id}
                      aria-label={t.name}
                    >
                      <span className="theme-preview">
                        <i />
                        <span>
                          <b />
                          <b />
                          <b />
                        </span>
                      </span>
                      <span>
                        <t.icon size={14} />
                        {t.name}
                        <RadioGroup.Indicator>
                          <Check size={13} />
                        </RadioGroup.Indicator>
                      </span>
                    </RadioGroup.Item>
                  ))}
                </RadioGroup.Root>
              </div>
              <div className="preference-line">
                <div>
                  <strong>紧凑导航</strong>
                  <p>收起文字标签，为表格与工作区留出更多空间。</p>
                </div>
                <Switch.Root
                  className="admin-switch"
                  checked={collapsed}
                  onCheckedChange={setCollapsed}
                  aria-label="收起左侧导航"
                >
                  <Switch.Thumb />
                </Switch.Root>
              </div>
              <div className="preference-line">
                <div>
                  <strong>表格与浏览偏好</strong>
                  <p>
                    在表格的“显示”菜单调整列和密度，使用“保存当前视图”保留筛选。
                  </p>
                </div>
                <span className="preference-value">按页面保存</span>
              </div>
              <div className="preference-line">
                <div>
                  <strong>动态效果</strong>
                  <p>
                    面板使用短距离淡入过渡；开启系统减少动态效果时直接显示最终状态。
                  </p>
                </div>
                <span className="preference-value">遵循系统</span>
              </div>
              <div className="preference-line">
                <div>
                  <strong>界面语言</strong>
                  <p>技术引用与 owner 状态保留原始名称。</p>
                </div>
                <span className="preference-value">简体中文</span>
              </div>
              <div className="preference-line">
                <div>
                  <strong>统计时区</strong>
                  <p>历史筛选、图表和导出使用相同时间口径。</p>
                </div>
                <span className="preference-value">Asia/Shanghai</span>
              </div>
            </>
          )}
          {tab === "notifications" && (
            <>
              <div className="settings-section-heading">
                <h3>通知</h3>
                <p>需要处理的事项集中显示在总览与审阅页面。</p>
              </div>
              {[
                {
                  title: "异常与未知结果",
                  text: "查看失败、阻塞与结果未知的原操作。",
                },
                {
                  title: "等待审阅与批准",
                  text: "费用确认与结果审阅分别显示。",
                },
                {
                  title: "操作结果",
                  text: "提交后展示明确回执，部分失败逐项列出。",
                },
              ].map((x) => (
                <div className="preference-line" key={x.title}>
                  <div>
                    <strong>{x.title}</strong>
                    <p>{x.text}</p>
                  </div>
                  <span className="preference-value">站内展示</span>
                </div>
              ))}
              <PanelNotice title="通知接入范围">
                邮件、手机推送和外部消息尚未接入。本原型不会发送真实通知。
              </PanelNotice>
            </>
          )}
          {tab === "connections" && (
            <>
              <div className="settings-section-heading">
                <h3>连接与凭据引用</h3>
                <p>这里只显示来源、配置状态和访问范围。</p>
              </div>
              <div className="connection-preview">
                <Plug size={22} />
                <div>
                  <strong>团队媒体读取</strong>
                  <p>credentialctl · 演示引用已配置</p>
                </div>
                <span className="connected-dot" />
              </div>
              <CopyReference value="credentialctl://team/media-read" />
              <dl className="admin-properties">
                <div>
                  <dt>来源</dt>
                  <dd>owner 侧凭据管理</dd>
                </div>
                <div>
                  <dt>访问范围</dt>
                  <dd>媒体服务的授权读取</dd>
                </div>
                <div>
                  <dt>浏览器状态</dt>
                  <dd>不持有服务密钥</dd>
                </div>
              </dl>
              <Button onClick={onConnections}>
                查看服务连接
                <ArrowUpRight size={14} />
              </Button>
            </>
          )}
          {tab === "about" && (
            <>
              <div className="settings-section-heading">
                <h3>设计与工程交接</h3>
                <p>admincn-v7 · 六入口工作区，所有业务记录均为合成示例。</p>
              </div>
              {[
                [
                  "本轮改造与截图对比",
                  "http://10.10.1.101:7456/api/projects/yeisme-service-control-center/raw/admincn-v7-review.html",
                ],
                ["视觉与组件规范", "docs/admincn-v7.md"],
                ["管理台与统计规格", "docs/admin-design.md"],
                ["全生态能力矩阵", "docs/capability-matrix.md"],
                ["多用户与请求接口交接", "docs/admin-interfaces.md"],
                ["浏览器验证记录", "docs/verification-v7.md"],
                [
                  "shadcn UI 来源与许可",
                  "docs/third-party/shadcn-ui-LICENSE.md",
                ],
                ["下载源码包", "source.zip"],
              ].map(([label, url]) => (
                <a
                  className="handoff-link"
                  key={url}
                  href={url.startsWith("http") ? url : "./" + url}
                  target="_blank"
                  rel="noreferrer"
                >
                  {label}
                  <ArrowUpRight size={15} />
                </a>
              ))}
            </>
          )}
        </div>
      </div>
    </>
  );
}
