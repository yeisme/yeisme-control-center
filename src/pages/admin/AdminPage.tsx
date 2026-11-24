import { useLocation, useSearchParams } from "react-router-dom";
import { useWorkspace } from "../../app/workspace";
import { PageToolbar, TabPanel, Tabs } from "../../components/ui";
import { CollaborationDirectory } from "../team/CollaborationDirectory";
import { AccountsPanel } from "./AccountsPanel";
import { AuditPanel } from "./AuditPanel";
import { OwnerMembersPanel } from "./OwnerMembersPanel";
import { adminTabFor, adminTabLabels, adminTabsFor, type AdminTab } from "../../shared/admin-tabs";

/**
 * Members and administration in one place. An administrator manages the studio's own accounts and reads the audit log;
 * everyone sees the organizations and teams they belong to, and what each tool reports about its members.
 */
export default function AdminPage() {
  const { isAdmin } = useWorkspace();
  const location = useLocation();
  const [params, setParams] = useSearchParams();
  const allowed = adminTabsFor(isAdmin);
  const tab = adminTabFor(params.get("tab"), location.pathname.replace(/^\/+/, "").split("/")[0] || "", allowed);
  // Each tab keeps its own address state; switching starts the next tab clean.
  const setTab = (next: AdminTab) => setParams(new URLSearchParams({ tab: next }), { replace: true });
  return <div className="page-enter space-y-5" data-page="admin">
    <h1 className="sr-only">成员与管理</h1>
    <PageToolbar
      lead={isAdmin ? "谁能进控制中心，能看哪些范围，做过什么。" : "你所在的组织和团队，以及各个工具里的成员。"}
      summary={isAdmin ? "在这里新建账号、重置访问 Key、停用和启用账号；组织与团队决定项目分给谁；审计记录只读，不含正文和凭据。" : "组织管理员可以在这里分配成员和团队；账号由控制中心管理员管理。"}
    />
    <Tabs<AdminTab> value={tab} onChange={setTab} label="成员与管理" className="space-y-4" options={allowed.map((id) => ({ id, label: adminTabLabels[id] }))}>
      {isAdmin && <TabPanel value="accounts"><AccountsPanel /></TabPanel>}
      <TabPanel value="organizations"><CollaborationDirectory /></TabPanel>
      <TabPanel value="members"><OwnerMembersPanel onTab={setTab} /></TabPanel>
      {isAdmin && <TabPanel value="audit"><AuditPanel /></TabPanel>}
    </Tabs>
  </div>;
}
