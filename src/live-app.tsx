import { taskListHash } from "./task-links";
import { controlRead as read } from "./control-api";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Activity,
  Box,
  ChevronRight,
  FileText,
  FolderOpen,
  LogIn,
  LogOut,
  Menu,
  Moon,
  PanelLeftOpen,
  RefreshCw,
  Search,
  Server,
  Settings2,
  ShieldCheck,
  Sun,
  Users,
  Wallet,
  ArrowLeft,
  ArrowRight,
  LockKeyhole,
} from "./icons";
import {
  AppShell,
  navigation,
  SectionNavigation,
  requestDetailTabs,
  OrganizationNavigation,
} from "./app-shell";
import { ScopePicker } from "./scope-picker";
import { TaskMonitor, type TaskViewState } from './task-monitor';
import { ServiceDirectoryPage } from "./service-directory-page";
import type { ControlCenterSession as Session } from "./service-directory";
import { Button, Empty, Pick, Badge, DropdownMenu } from "./ui";
import {
  AdminPanel,
  AdvancedFilters,
  AdminTabs,
  DataTable,
  SearchInput,
  type DataColumn,
} from "./admin-ui";
import { PanelNotice } from "./workspace";
import { RequestBody, RequestOverview } from "./request-content";
import {
  coverageLabels,
  owners,
  defaultRequestQuery,
  type Coverage,
  type RequestProjection,
  type RequestQuery,
  type RequestSummary,
  type ContentRead,
} from "./request-visibility";
const api = "/api/control-center/v1";
const errorLabels: Record<string, string> = {
  login_required: "请登录后查看获授权的请求",
  oidc_not_configured: "统一登录尚未配置",
  identity_not_bound: "当前身份尚未绑定控制中心访问范围",
  scope_not_found: "当前范围不可访问",
  source_unavailable: "数据来源暂不可用",
  delegation_unavailable: "owner 用户委托尚未接通",
  needs_contract: "owner 接口尚未部署",
  filter_needs_contract: "来源尚不支持该筛选条件",
  invalid_credentials: '用户名或密码不正确',
  login_rate_limited: '登录尝试过于频繁，请稍后再试',
};
const queryString = (scope: string, q?: RequestQuery) =>
  new URLSearchParams({
    scope,
    ...(q
      ? Object.fromEntries(Object.entries(q).map(([k, v]) => [k, String(v)]))
      : {}),
  }).toString();
