import { useState, type FormEvent } from "react";
import { ArrowRight, CircleAlert, LoaderCircle, LockKeyhole, RefreshCw, ShieldCheck, Unplug } from "../icons";
import { useWorkspace } from "./workspace";
import { errorCode } from "../shared/api/control-center-client";
import { Button, Input, cx } from "../components/ui";

const loginErrors: Record<string, string> = {
  invalid_credentials: "用户名或凭据不正确。",
  login_rate_limited: "尝试次数过多，请 15 分钟后再试。",
  personal_login_unavailable: "当前服务未开启个人登录，或访问地址与服务配置的来源不一致。",
  origin_denied: "访问地址与服务配置的来源不一致。",
  session_capacity: "会话数量已达上限，请稍后再试。",
  invalid_login_request: "登录请求格式不正确。",
};

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
      setError(loginErrors[code] || `登录失败（${code}），请检查服务连接。`);
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
  </AuthFrame>;
}

export function AuthLoading() {
  return <AuthFrame>
    <div className="flex flex-col items-center gap-3 text-center">
      <LoaderCircle className="size-6 text-muted motion-safe:animate-spin" />
      <p className="text-sm text-muted">正在检查登录状态…</p>
    </div>
  </AuthFrame>;
}

export function AuthProblem({ kind }: { kind: "forbidden" | "offline" }) {
  const { phaseCode } = useWorkspace();
  const forbidden = kind === "forbidden";
  return <AuthFrame>
    <Brand />
    <div className="rounded-[18px] border border-line bg-panel p-6 shadow-float">
      <span className={cx("grid size-10 place-items-center rounded-full", forbidden ? "bg-danger-soft text-danger" : "bg-warning-soft text-warning")}>{forbidden ? <LockKeyhole className="size-5" /> : <Unplug className="size-5" />}</span>
      <h1 className="mt-4 text-lg font-semibold">{forbidden ? "当前身份无权访问" : "控制中心服务暂不可达"}</h1>
      <p className="mt-1.5 text-[13px] text-muted">{forbidden ? "该身份没有绑定任何授权范围（identity_not_bound），请联系管理员或切换账号。" : "无法读取会话。请检查内网服务是否运行，稍后重试。"}</p>
      {phaseCode && <p className="mt-2 font-mono text-2xs text-faint">{phaseCode}</p>}
      <Button className="mt-5" icon={<RefreshCw className="size-4" />} onClick={() => window.location.reload()}>重新检查</Button>
    </div>
  </AuthFrame>;
}
