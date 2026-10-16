import { useEffect, useState } from "react";
import { Copy, LockKeyhole, LoaderCircle, Plus, UserRound } from "./icons";
import { Button, Pick } from "./ui";
import type { ControlCenterSession } from "./service-directory";

type UserRecord = { username: string; name: string; role: "admin" | "viewer"; scope_ids: string[]; enabled: boolean; created_at?: string };
type Props = { session: ControlCenterSession; csrf: string; revision: number };

export function PersonalUsersPage({ session, csrf, revision }: Props) {
  const [users, setUsers] = useState<UserRecord[]>([]);
  const [username, setUsername] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState<"admin" | "viewer">("viewer");
  const [scopeIds, setScopeIds] = useState<string[]>(session.scopes.map((scope) => scope.id));
  const [accessKey, setAccessKey] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const load = async () => {
    const response = await fetch("/api/control-center/v1/admin/personal-users", { credentials: "same-origin" });
    const body = await response.json();
    if (!response.ok) throw Error(body.error || "source_unavailable");
    setUsers(body.users || []);
  };
  useEffect(() => { void load().catch((reason) => setError(reason instanceof Error ? reason.message : "source_unavailable")); }, [revision]);

  const create = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true); setError(""); setNotice(""); setAccessKey("");
    try {
      const response = await fetch("/api/control-center/v1/admin/personal-users", {
        method: "POST", credentials: "same-origin",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf },
        body: JSON.stringify({ username, name, role, scope_ids: scopeIds }),
      });
      const body = await response.json();
      if (!response.ok) throw Error(body.error || "user_create_failed");
      setAccessKey(body.access_key || "");
      setNotice("用户已创建；访问 Key 只在这里显示一次，请通过受控渠道分发。");
      setUsername(""); setName(""); setRole("viewer");
      await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "user_create_failed"); }
    finally { setBusy(false); }
  };
  const revoke = async (user: UserRecord) => {
    if (!confirm(`确定停用 ${user.username}？现有会话会立即失效。`)) return;
    setError(""); setNotice("");
    const response = await fetch("/api/control-center/v1/admin/personal-users/" + encodeURIComponent(user.username) + "/revoke", {
      method: "POST", credentials: "same-origin", headers: { "X-CSRF-Token": csrf },
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) { setError(body.error || "user_revoke_failed"); return; }
    setNotice("用户已停用。"); await load();
  };
  return <div className="personal-users-page">
    <header className="provider-page-heading"><div><p className="eyebrow">团队与设置</p><h2>登录用户与访问 Key</h2><p>管理员创建用户并分发一次性 Key；服务端只保存 Key 哈希。</p></div><span className="provider-budget"><LockKeyhole size={16} />{users.filter((user) => user.enabled).length} 个启用用户</span></header>
    {error && <div className="provider-notice error">{error}</div>}
    {notice && <div className="provider-notice">{notice}</div>}
    {accessKey && <section className="personal-key-reveal" aria-label="新用户访问 Key"><div><strong>请立即分发这个 Key</strong><p>关闭页面后不会再次显示完整 Key。</p></div><code>{accessKey}</code><Button onClick={() => void navigator.clipboard?.writeText(accessKey)}><Copy size={15} />复制 Key</Button></section>}
    <div className="personal-users-grid">
      <form className="ui-card provider-form" onSubmit={create}>
        <div className="provider-form-title"><Plus size={17} /><h3>新建用户</h3></div>
        <label className="provider-field-label">用户名<input required pattern="[A-Za-z0-9][A-Za-z0-9_.-]{0,79}" value={username} onChange={(event) => setUsername(event.target.value)} placeholder="例如 editor-01" /></label>
        <label className="provider-field-label">显示名称<input required value={name} onChange={(event) => setName(event.target.value)} placeholder="例如 林晚" /></label>
        <Pick label="角色" value={role} onChange={(value) => setRole(value as "admin" | "viewer")} options={[{ value: "viewer", label: "只读成员" }, { value: "admin", label: "控制中心管理员" }]} />
        <fieldset className="personal-scope-picker"><legend>授权工作区</legend>{session.scopes.map((scope) => <label key={scope.id}><input type="checkbox" checked={scopeIds.includes(scope.id)} onChange={(event) => setScopeIds((current) => event.target.checked ? [...new Set([...current, scope.id])] : current.filter((id) => id !== scope.id))} />{scope.label}</label>)}</fieldset>
        <Button variant="primary" type="submit" disabled={busy || !scopeIds.length}>{busy ? <><LoaderCircle className="spin" size={15} />创建中</> : <><UserRound size={15} />创建用户并生成 Key</>}</Button>
      </form>
      <section className="ui-card personal-user-list"><div className="provider-form-title"><UserRound size={17} /><h3>已登记用户</h3></div>{users.length ? <table className="provider-directory-table"><thead><tr><th>用户</th><th>角色</th><th>范围</th><th>状态</th><th>操作</th></tr></thead><tbody>{users.map((user) => <tr key={user.username}><td><strong>{user.name}</strong><small>{user.username}</small></td><td>{user.role === "admin" ? "管理员" : "只读成员"}</td><td>{user.scope_ids.join(" · ")}</td><td>{user.enabled ? "启用" : "已停用"}</td><td>{user.enabled && user.username !== session.username && <Button variant="ghost" onClick={() => void revoke(user)}>停用</Button>}</td></tr>)}</tbody></table> : <p className="provider-empty">尚未创建用户 Key。</p>}</section>
    </div>
  </div>;
}