export function LiveApp() {
  const taskViewState = useRef(new Map<string, TaskViewState>());
  const [session, setSession] = useState<Session | null>(null),
    [authState, setAuthState] = useState("loading"),
    [oidc, setOidc] = useState(false),
    [personal, setPersonal] = useState(false),
    [usernameRequired, setUsernameRequired] = useState(false),
    [username, setUsername] = useState(""),
    [password, setPassword] = useState(''),
    [loginBusy, setLoginBusy] = useState(false),
    [page, setPage] = useState(
      () => location.hash.match(/^#\/(\w+)/)?.[1] || "overview",
    ),
    [section, setSection] = useState("history"),
    [scope, setScope] = useState(""),
    [query, setQuery] = useState(defaultRequestQuery),
    [collapsed, setCollapsed] = useState(false),
    [mobile, setMobile] = useState(false),
    [dark, setDark] = useState(
      () => localStorage.getItem("yeisme.live.theme") === "dark",
    ),
    [selected, setSelected] = useState<RequestProjection | null>(null),
    [tab, setTab] = useState("概况"),
    [revision, setRevision] = useState(0),
    [data, setData] = useState<{
      key: string;
      rows: RequestProjection[];
      coverage: Coverage[];
      next_cursor?: string;
    } | null>(null),
    [summary, setSummary] = useState<{
      key: string;
      sources: {
        owner: string;
        summary?: RequestSummary;
        coverage?: Coverage;
      }[];
    } | null>(null),
    [org, setOrg] = useState<{ key: string; sources: any[] } | null>(null),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(false),
    [cursors, setCursors] = useState<string[]>([]);
  const epoch = useRef(0),
    activeScope = useRef(scope);
  activeScope.current = scope;
  const expireSession = useCallback(() => {
    epoch.current++;
    taskViewState.current.clear();
    setSession(null);
    setScope("");
    setSelected(null);
    setData(null);
    setSummary(null);
    setOrg(null);
    setPassword("");
    setLoading(false);
    setAuthState("login_required");
  }, []);
  useEffect(() => {
    const onHashChange = () => {
      setPage(location.hash.match(/^#\/(\w+)/)?.[1] || "overview");
      setSelected(null);
      setMobile(false);
    };
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);
  useEffect(() => {
    document.documentElement.dataset.theme = dark ? "dark" : "light";
    localStorage.setItem("yeisme.live.theme", dark ? "dark" : "light");
  }, [dark]);
  useEffect(() => {
    const c = new AbortController();
    read<{ oidc: boolean; personal?: boolean; username_required?: boolean }>("/auth/methods", c.signal)
      .then((v) => {
        if (c.signal.aborted) return;
        setOidc(v.oidc); setPersonal(v.personal === true); setUsernameRequired(v.username_required === true);
      })
      .catch(() => {});
    read<Session>("/session", c.signal)
      .then((v) => {
        if (c.signal.aborted) return;
        setSession(v);
        setScope(v.scopes[0]?.id || "");
        setAuthState("ready");
      })
      .catch((e) => {
        if (!c.signal.aborted) setAuthState(e.message);
      });
    return () => c.abort();
  }, []);
  const key = JSON.stringify([session?.identity, scope, query, revision]),
    current = data?.key === key ? data : null,
    stats = summary?.key === key ? summary : null,
    organization = org?.key === key ? org : null;
  useEffect(() => {
    setSelected(null);
    setData(null);
    setSummary(null);
    setOrg(null);
    setError("");
    if (!session || !scope || session.task_connections) {
      setLoading(false);
      return;
    }
    const c = new AbortController(),
      n = ++epoch.current;
    setLoading(true);
    const search = queryString(scope, query);
    Promise.allSettled([
      read<{
        rows: RequestProjection[];
        coverage: Coverage[];
        next_cursor?: string;
      }>("/requests?" + search, c.signal).then((v) => {
        if (n === epoch.current && !c.signal.aborted) setData({ ...v, key });
      }),
      read<{ sources: any[] }>(
        "/requests/summary?" +
          queryString(scope, { ...query, cursor: undefined }),
        c.signal,
      ).then((v) => {
        if (n === epoch.current && !c.signal.aborted) setSummary({ ...v, key });
      }),
      read<{ sources: any[] }>(
        "/organization?" + queryString(scope),
        c.signal,
      ).then((v) => {
        if (n === epoch.current && !c.signal.aborted) setOrg({ ...v, key });
      }),
    ]).then((results) => {
      if (c.signal.aborted || n !== epoch.current) return;
      const failed = results.find((v) => v.status === "rejected");
      if (failed?.status === "rejected") {
        const code = failed.reason?.message || "source_unavailable";
        if (["login_required", "identity_not_bound"].includes(code)) expireSession();
        else setError(code);
      }
      setLoading(false);
    });
    return () => {
      c.abort();
      epoch.current++;
    };
  }, [key]);
  const changeScope = (value: string) => {
    epoch.current++;
    setSelected(null);
    setData(null);
    setSummary(null);
    setOrg(null);
    setCursors([]);
    setQuery((q) => ({ ...q, cursor: undefined }));
    setScope(value);
  };
  const navigate = (id: string, next?: string) => {
    setSelected(null);
    setPage(id);
    if (next) setSection(next);
    setMobile(false);
    history.replaceState(null, "", "#/" + id);
  };
  const update = (value: RequestQuery) => {
    setSelected(null);
    setCursors([]);
    setQuery({ ...value, cursor: undefined });
  };
  const selectedScope = session?.scopes.find((s) => s.id === scope),
    currentNav = navigation.find((n) => n.id === page) || navigation[0];
  const rows = (current?.rows || []).filter((r) =>
    section === "queue"
      ? ["queued", "running", "unknown", "waiting_review"].includes(r.state)
      : section === "generation"
        ? r.kind === "generation"
        : true,
  );
  const columns: DataColumn<RequestProjection>[] = [
    {
      id: "title",
      label: "请求 / 任务",
      primary: true,
      width: 240,
      value: (r) => r.title,
      render: (r) => (
        <div className="record-title">
          <span>
            <strong>{r.title || r.id}</strong>
            <small>{r.id}</small>
          </span>
        </div>
      ),
    },
    {
      id: "time",
      label: "发起时间",
      value: (r) => r.created_at,
      render: (r) => (
        <span className="muted tabular">
          {r.created_at
            ? new Date(r.created_at).toLocaleString("zh-CN", {
                timeZone: "Asia/Shanghai",
              })
            : "未知"}
        </span>
      ),
    },
    { id: "owner", label: "服务", value: (r) => r.owner },
    { id: "actor", label: "调用者", value: (r) => r.actor || "未提供" },
    { id: "project", label: "项目", value: (r) => r.project },
    {
      id: "state",
      label: "状态",
      value: (r) => r.state,
      render: (r) => <Badge state={r.state} />,
    },
    { id: "input", label: "输入", value: (r) => coverageLabels[r.input] },
    {
      id: "duration",
      label: "耗时",
      value: (r) => (r.duration_ms === null ? "未知" : r.duration_ms + " ms"),
    },
  ];
  const select = async (r: RequestProjection) => {
    setSelected(r);
    setTab("概况");
    const n = epoch.current;
    try {
      const detail = await read<RequestProjection>(
        "/requests/" +
          r.owner +
          "/" +
          encodeURIComponent(r.id) +
          "?" +
          queryString(scope),
      );
      if (epoch.current === n && activeScope.current === scope)
        setSelected((old) =>
          old?.id === r.id && old?.owner === r.owner ? detail : old,
        );
    } catch {
      /* Keep the explicitly partial, authorized list projection. */
    }
  };
  const filters = (
    <>
      <SearchInput
        value={query.search}
        onChange={(search) => update({ ...query, search })}
        label="搜索请求、项目或引用"
      />
      <Pick
        label="查询时间范围"
        value={String(
          Math.round(
            (Date.parse(query.to) - Date.parse(query.from)) / 86400000,
          ),
        )}
        onChange={(v) =>
          update({
            ...query,
            from: new Date(
              Date.parse(query.to) - Number(v) * 86400000,
            ).toISOString(),
          })
        }
        options={[
          { value: "1", label: "近 24 小时" },
          { value: "7", label: "近 7 天" },
        ]}
      />
      <Pick
        label="请求状态"
        value={query.state}
        onChange={(state) => update({ ...query, state })}
        options={["all", "succeeded", "failed", "running", "unknown"].map(
          (value) => ({
            value,
            label: (
              {
                all: "全部状态",
                succeeded: "成功",
                failed: "失败",
                running: "运行中",
                unknown: "结果未知",
              } as any
            )[value],
          }),
        )}
      />
      <AdvancedFilters
        count={
          [
            query.owner,
            query.input_type,
            query.attachments,
            query.outputs,
          ].filter((v) => v !== "all").length
        }
      >
        <Pick
          label="服务筛选"
          value={query.owner}
          onChange={(owner) => update({ ...query, owner })}
          options={[
            { value: "all", label: "全部服务" },
            ...owners.map((value) => ({ value, label: value })),
          ]}
        />
        <Pick
          label="输入类型"
          value={query.input_type}
          onChange={(input_type) => update({ ...query, input_type })}
          options={["all", "text", "image", "audio", "video"].map((value) => ({
            value,
            label: (
              {
                all: "全部输入",
                text: "文本",
                image: "图像",
                audio: "音频",
                video: "视频",
              } as any
            )[value],
          }))}
        />
        <Pick
          label="附件筛选"
          value={query.attachments}
          onChange={(attachments) => update({ ...query, attachments })}
          options={[
            { value: "all", label: "全部附件状态" },
            { value: "yes", label: "有附件" },
            { value: "no", label: "无关联附件" },
          ]}
        />
        <Pick
          label="产出筛选"
          value={query.outputs}
          onChange={(outputs) => update({ ...query, outputs })}
          options={[
            { value: "all", label: "全部产出" },
            { value: "yes", label: "有产出" },
            { value: "no", label: "无关联产出" },
          ]}
        />
      </AdvancedFilters>
    </>
  );
  const coverage = (
    <div className="source-coverage">
      {(
        current?.coverage ||
        owners.map((owner) => ({
          owner,
          state: "unavailable" as const,
          observed_at: "",
          reason: "尚未读取",
        }))
      ).map((c) => (
        <div key={c.owner}>
          <span className={"source-dot " + c.state} />
          <strong>{c.owner}</strong>
          <span>{coverageLabels[c.state]}</span>
          <small>{errorLabels[c.reason || ""] || c.reason}</small>
        </div>
      ))}
    </div>
  );
  let content;
  if (session && page === "services")
    content = <ServiceDirectoryPage key={scope} scope={scope} revision={revision} onSessionExpired={expireSession} onTasks={(connection, project) => { location.hash = connection && project ? taskListHash(connection, project) : "#/tasks"; }} />;
  else if (session?.task_connections && ['overview','tasks','assets'].includes(page))
    content = <TaskMonitor viewState={taskViewState} key={scope + ":" + page} scope={scope} csrf={session.csrf} page={page} revision={revision} onSessionExpired={expireSession}/>;
  else if (page === "settings")
    content = (
      <div className="settings-workbench">
        <AdminTabs
          value="connection"
          onChange={() => {}}
          items={[{ id: "connection", label: "连接与身份" }]}
        />
        <div className="settings-content">
          <section className="preference-line">
            <div>
              <h3>{personal ? "个人账号" : "统一登录"}</h3>
              <p>{personal ? "仅用于控制中心的具名个人会话，不是服务密钥。" : "独立同源会话，复用已有 OIDC 身份。"}</p>
            </div>
            <div>
              <Badge state="configured" label={session?.role === "admin" ? "最高管理员（控制中心）" : "只读成员"} />
              <p>{session?.username || session?.name || "尚未登录"}</p>
            </div>
          </section>
          <section className="preference-line">
            <div>
              <h3>外观</h3>
              <p>偏好只保存于当前浏览器。</p>
            </div>
            <Button onClick={() => setDark(!dark)}>
              {dark ? "切换浅色" : "切换深色"}
            </Button>
          </section>
          <section className="preference-line">
            <div>
              <h3>数据与权限</h3>
              <p>内容按需授权；取消只在管理员、本地意愿和 owner 合同均允许时开放。管理员不绕过领域权限。</p>
            </div>
            <a className="button" href="?mode=demo#/settings">
              打开独立设计演示
            </a>
          </section>
        </div>
      </div>
    );
  else if (page === "members" && session?.task_connections)
    content = <div className="space-y-5">
      <h2 className="text-xl font-semibold">个人工作区与权限</h2>
      <section className="rounded-xl border p-4 space-y-3">
        <h3 className="font-semibold">{session.username || session.name}</h3>
        <Badge state="configured" label={session.role === "admin" ? "最高管理员（控制中心）" : "只读成员"} />
        <p className="text-sm text-muted-foreground">角色由服务端配置决定；没有自助注册或隐式成员邀请。</p>
        <dl className="grid gap-2 text-sm"><dt>已授权工作区</dt><dd>{session.scopes.map(s => s.label).join("、") || "尚无范围"}</dd></dl>
      </section>
      <PanelNotice title="控制中心角色不等于服务管理员">每个服务仍独立校验身份、项目、内容读取和受控动作。团队邀请、角色与配额写入尚未接入，不模拟成功。</PanelNotice>
    </div>;
  else if (page === "members")
    content = (
      <>
        <OrganizationNavigation value={section} onChange={setSection} />
        {section === "invitations" && (
          <PanelNotice title="邀请记录尚未接入">
            真实成员管理当前只读；不会将邀请创建显示为邮件已发送。
          </PanelNotice>
        )}
        {section === "tenants" && (
          <DataTable
            id="live.tenant-scopes"
            label="租户目录"
            rows={[
              ...new Map(
                (session?.scopes || []).map((s) => [
                  s.tenant,
                  {
                    id: s.tenant,
                    scopes: session!.scopes.filter(
                      (x) => x.tenant === s.tenant,
                    ),
                  },
                ]),
              ).values(),
            ]}
            columns={[
              { id: "name", label: "租户", primary: true, value: (r) => r.id },
              {
                id: "scopes",
                label: "获授权范围",
                value: (r) => r.scopes.length,
                numeric: true,
              },
              {
                id: "owners",
                label: "服务授权",
                value: (r) =>
                  [...new Set(r.scopes.flatMap((x) => x.owners))].join(" · ") ||
                  "未提供",
              },
            ]}
            onOpen={(r) => changeScope(r.scopes[0].id)}
            coverage="当前会话授予的范围"
          />
        )}
        {section === "teams" && (
          <DataTable
            id={"live.teams." + scope}
            label="已授权团队引用"
            rows={[
              ...new Map(
                (session?.scopes || [])
                  .filter((s) => s.tenant === selectedScope?.tenant && s.team)
                  .map((s) => [
                    s.tenant + ":" + s.team,
                    {
                      id: s.tenant + ":" + s.team,
                      team: s.team,
                      tenant: s.tenant,
                    },
                  ]),
              ).values(),
            ]}
            columns={[
              {
                id: "team",
                label: "团队引用",
                primary: true,
                value: (r) => r.team,
              },
              { id: "tenant", label: "租户", value: (r) => r.tenant },
            ]}
            coverage="仅会话范围引用，完整团队目录尚未接入"
          />
        )}
        {section === "access" && (
          <DataTable
            id={"live.access." + scope}
            label="访问授权"
            rows={(organization?.sources || [])
              .flatMap((s) => s.members || [])
              .map((m: any) => ({
                ...m,
                original_id: m.id,
                id: m.owner + ":" + m.id,
              }))}
            columns={[
              {
                id: "name",
                label: "成员",
                primary: true,
                value: (r: any) => r.name,
              },
              { id: "owner", label: "权限来源", value: (r: any) => r.owner },
              {
                id: "role",
                label: "原始角色",
                value: (r: any) => r.role || "未提供",
              },
              {
                id: "team",
                label: "团队范围",
                value: (r: any) => r.team || "未提供",
              },
            ]}
            coverage="owner 返回的授权投影"
          />
        )}
        {["members", "accounts"].includes(section) && (
          <DataTable
            id={"live.members." + scope}
            coverage="当前已读取的 owner 成员投影"
            exportScope="batch"
            label={section === "accounts" ? "服务账号" : "成员列表"}
            rows={(organization?.sources || [])
              .flatMap((s) => s.members || [])
              .filter((m) =>
                section === "accounts"
                  ? m.type === "service"
                  : m.type !== "service",
              )
              .map((m: any) => ({
                ...m,
                original_id: m.id,
                id: m.owner + ":" + m.id,
              }))}
            columns={[
              {
                id: "name",
                label: "成员",
                primary: true,
                value: (r: any) => r.name,
                render: (r: any) => (
                  <div className="record-title">
                    <span>
                      <strong>{r.name}</strong>
                      <small>
                        {r.owner} · {r.original_id}
                      </small>
                    </span>
                  </div>
                ),
              },
              {
                id: "owner",
                label: "来源",
                value: (r: any) => r.owner,
                hidden: true,
              },
              { id: "role", label: "原始角色", value: (r: any) => r.role },
              { id: "team", label: "团队", value: (r: any) => r.team },
              {
                id: "binding",
                label: "身份绑定",
                hidden: true,
                value: (r: any) =>
                  r.binding === "verified" ? "可信绑定" : "未绑定",
              },
            ]}
          />
        )}
        {section === "quotas" && (
          <PanelNotice title="配额读取合同尚未接入">
            配置值、已生效限制和实际用量分别读取；不把未知额度显示为零。
          </PanelNotice>
        )}
        <div className="source-coverage">
          {organization?.sources
            .filter((s) => s.state !== "complete")
            .map((s) => (
              <div key={s.owner}>
                <strong>{s.owner}</strong>
                <span>
                  {coverageLabels[s.state as keyof typeof coverageLabels] ||
                    "来源不可用"}
                </span>
              </div>
            ))}
        </div>
      </>
    );
  else if (page === "tasks")
    content = (
      <>
        <AdminTabs
          value={section}
          onChange={setSection}
          items={[
            { id: "queue", label: "运行队列" },
            { id: "history", label: "请求历史" },
            { id: "generation", label: "生成记录" },
          ]}
        />
        <DataTable
          id={"live.requests." + scope}
          label={
            section === "history"
              ? "请求历史"
              : section === "queue"
                ? "运行队列"
                : "生成记录"
          }
          rows={rows.map((r) => ({
            ...r,
            original_id: r.id,
            id: r.owner + ":" + r.id,
          }))}
          columns={columns}
          coverage="当前授权来源返回的有界批次"
          exportScope="batch"
          filters={filters}
          onOpen={(r) => select({ ...r, id: r.original_id })}
        />
        <div className="remote-pagination">
          <span>
            每个来源最多 {query.limit} 条 · 当前批次 {rows.length} 条
          </span>
          <Pick
            label="来源批次大小"
            value={String(query.limit)}
            onChange={(v) => update({ ...query, limit: Number(v) })}
            options={[25, 50, 100].map((v) => ({
              value: String(v),
              label: v + " 条",
            }))}
          />
          {cursors.length > 0 && (
            <Button
              onClick={() => {
                const stack = [...cursors];
                const prev = stack.pop();
                setCursors(stack);
                setQuery((q) => ({ ...q, cursor: prev || undefined }));
              }}
            >
              上一批
            </Button>
          )}
          {current?.next_cursor && (
            <Button
              onClick={() => {
                setCursors([...cursors, query.cursor || ""]);
                setQuery((q) => ({ ...q, cursor: current.next_cursor }));
              }}
            >
              下一批
            </Button>
          )}
        </div>
        {coverage}
      </>
    );
  else if (["overview", "usage"].includes(page))
    content = (
      <>
        <div className="live-section-toolbar">
          <Pick
            label="统计时间范围"
            value={String(
              Math.round(
                (Date.parse(query.to) - Date.parse(query.from)) / 86400000,
              ),
            )}
            onChange={(v) =>
              update({
                ...query,
                from: new Date(
                  Date.parse(query.to) - Number(v) * 86400000,
                ).toISOString(),
              })
            }
            options={[
              { value: "1", label: "近 24 小时" },
              { value: "7", label: "近 7 天" },
            ]}
          />
          <span className="muted">Asia/Shanghai · 来源分别统计</span>
        </div>
        <div className="live-metric-grid">
          {[
            ["gateway", "网关调用"],
            ["generation", "生成任务"],
            ["attempts", "执行尝试"],
            ["outputs", "产出"],
            ["uploaded_files", "上传文件"],
            ["uploaded_bytes", "实际上传字节"],
          ].map(([metric, label]) => (
            <section className="ui-card live-metric" key={metric}>
              <span>{label}</span>
              {stats?.sources.map((s) => (
                <button
                  key={s.owner}
                  onClick={() => {
                    update({ ...query, owner: s.owner });
                    navigate("tasks", "history");
                  }}
                >
                  <small>{s.owner}</small>
                  <strong>{(s.summary as any)?.[metric]?.value ?? "—"}</strong>
                </button>
              )) || <strong>—</strong>}
              <small>缺失值不计为零</small>
            </section>
          ))}
        </div>
        {coverage}
        <DataTable
          id={"live.recent." + scope}
          label="最近请求"
          rows={(current?.rows || []).slice(0, 6).map((r) => ({
            ...r,
            original_id: r.id,
            id: r.owner + ":" + r.id,
          }))}
          columns={columns.slice(0, 4)}
          onOpen={(r) => select({ ...r, id: r.original_id })}
        />
      </>
    );
  else if (page === "services")
    content = (
      <>
        <div className="ui-card">
          <div className="ui-card-header">
            <h2>服务接入状态</h2>
          </div>
          {coverage}
        </div>
        <PanelNotice title="连接、身份与数据权限分别核验">
          服务在线不代表有权读取请求正文。当前用户与 owner 授权取交集。
        </PanelNotice>
      </>
    );
  else if (page === "projects")
    content = (
      <div className="tenant-grid">
        {session?.scopes.map((s) => (
          <article className="tenant-access-card" key={s.id}>
            <FolderOpen size={20} />
            <h3>{s.label}</h3>
            <p>
              {s.tenant} / {s.project}
            </p>
            <Button
              onClick={() => {
                changeScope(s.id);
                navigate("tasks", "history");
              }}
            >
              查看项目请求
            </Button>
          </article>
        ))}
      </div>
    );
  else
    content = (
      <Empty
        title="此范围的读取接口尚未接入"
        description="保留专业工作台的能力归属；真实数据不会由设计样例替代。"
      />
    );
  return (
    <AppShell
      page={page}
      collapsed={collapsed}
      mobile={mobile}
      onCollapse={() => setCollapsed(!collapsed)}
      onMobile={setMobile}
      onNavigate={(id) => navigate(id)}
      identity={session?.identity || "anonymous"}
      scope={
        <ScopePicker
          summary={
            selectedScope
              ? `${selectedScope.tenant} / ${selectedScope.label}`
              : "未登录 · 真实模式"
          }
          environment={
            selectedScope
              ? selectedScope.environment || "环境未提供"
              : undefined
          }
        >
          {" "}
          {session && session.scopes.length > 0 ? (
            <Pick
              label="租户与项目范围"
              value={scope}
              onChange={changeScope}
              options={session.scopes.map((s) => ({
                value: s.id,
                label: s.tenant + " / " + s.label,
              }))}
            />
          ) : (
            <span className="muted">尚未建立授权范围</span>
          )}
        </ScopePicker>
      }
      actions={
        <>
          {" "}
          <button
            className="icon-button"
            aria-label="刷新"
            onClick={() => setRevision((v) => v + 1)}
          >
            <RefreshCw size={17} />
          </button>
          <button
            className="icon-button"
            aria-label="切换主题"
            onClick={() => setDark(!dark)}
          >
            {dark ? <Moon size={18} /> : <Sun size={18} />}
          </button>
          {session && (
            <DropdownMenu.Root>
              <DropdownMenu.Trigger
                className="account-trigger"
                aria-label="账户菜单"
              >
                <span>{session.name.slice(0, 1)}</span>
                <i />
              </DropdownMenu.Trigger>
              <DropdownMenu.Portal>
                <DropdownMenu.Content className="admin-menu" align="end">
                  <DropdownMenu.Label>
                    {session.username || session.name} · {session.role === "admin" ? "最高管理员" : "只读成员"}
                  </DropdownMenu.Label>
                  <DropdownMenu.Item
                    className="admin-menu-item"
                    onSelect={() => navigate("settings")}
                  >
                    个人设置
                  </DropdownMenu.Item>
                  <DropdownMenu.Item
                    className="admin-menu-item"
                    onSelect={async () => {
                      try {
                        await read("/auth/logout", undefined, {
                          method: "POST", headers: { "X-CSRF-Token": session.csrf },
                        });
                        expireSession();
                      } catch (reason) {
                        const code = reason instanceof Error ? reason.message : "source_unavailable";
                        if (["login_required", "identity_not_bound"].includes(code)) expireSession();
                        else setError("退出未确认，请重试；服务端会话可能仍有效。");
                      }
                    }}
                  >
                    退出登录
                  </DropdownMenu.Item>
                </DropdownMenu.Content>
              </DropdownMenu.Portal>
            </DropdownMenu.Root>
          )}
        </>
      }
      footer={
        <a href="?mode=demo">
          <Box size={16} />
          <span>设计演示与交接</span>
        </a>
      }
    >
      <div className="content-layout">
        <main className={"main page-" + page}>
          <h1 className="sr-only" tabIndex={-1}>
            {currentNav.label}
          </h1>
          {!session ? (
            <section className="live-login-card">
              <div className="login-symbol">
                <LockKeyhole size={25} />
              </div>
              <span className="coverage-pill">{personal ? "个人账号 · 受控管理" : "统一身份 · 授权访问"}</span>
              <h2>
                {authState === "loading"
                  ? "正在确认登录状态"
                  : errorLabels[authState] || "连接统一身份后继续"}
              </h2>
              <p>
                连接 Aigora、Scaena、Eikona 与
                Sonora，在同一处追踪输入、执行过程和产出。
              </p>
              {personal ? (
                <form className="space-y-3" onSubmit={async event => {
                  event.preventDefault();
                  if (loginBusy) return;
                  setLoginBusy(true);
                  try {
                    await read('/auth/personal', undefined, {
                      method: 'POST', headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ password, ...(usernameRequired ? { username } : {}) }),
                    });
                    const next = await read<Session>('/session');
                    setSession(next); setScope(next.scopes[0]?.id || ''); setAuthState('ready');
                  } catch (reason) {
                    setAuthState(reason instanceof Error ? reason.message : 'source_unavailable');
                  } finally { setPassword(''); setLoginBusy(false); }
                }}>
                  {usernameRequired && <>
                    <label className="block text-sm" htmlFor="personal-username">用户名</label>
                    <input id="personal-username" name="username" autoComplete="username" value={username} onChange={event => setUsername(event.target.value)} required maxLength={80} disabled={loginBusy} className="w-full rounded-lg border bg-background p-3" />
                  </>}
                  <label className="block text-sm" htmlFor="personal-password">个人访问密码</label>
                  <input id="personal-password" name="password" type="password" autoComplete="current-password" value={password} onChange={event => setPassword(event.target.value)} required maxLength={1024} disabled={loginBusy} className="w-full rounded-lg border bg-background p-3" />
                  {['invalid_credentials', 'login_rate_limited', 'source_unavailable'].includes(authState) && <p role="alert" className="text-sm">{errorLabels[authState]}</p>}
                  <Button type="submit" variant="primary" disabled={loginBusy}>{loginBusy ? '正在登录' : '登录个人工作区'}</Button>
                  <p className="text-xs text-muted-foreground">密码只用于此控制中心会话，不是 MCP 或 Provider 密钥。</p>
                </form>
              ) : oidc ? (
                <a className="button primary" href={api + "/auth/login"}>
                  <LogIn size={16} />
                  使用统一账号登录
                </a>
              ) : (
                <PanelNotice title="OIDC 与 owner 委托尚未配置">
                  本地客户端已就绪；需要现有身份服务的客户端注册与可信授权绑定。不会复用其他控制台的
                  Cookie。
                </PanelNotice>
              )}
              <a href="?mode=demo#/tasks">
                浏览独立设计演示 <ArrowRight size={14} />
              </a>
              <div className="login-owner-list">
                {owners.map((o) => (
                  <span key={o}>{o}</span>
                ))}
              </div>
            </section>
          ) : (
            <>
              {error && (
                <PanelNotice
                  tone="warning"
                  title={errorLabels[error] || "部分数据尚不可用"}
                >
                  已清理失效范围数据，可刷新当前范围重新查询。
                </PanelNotice>
              )}
              {loading && (
                <div className="live-loading" role="status">
                  正在读取当前授权范围…
                </div>
              )}
              <SectionNavigation
                page={page}
                onNavigate={(id) => navigate(id)}
              />
              {content}
            </>
          )}
        </main>
      </div>
      {selected && session && (
        <AdminPanel
          key={scope + selected.owner + selected.id}
          open
          editing={false}
          live
          title={selected.title || selected.id}
          subtitle={selected.owner + " · 请求详情"}
          status={<Badge state={selected.state} />}
          stage="detail"
          context={(selectedScope?.label || "") + " / " + selected.tenant}
          objectKey={selected.id}
          close={() => setSelected(null)}
          tabs={
            <AdminTabs
              value={tab}
              onChange={setTab}
              items={requestDetailTabs}
            />
          }
          footer={
            <>
              <Button
                disabled={
                  rows.findIndex(
                    (r) => r.id === selected.id && r.owner === selected.owner,
                  ) <= 0
                }
                onClick={() =>
                  select(
                    rows[
                      rows.findIndex(
                        (r) =>
                          r.id === selected.id && r.owner === selected.owner,
                      ) - 1
                    ],
                  )
                }
              >
                <ArrowLeft size={14} />
                上一条
              </Button>
              <Button
                disabled={
                  rows.findIndex(
                    (r) => r.id === selected.id && r.owner === selected.owner,
                  ) < 0 ||
                  rows.findIndex(
                    (r) => r.id === selected.id && r.owner === selected.owner,
                  ) >=
                    rows.length - 1
                }
                onClick={() =>
                  select(
                    rows[
                      rows.findIndex(
                        (r) =>
                          r.id === selected.id && r.owner === selected.owner,
                      ) + 1
                    ],
                  )
                }
              >
                下一条
                <ArrowRight size={14} />
              </Button>
              <span className="muted">当前筛选范围</span>
            </>
          }
        >
          {tab === "概况" && <RequestOverview record={selected} />}
          {tab === "内容" && (
            <RequestBody
              record={selected}
              read={(direction, purpose, signal) =>
                read<ContentRead>(
                  "/requests/" +
                    selected.owner +
                    "/" +
                    encodeURIComponent(selected.id) +
                    "/content:read?" +
                    queryString(scope),
                  signal,
                  {
                    method: "POST",
                    headers: {
                      "Content-Type": "application/json",
                      "X-CSRF-Token": session.csrf,
                    },
                    body: JSON.stringify({ direction, purpose }),
                  },
                )
              }
            />
          )}
          {tab === "执行" &&
            (selected.attempts.length ? (
              <div className="admin-timeline">
                {selected.attempts.map((a) => (
                  <div key={a.ref}>
                    <span />
                    <section>
                      <strong>{a.ref}</strong>
                      <p>{a.state}</p>
                      <small>{a.started_at || "开始时间未提供"}</small>
                    </section>
                  </div>
                ))}
              </div>
            ) : (
              <Empty
                title="未关联执行尝试"
                description="没有 owner 引用，不推断尝试数量或时间线。"
              />
            ))}
          {tab === "概况" && (
            <PanelNotice title="费用读取以独立授权为准">
              缺少账本或权限不等于免费。客户费用与上游成本分别核对。
            </PanelNotice>
          )}
          {tab === "执行" && (
            <>
              <RequestOverview record={selected} />
              <PanelNotice title="只读恢复">
                当前只查询原请求；不触发重新生成。
              </PanelNotice>
            </>
          )}
        </AdminPanel>
      )}
    </AppShell>
  );
}
