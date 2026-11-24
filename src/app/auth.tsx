import { useEffect, useState, type FormEvent } from "react";
import { ArrowRight, BookOpen, CircleAlert, LoaderCircle, LockKeyhole, RefreshCw, ShieldCheck, Unplug } from "../icons";
import { useWorkspace } from "./workspace";
import { errorCode } from "../shared/api/control-center-client";
import { loginErrorText } from "./login-errors";
import { parsePastedControlInvite } from "../shared/url-invite";
import { BootSplash, hasBootSplash } from "./boot-splash";
import { publicGuideFromApp } from "../pages/guide/guide-location";
import { Button, Input, cx } from "../components/ui";
import { productionStations } from "../shared/production-line";
import { stationLabels } from "../shared/read-model/production";

/** The sign-in frame. The login screen adds the story panel on wide screens; problem screens stay a single card. */
function AuthFrame({ children, story = false }: { children: React.ReactNode; story?: boolean }) {
  const card = <div className="relative grid min-h-dvh place-items-center overflow-hidden bg-canvas px-4 py-10">
    <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 h-72 bg-[radial-gradient(60%_100%_at_50%_0%,color-mix(in_srgb,var(--accent)_22%,transparent),transparent)]" />
    <div className="page-enter relative w-full max-w-[400px]">{children}</div>
  </div>;
  if (!story) return card;
  return <div className="grid min-h-dvh lg:grid-cols-[minmax(0,1.05fr)_minmax(440px,1fr)]">
    <Story />
    {card}
  </div>;
}

/** What the studio is for, in type only: no stock picture stands in for anyone's work. */
function Story() {
  return <aside aria-label="Yeisme Studio 是做什么的" className="cover-type relative hidden flex-col justify-between overflow-hidden p-12 text-hero-ink lg:flex">
    <p className="text-[15px] font-semibold tracking-tight text-white/90">Yeisme Studio</p>
    <div className="rise">
      <p className="font-display text-hero font-semibold text-white">从一张图，<br />到一集漫剧。</p>
      <ol className="mt-8 flex max-w-xl flex-wrap gap-2" aria-label="制作线七站">
        {productionStations.map((id, index) => <li key={id} className="rounded-chip border border-white/15 bg-white/5 px-3 py-1 text-[13px] text-white/80"><span className="mr-1.5 tabular text-white/45">{index + 1}</span>{stationLabels[id].label}</li>)}
      </ol>
    </div>
    <p className="max-w-md text-body-sm text-white/65">人做决定，Agent 跑腿。要花钱的那一步，永远先问你。</p>
  </aside>;
}

function Brand() {
  return <div className="mb-6 flex items-center gap-3">
    <span className="grid size-10 place-items-center rounded-[12px] bg-surface-hero text-lg font-bold text-lime shadow-card">Y</span>
    <div className="leading-tight">
      <p className="text-[15px] font-semibold text-ink">Yeisme Studio</p>
      <p className="text-2xs text-muted">从一张图到一集漫剧</p>
    </div>
  </div>;
}

