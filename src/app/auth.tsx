import { useEffect, useState, type FormEvent } from "react";
import { ArrowRight, BookOpen, CircleAlert, LoaderCircle, LockKeyhole, RefreshCw, ShieldCheck, Unplug } from "../icons";
import { useWorkspace } from "./workspace";
import { errorCode } from "../shared/api/control-center-client";
import { loginErrorText } from "./login-errors";
import { BootSplash, hasBootSplash } from "./boot-splash";
import { publicGuideFromApp } from "../pages/guide/guide-location";
import { Button, Input, cx } from "../components/ui";

function AuthFrame({ children }: { children: React.ReactNode }) {
  return <div className="relative grid min-h-dvh place-items-center overflow-hidden bg-canvas px-4 py-10">
    <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 h-72 bg-[radial-gradient(60%_100%_at_50%_0%,color-mix(in_srgb,var(--accent)_22%,transparent),transparent)]" />
    <div className="page-enter relative w-full max-w-[400px]">{children}</div>
  </div>;
}

function Brand() {
  return <div className="mb-6 flex items-center gap-3">
    <span className="grid size-10 place-items-center rounded-[11px] bg-sidebar text-lg font-bold text-accent">Y</span>
    <div className="leading-tight">
      <p className="text-[15px] font-semibold text-ink">Yeisme Control Center</p>
      <p className="text-2xs text-muted">内容制作控制中心 · 真实只读</p>
    </div>
  </div>;
}

export function LoginScreen() {
  const { methods, login } = useWorkspace();
  const [username, setUsername] = useState("");
  const [secret, setSecret] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const usernameRequired = methods?.username_required !== false;
  const keyRequired = methods?.key_required === true;
  const personal = methods?.personal !== false;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    setError("");
    try {
      await login({ username: username.trim() || undefined, secret });
      setSecret("");
    } catch (failure) {
      const code = errorCode(failure);
      setError(loginErrorText(code));
    } finally {
      setPending(false);
    }
  };

  return <AuthFrame>
    <Brand />
    <div className="rounded-[18px] border border-line bg-panel p-6 shadow-float sm:p-7">
      <h1 className="text-xl font-semibold text-ink">进入团队工作空间</h1>
      <p className="mt-1.5 text-[13px] leading-5 text-muted">使用控制中心账号或管理员分发的访问 Key 登录。凭据只通过同源登录请求发送，不写入浏览器存储。</p>
      {personal ? <form className="mt-6 space-y-4" onSubmit={submit}>
        {usernameRequired && <label className="block space-y-1.5">
          <span className="text-[13px] font-medium text-ink-soft">用户名</span>
          <Input value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="username" required autoFocus />
        </label>}
        <label className="block space-y-1.5">
          <span className="text-[13px] font-medium text-ink-soft">个人访问凭据</span>
          <Input type="password" value={secret} onChange={(event) => setSecret(event.target.value)} autoComplete="current-password" required autoFocus={!usernameRequired} placeholder={keyRequired ? "访问 Key" : "密码"} />
        </label>
        {error && <p role="alert" className="flex items-start gap-2 rounded-[10px] bg-danger-soft px-3 py-2 text-[13px] text-danger"><CircleAlert className="mt-0.5 size-4 shrink-0" />{error}</p>}
        <Button type="submit" variant="primary" className="h-10 w-full justify-center" disabled={pending}>
          {pending ? <LoaderCircle className="size-4 motion-safe:animate-spin" /> : null}
          登录 Workspace
          {!pending && <ArrowRight className="size-4" />}
        </Button>
      </form> : <p className="mt-6 rounded-[10px] bg-panel-sunken px-3 py-3 text-[13px] text-muted">当前服务未开启个人登录。</p>}
      {methods?.oidc && <a href="/api/control-center/v1/auth/login" className="mt-3 flex h-10 w-full items-center justify-center gap-2 rounded-control border border-line text-sm font-medium text-ink hover:bg-panel-soft">
        <ShieldCheck className="size-4" />使用组织身份登录
      </a>}
    </div>
    <p className="mt-5 flex items-center justify-center gap-1.5 text-2xs text-muted"><LockKeyhole className="size-3" />会话 Cookie 为 HttpOnly；页面只读取已授权范围</p>
    <p className="mt-3 text-center text-[13px]"><a href="guide.html" className="inline-flex items-center gap-1.5 font-medium text-ink-soft underline-offset-4 hover:text-ink hover:underline"><BookOpen className="size-3.5" />使用指南（无需登录）</a></p>
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
