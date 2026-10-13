import { Badge, Button } from './ui';
import { Server, ArrowRight } from './icons';
import { contentStateMessage, type ConnectionObservation, type TaskConnectionState } from './task-observation';
import { taskListHash } from './task-links';
import './task-monitor.css';

const labels: Record<string, string> = {
  ready: '任务读取可用', not_configured: '未配置连接', not_checked: '尚未检查',
  needs_authorization: '需要授权', needs_contract: '缺少观测合同',
  source_unavailable: '暂不可达', source_rate_limited: '来源限流', source_busy: '来源繁忙',
  invalid_task_page: '任务合同不匹配', invalid_mcp_response: '响应合同不匹配',
  mcp_initialization_failed: '协议初始化失败', connection_endpoint_denied: '连接地址未获准',
};
export const connectionLabel = (state: string) => labels[state] || '读取未完成';
export function ConnectionFacts({ runtime }: { runtime?: ConnectionObservation }) {
  if (!runtime) return <p className="text-sm text-muted-foreground">尚无协议与授权检查记录</p>;
  return <dl className="connection-facts">
    <dt>协议</dt><dd>{runtime.transport === 'verified' ? '已验证' : '未确认'}</dd>
    <dt>任务授权</dt><dd>{runtime.authorization === 'verified' ? '已验证' : runtime.authorization === 'denied' ? '已拒绝' : '未确认'}</dd>
    <dt>观测合同</dt><dd>{runtime.contract === 'supported' ? '支持' : runtime.contract === 'unsupported' ? '不支持' : '未确认'}</dd>
    <dt>结果读取</dt><dd>{contentStateMessage(runtime.content)}</dd>
    {runtime.task_families.length > 0 && <><dt>任务类型</dt><dd>{runtime.task_families.join(' · ')}</dd></>}
    <dt>最近检查</dt><dd>{new Date(runtime.checked_at).toLocaleString()}</dd>
  </dl>;
}
export function ConnectionCards({ connections, now = Date.now(), onOpen }: {
  connections: TaskConnectionState[]; now?: number; onOpen?: (owner: string) => void;
}) {
  const owners = ['scaena', 'eikona', 'sonora'] as const;
  return <section className="connection-cards task-connections" aria-label="核心服务接入">
    {owners.flatMap(owner => {
      const items = connections.filter(c => c.owner === owner);
      return (items.length ? items : [{ id: owner, owner, label: owner[0].toUpperCase() + owner.slice(1),
        instance_id: '', project: '', environment: '', state: 'not_configured', observed_at: '' }]).map(c =>
        <article className="connection-card" key={c.id}>
          <div className="connection-card-heading"><span className="connection-icon"><Server size={18}/></span>
            <strong>{c.label}</strong><Badge state={c.state === 'ready' ? 'succeeded' : 'unknown'} label={connectionLabel(c.state)}/></div>
          <p className="text-sm text-muted-foreground">{c.instance_id ? `${c.environment || '环境未提供'} · ${c.instance_id} · ${c.project}` : '等待登记项目观测连接'}</p>
          <p className="text-sm text-muted-foreground">{contentStateMessage('runtime' in c ? c.runtime?.content : undefined)}</p>
          <div className="connection-card-footer"><small>{c.observed_at
            ? `${now - Date.parse(c.observed_at) > 30000 ? '上次成功观察' : '观察于'} ${new Date(c.observed_at).toLocaleTimeString()}`
            : '尚无成功观察'}</small>
            {onOpen ? <Button variant="ghost" size="sm" onClick={() => onOpen(owner)}>查看接入 <ArrowRight size={14}/></Button>
              : c.project && <a href={taskListHash(c.id, c.project)}>查看任务 <ArrowRight size={14}/></a>}
          </div>
        </article>);
    })}
  </section>;
}