export function LoginScreen() {
  const { methods, login, redeemInvite, phaseCode } = useWorkspace();
  const [username, setUsername] = useState("");
  const [secret, setSecret] = useState("");
  const [remember, setRemember] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(() =>
    phaseCode && phaseCode !== "login_required" ? loginErrorText(phaseCode) : "",
  );
  const usernameRequired = methods?.username_required !== false;
  const keyRequired = methods?.key_required === true;
  const personal = methods?.personal !== false;

  useEffect(() => {
    if (phaseCode && phaseCode !== "login_required") {
      setError(loginErrorText(phaseCode));
    }
  }, [phaseCode]);

  const handleSmartPaste = (text: string): boolean => {
    const parsed = parsePastedControlInvite(text);
    if (!parsed) return false;
    if (parsed.kind === "invite_token") {
      if (parsed.username && !username) setUsername(parsed.username);
      setSecret(parsed.token);
      setPending(true);
      setError("");
      void redeemInvite(parsed.token)
        .then(() => setSecret(""))
        .catch((failure) => setError(loginErrorText(errorCode(failure))))
        .finally(() => setPending(false));
      return true;
    }
    if (parsed.username) setUsername(parsed.username);
    setSecret(parsed.accessKey);
    return true;
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    setError("");
    try {
      const parsedSecret = parsePastedControlInvite(secret);
      const parsedUser = username.includes("\n") || username.includes("token=") ? parsePastedControlInvite(username) : null;
      const parsed = parsedSecret || parsedUser;
      if (parsed?.kind === "invite_token") {
        await redeemInvite(parsed.token);
      } else if (parsed?.kind === "credentials") {
        await login({ username: (parsed.username || username).trim() || undefined, secret: parsed.accessKey, remember });
      } else {
        await login({ username: username.trim() || undefined, secret, remember });
      }
      setSecret("");
    } catch (failure) {
      const code = errorCode(failure);
      setError(loginErrorText(code));
    } finally {
      setPending(false);
    }
  };

  return <AuthFrame story>
    <Brand />
    <div className="rounded-[22px] border border-line/80 bg-panel p-6 shadow-float sm:p-7">
      <h1 className="font-display text-[26px] font-semibold leading-tight text-ink">回到你的创作台</h1>
      <p className="mt-2 text-[13px] leading-5 text-muted">输入账号与访问 Key，或直接粘贴管理员发给你的整段邀请口令 / 链接。</p>
      {personal ? <form className="mt-6 space-y-4" onSubmit={submit}>
        {usernameRequired && <label className="block space-y-1.5">
          <span className="text-[13px] font-medium text-ink-soft">用户名</span>
          <Input
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            onPaste={(event) => {
              const text = event.clipboardData?.getData("text");
              if (text && handleSmartPaste(text)) event.preventDefault();
            }}
            autoComplete="username"
            required={!secret.trim().startsWith("yki_live_")}
            autoFocus
          />
        </label>}
        <label className="block space-y-1.5">
          <span className="text-[13px] font-medium text-ink-soft">个人访问凭据</span>
          <Input
            type="password"
            value={secret}
            onChange={(event) => setSecret(event.target.value)}
            onPaste={(event) => {
              const text = event.clipboardData?.getData("text");
              if (text && handleSmartPaste(text)) event.preventDefault();
            }}
            autoComplete="current-password"
            required
            autoFocus={!usernameRequired}
            placeholder={keyRequired ? "访问 Key 或粘贴邀请口令" : "密码或邀请口令"}
          />
        </label>
        <label className="flex items-start gap-2 text-[13px] leading-5 text-ink-soft">
          <input className="mt-1" type="checkbox" checked={remember} onChange={(event) => setRemember(event.target.checked)} />
          <span>在此设备记住登录（最长 30 天，7 天未使用后仍会退出；凭据不会写入浏览器存储）</span>
        </label>
        {error && <p role="alert" className="flex items-start gap-2 rounded-[10px] bg-danger-soft px-3 py-2 text-[13px] text-danger"><CircleAlert className="mt-0.5 size-4 shrink-0" />{error}</p>}
        <Button type="submit" variant="primary" className="h-10 w-full justify-center" disabled={pending}>
          {pending ? <LoaderCircle className="size-4 motion-safe:animate-spin" /> : null}
          进入创作台
          {!pending && <ArrowRight className="size-4" />}
        </Button>
      </form> : <p className="mt-6 rounded-[10px] bg-panel-sunken px-3 py-3 text-[13px] text-muted">当前服务未开启个人登录。</p>}
      {methods?.oidc && <a href="/api/control-center/v1/auth/login" className="mt-3 flex h-10 w-full items-center justify-center gap-2 rounded-control border border-line text-sm font-medium text-ink hover:bg-panel-soft">
        <ShieldCheck className="size-4" />使用组织身份登录
      </a>}
    </div>
    <p className="mt-5 text-center text-[13px]"><a href="guide.html" className="inline-flex items-center gap-1.5 font-medium text-ink-soft underline-offset-4 hover:text-ink hover:underline"><BookOpen className="size-3.5" />使用指南（无需登录）</a></p>
    <p className="mt-6 flex items-start justify-center gap-1.5 text-center text-2xs leading-4 text-muted"><LockKeyhole className="mt-px size-3 shrink-0" />凭据只通过同源登录请求发送，不写入浏览器存储；会话 Cookie 为 HttpOnly，页面只读取已授权范围。</p>
  </AuthFrame>;
}

/** The guide is public: a signed-out visit to any of its in-app addresses goes to the same place on the public page. */
export function PublicGuideRedirect({ pathname, search }: { pathname: string; search: string }) {
  useEffect(() => { window.location.replace(publicGuideFromApp(pathname, search)); }, [pathname, search]);
  return <AuthLoading />;
}

/** While the session is checked the HTML boot splash stays on top; without it, render the same splash. */
export function AuthLoading() {
  const [splash] = useState(hasBootSplash);
  return splash ? <div className="min-h-dvh bg-canvas" aria-hidden="true" /> : <BootSplash />;
}

export function AuthProblem({ kind }: { kind: "forbidden" | "offline" }) {
  const { phaseCode } = useWorkspace();
  const forbidden = kind === "forbidden";
  // The session is fine but the server refuses what the page sends (see the stale-token handling in the workspace).
  const refusedWrites = forbidden && phaseCode === "csrf_denied";
  return <AuthFrame>
    <Brand />
    <div className="rounded-[18px] border border-line bg-panel p-6 shadow-float">
      <span className={cx("grid size-10 place-items-center rounded-full", forbidden ? "bg-danger-soft text-danger" : "bg-warning-soft text-warning")}>{forbidden ? <LockKeyhole className="size-5" /> : <Unplug className="size-5" />}</span>
      <h1 className="mt-4 text-lg font-semibold">{refusedWrites ? "服务端拒绝了本页发出的请求" : forbidden ? "当前身份无权访问" : "控制中心服务暂不可达"}</h1>
      <p className="mt-1.5 text-[13px] text-muted">{refusedWrites ? "登录状态本身没有问题，但服务端不接受页面的写请求。常见原因是反向代理去掉了 Origin 请求头，或访问地址与服务配置的来源不一致。请检查代理与访问地址后重新检查。" : forbidden ? "该身份没有绑定任何授权范围（identity_not_bound），请联系管理员或切换账号。" : "无法读取会话。请检查内网服务是否运行，稍后重试。"}</p>
      {phaseCode && <p className="mt-2 font-mono text-2xs text-faint">{phaseCode}</p>}
      <Button className="mt-5" icon={<RefreshCw className="size-4" />} onClick={() => window.location.reload()}>重新检查</Button>
    </div>
  </AuthFrame>;
}
