import { useEffect, useState } from "react";
import { BookOpen, LogIn, Monitor, Moon, Sun } from "../../icons";
import { ThemeProvider, useTheme, type ThemePreference } from "../../app-shell/theme";
import { GuideContent } from "./GuideContent";
import type { GuideClient } from "./guide-content";

const themeOptions: { id: ThemePreference; label: string; icon: typeof Sun }[] = [
  { id: "light", label: "浅色", icon: Sun },
  { id: "dark", label: "深色", icon: Moon },
  { id: "system", label: "跟随系统", icon: Monitor },
];

function ThemeSwitch() {
  const { preference, setPreference } = useTheme();
  return <div role="radiogroup" aria-label="主题" className="public-guide-theme">
    {themeOptions.map(({ id, label, icon: Icon }) => <button key={id} type="button" role="radio" aria-checked={preference === id} aria-label={label} title={label} onClick={() => setPreference(id)}><Icon className="size-4" /></button>)}
  </div>;
}

const readParams = () => new URLSearchParams(window.location.search);

/** The guide as a public page: no login, no session, no request to the control-center API. */
function PublicGuidePage() {
  const [params, setParams] = useState(readParams);
  useEffect(() => {
    const onPop = () => setParams(readParams());
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  // The choice stays in the address so a link can name a tool and a client, like the signed-in guide.
  const write = (key: "tool" | "client", value: string) => {
    const next = new URLSearchParams(params);
    next.set(key, value);
    window.history.replaceState(null, "", `${window.location.pathname}?${next.toString()}${window.location.hash}`);
    setParams(next);
  };
  return <div className="public-guide">
    <header className="public-guide-bar">
      <a href="guide.html" className="public-guide-brand">
        <span className="public-guide-mark" aria-hidden="true">Y</span>
        <span className="min-w-0"><strong>Yeisme</strong><span>使用指南</span></span>
      </a>
      <div className="flex items-center gap-2">
        <ThemeSwitch />
        <a href="./" className="public-guide-login"><LogIn className="size-4" />登录控制中心</a>
      </div>
    </header>
    <main className="public-guide-main">
      <GuideContent
        toolId={params.get("tool")}
        client={(params.get("client") === "codex" ? "codex" : "claude") as GuideClient}
        onTool={(id) => write("tool", id)}
        onClient={(id) => write("client", id)}
        link={{ label: "登录控制中心查看工具状态", href: "./" }}
        page="public-guide"
      />
    </main>
    <footer className="public-guide-footer"><BookOpen className="size-3.5" />这份指南公开可读；命令里的凭据都是占位符，真实凭据只写进你自己的用户级配置。</footer>
  </div>;
}

export function PublicGuide() {
  return <ThemeProvider><PublicGuidePage /></ThemeProvider>;
}
