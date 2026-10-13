/* Shared view components and original domain flows reused by the v13 presentation. */
(()=>{'use strict';
const {state:S,scopeNames,shots,inMedia,issues,visibleCatalog}=window.YeismeSession;
const E=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const extraIcons={chevron:'<path d="m9 5 7 7-7 7"/>',down:'<path d="m6 9 6 6 6-6"/>',refresh:'<path d="M20 7v5h-5M4 17v-5h5"/><path d="M6 7a7 7 0 0 1 12-1l2 3M4 15l2 3a7 7 0 0 0 12-1"/>',clock:'<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',alert:'<path d="m12 3 10 18H2Z M12 9v5M12 17h.01"/>',lock:'<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v3"/>',check:'<path d="m5 12 4 4L19 6"/>',film:'<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 4v16M17 4v16M3 9h4M3 15h4M17 9h4M17 15h4"/>',external:'<path d="M15 3h6v6M21 3 11 13M10 3H3v18h18v-7"/>',back:'<path d="m10 5-7 7 7 7M3 12h18"/>',expand:'<path d="M9 3H3v6M15 3h6v6M3 15v6h6M21 15v6h-6"/>',bell:'<path d="M6 8a6 6 0 1 1 12 0c0 8 3 8 3 10H3c0-2 3-2 3-10M10 21h4"/>',info:'<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7h.01"/>',grid:'<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 9v13"/>',photo:'<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="10" r="2"/><path d="m21 16-5-5-9 8"/>',wave:'<path d="M4 10v4M8 7v10M12 4v16M16 7v10M20 10v4"/>'};
const icon=n=>`<svg viewBox="0 0 24 24" aria-hidden="true">${extraIcons[n]||window.YeismeIcons[n]||window.YeismeIcons.projects}</svg>`;
const B=(label,a,cls='',attrs='')=>`<button type="button" class="${cls||'btn'}" data-action="${a}" ${attrs}>${label}</button>`;
const badge=(label,tone='')=>`<span class="badge ${tone}">${label}</span>`;
const status=(label,tone='')=>`<span class="status ${tone?'text-'+tone:''}"><i class="dot"></i>${label}</span>`;
/* 服务标记：三个核心媒体服务用彩色图块 + 白色线形图标；其余服务用中性图块 + 名称首字 */
const mark=i=>i<3?`<span class="service-mark ${['video','image','audio'][i]}" aria-hidden="true">${icon(['film','photo','wave'][i])}</span>`:`<span class="service-mark" aria-hidden="true">${E((window.YeismeCatalog[i]?.name||'·').slice(0,1).toUpperCase())}</span>`;
const names={overview:'总览',projects:'项目',requests:'请求',assets:'资产',services:'服务',team:'团队',settings:'设置',studio:'片场'};
const tab=(items,current,action='tab')=>`<div class="tabs" role="tablist">${items.map(t=>B(t,action+':'+t,'seg'+(t===current?' active':''),`role="tab" aria-selected="${t===current}"`)).join('')}</div>`;
const title=t=>`<h1 class="sr-only" tabindex="-1">${t}</h1>`,bar=(tabs,actions='',secondary=false)=>`<div class="page-bar" data-od-id="page-bar">${tabs}${actions?`<div class="page-actions${secondary?' page-secondary':''}">${actions}</div>`:''}</div>`;
const kv=rows=>`<dl class="kv">${rows.map(([k,v])=>`<dt>${k}</dt><dd>${v}</dd>`).join('')}</dl>`;
const empty=(title,desc,action='')=>`<section class="panel empty">${icon('grid')}<h2>${title}</h2><p>${desc}</p>${action}</section>`;
const panelHead=(title,meta='',extra='',id='')=>`<div class="panel-head"><div><h2${id?` id="${id}"`:''}>${title}</h2>${meta?`<small>${meta}</small>`:''}</div>${extra}</div>`;
/* 参考摄影：均来自原项目演示数据（src/data.ts），按原始比例完整显示，不冒充作品画面 */
const photos={
 cover:{src:'rain-street.jpg',w:1400,h:933,alt:'夜色中的城市街道：电车轨道伸向远处，两侧悬挂旗帜，霓虹灯把建筑染成紫蓝色。参考摄影，非本片镜头画面。'},
 pack:{src:'night-street.jpg',w:1000,h:667,alt:'相近视角的夜间街道：电车轨道、两侧旗帜与店铺灯光，色调偏紫蓝。参考摄影，非本片镜头画面。'}
};
const photo=(p,caption,cls,id)=>`<figure class="${cls}" data-od-id="${id}"><img src="./resources/media/${p.src}" width="${p.w}" height="${p.h}" alt="${p.alt}" decoding="async"><figcaption>${icon('photo')}${caption}</figcaption></figure>`;
/* 手机（≤700）直接按视觉顺序输出 DOM，焦点与朗读顺序和画面一致，不用 CSS order 调换 */
const compact=()=>typeof matchMedia==='function'&&matchMedia('(max-width:700px)').matches;

function shell(){
 const nav=Object.entries(names).filter(([k])=>!['studio','settings'].includes(k)).map(([k,n])=>B(icon(k)+`<span class="nav-text">${n}</span>`+(k==='requests'&&inMedia()?`<span class="nav-count">${issues().length}</span>`:''),'nav:'+k,'nav-button'+(S.page===k?' active':''),`aria-label="${n}" ${S.page===k?'aria-current="page"':''}`)).join('');
 return `<button type="button" class="mobile-backdrop" data-action="mobile-close" aria-label="关闭导航"></button>
<aside class="sidebar" data-od-id="main-sidebar">
 <div class="brand"><span class="brand-mark">Y</span><span class="brand-text">Yeisme<small>控制中心</small></span></div>
 <div class="nav-label">工作空间</div>
 <nav aria-label="主导航">${nav}</nav>
 <div class="side-foot">
  <div class="studio-shortcut"><div class="row">${icon('film')}<strong class="small">回到创作现场</strong></div><small>带着作品、镜头与运行上下文继续。</small>${B('打开片场演示 '+icon('arrow'),'studio','on-dark','data-od-id="studio-shortcut"')}</div>
  ${B(icon('info')+'<span class="nav-text">视觉核心说明</span>','about','nav-button','aria-label="视觉核心说明"')}
  ${B(icon('settings')+'<span class="nav-text">设置</span>','nav:settings','nav-button'+(S.page==='settings'?' active':''),`aria-label="设置" ${S.page==='settings'?'aria-current="page"':''}`)}
  <div class="identity"><span class="avatar">制</span><div class="identity-text grow"><strong class="small">${S.scope==='personal'?'个人演示身份':'制作团队'}</strong><small>独立演示环境 · split-owner</small></div>${B(icon('chevron'),'nav:team','icon','aria-label="查看当前身份"')}</div>
 </div>
</aside>
<div class="workspace">
 <header class="topbar" data-od-id="workspace-header">
  <div class="top-left">${B(icon('menu'),'collapse','icon','aria-label="展开或收起导航"')}<select id="scope" aria-label="工作范围" data-od-id="scope-selector">${Object.entries(scopeNames).map(([k,n])=>`<option value="${k}" ${S.scope===k?'selected':''}>${n}</option>`).join('')}</select><span class="slash">/</span><span class="crumb">${names[S.page]}</span></div>
  <div class="top-actions">${B(icon('search')+'<span class="search-copy">搜索当前工作空间</span><kbd>⌘K</kbd>','search','search-button','aria-label="搜索与跳转"')}${B(icon('theme'),'theme','icon theme-toggle','aria-label="切换浅深主题"')}${B(icon('bell'),'audit','icon desktop-only','aria-label="查看会话活动"')}</div>
 </header>
 <div class="notice" data-od-id="persistent-demo-notice"><span>设计提案 · 示例数据 · 不连接真实服务</span><span class="notice-extra">v10 · Apple 视觉核心 ${B('查看说明 '+icon('chevron'),'about','link')}</span></div>
 <main id="main" data-od-id="main-content"></main>
</div>`;}

/* 总览 */
const videoCta=()=>S.solved?B(S.handoff?'查看交接回执':'准备审阅交接','review','primary'):B(S.busy?'正在查询原引用…':'查询原任务（模拟）','query-original','primary',S.busy?'disabled':'');
function issueRow(i,index=0){
 const tone=i.tone==='neutral'?'':i.tone,featured=i.id==='video';
 const secondary=index>0&&S.queue==='全部'&&!S.mobileQueueExpanded?' mobile-secondary-issue':'';
 const body=`<div><h3 class="issue-title">${i.title} ${badge(i.status,tone)}</h3><p class="issue-desc">${i.reason}</p><div class="issue-meta"><span class="owner">${i.owner}</span><span>雨夜重逢 / E01 · 镜头 03</span><time>${i.time}</time></div>${featured?`<div class="issue-actions">${videoCta()}${B('查看详情','request:video')}</div>`:''}</div>`;
 return `<article class="issue-row${featured?' featured':''}${secondary}" data-od-id="overview-issue-${i.id}"><span class="issue-symbol ${tone}">${icon(i.id==='rights'?'alert':i.id==='visual'?'lock':S.solved?'check':'clock')}</span>${body}${featured?'':B(icon('chevron'),'request:'+i.id,'issue-open',`aria-label="${i.next}，查看${i.title}详情"`)}</article>`;}
function chapter(mobile=false){const figure=photo(photos.cover,'参考摄影 · 非作品画面','chapter-photo','chapter-reference-photo');return `<section class="chapter" data-od-id="current-production" aria-labelledby="chapter-title">
 ${mobile?figure:''}<div class="chapter-copy">
  <div class="eyebrow">当前作品 · 漫剧制作</div>
  <h2 id="chapter-title">雨夜重逢</h2>
  <p>第 01 集 · 雨巷场景 · 12 个镜头</p>
  <div class="chapter-stat"><strong>8 / 12</strong><span>镜头已采用</span></div>
  <div class="segment-progress" role="img" aria-label="12 个镜头：8 个已采用、1 个阻塞、3 个待处理，均为示例">${Array.from({length:12},(_,i)=>`<span class="${i<8?'done':i===8?'blocked':''}"></span>`).join('')}</div>
  <div class="work-legend"><span><i class="done"></i>已采用 8</span><span><i class="blocked"></i>阻塞 1</span><span><i></i>待处理 3</span></div>
  <div class="chapter-actions">${B('在片场继续镜头 03 '+icon('arrow'),'studio','on-dark')}${B('项目详情 '+icon('chevron'),'project:rain','link')}</div>
 </div>
 ${mobile?'':figure}
</section>`;}
function health(){return `<section class="panel health-ribbon" aria-labelledby="health-title" data-od-id="health-summary">${panelHead('运行结论','样例观察 · '+S.observed,'','health-title')}
 <div class="health-item"><small>核心服务连接</small><strong><i class="dot text-good"></i>3 / 3 正常</strong><span class="fine">MCP 样例 · 不代表业务可继续</span></div>
 <div class="health-item"><small>需要你关注</small><strong>2 项阻塞</strong><span class="fine">另有 ${S.solved?'1 项待审阅':'1 项待决'}</span></div>
 <div class="health-item"><small>样例接入覆盖</small><strong>5 / 27</strong><span class="fine">目录映射 · 非接入数量</span></div>
 <div class="health-item"><small>来源新鲜度</small><strong>${S.observed}</strong><span class="fine">1 个来源过期</span></div>
</section>`;}
function queue(){
 const q=issues().filter(i=>S.queue==='全部'||(S.queue==='待决'&&i.code==='unknown')||(S.queue==='阻塞'&&['rights','visual'].includes(i.id))||(S.queue==='待审阅'&&i.code==='completed'));
 const filters=`<div class="queue-filters" role="group" aria-label="筛选优先事项">${['全部','待决','阻塞','待审阅'].map(x=>B(x,'queue:'+x,'seg'+(S.queue===x?' active':''),`aria-pressed="${S.queue===x}"`)).join('')}</div>`;
 return `<section class="panel queue" data-od-id="priority-queue" aria-labelledby="queue-title">${panelHead('优先处理','当前团队 · '+issues().length+' 项示例',filters,'queue-title')}${q.length?q.map(issueRow).join(''):'<div class="queue-empty">当前筛选没有待处理事项。其他类别保持独立。</div>'}${S.queue==='全部'?`<div class="mobile-queue-toggle">${B(S.mobileQueueExpanded?'收起其他事项':'另外 2 项阻塞 · 展开查看','mobile-queue','link',`aria-expanded="${S.mobileQueueExpanded}"`)}</div>`:''}</section>`;}
function coreServices(){return `<section class="panel core" data-od-id="core-service-matrix" aria-labelledby="core-title">${panelHead('核心服务','连接、授权与业务状态分列',B('管理服务 '+icon('chevron'),'nav:services','link'),'core-title')}<div class="service-matrix-head"><span>服务 / 职责</span><span>连接</span><span>授权</span><span>业务状态</span></div>${window.YeismeCatalog.slice(0,3).map((s,i)=>`<article class="service-matrix-row" data-od-id="core-service-${i}"><div>${B(mark(i)+`<span class="service-label"><b>${s.name}</b><small>${s.role}</small></span>`,'service:'+i,'service-name')}</div><span>${status('正常','good')}</span><span>${i===1?'只读':'可查询'}</span><span>${badge(i===0?(S.solved?'待审阅':'结果待决'):i===1?'写入受限':'权利阻塞',i===2?'bad':i===0?'warn':'')}</span></article>`).join('')}<div class="service-note"><strong>连接正常 ≠ 业务可继续</strong>状态影响《雨夜重逢》镜头 03，不代表整个服务故障。</div></section>`;}
function activity(){const rows=[[S.observed,S.handoff?'审阅交接已记录，等待 owner 确认':S.solved?'原视频已查到完成，等待审阅交接':'视频回执待核对，保留原任务引用','Scaena · 镜头 03',S.solved?'good':'warn'],['14:28','声音发行用途未通过权利检查','Sonora · rights-v2','bad'],['14:20','视觉候选 v3 可读，尚未采用','Eikona · 当前身份只读','']];
 return `<section class="panel activity" data-od-id="recent-activity" aria-labelledby="activity-title">${panelHead('最近业务活动','',B('查看记录 '+icon('chevron'),'audit','link'),'activity-title')}<div class="activity-list">${rows.map(([t,text,src,tone])=>`<div class="activity-row"><div class="row"><i class="dot ${tone?'text-'+tone:''}"></i><time>${t}</time></div><p>${text}<small>${src}</small></p></div>`).join('')}</div></section>`;}
function overview(){
 const top=title('总览')+bar(tab(['运行摘要','统计与成本'],S.tab),B(icon('refresh')+'刷新观察','refresh','ghost'),true);
 if(S.tab==='统计与成本')return top+costs();
 if(!inMedia())return top+empty(S.scope==='personal'?'个人环境尚未接入':'当前项目暂无运行投影','未提供数据不等于故障。切换范围后，不展示其他项目的状态、费用或详情。',B('查看能力与接入','capabilities'));
 /* 桌面先看作品再看判断；手机先处理最高优先事项，再看运行结论与作品 */
 return top+`<div class="overview-flow">${compact()?queue()+health()+chapter(true):chapter()+health()+queue()}${coreServices()}${activity()}</div><footer class="overview-caption"><span>状态、权限、账本与资产真源仍归各 owner。</span><span>样例观察 · 不代表线上验收</span></footer>`;}
function costs(){if(!inMedia())return empty('当前范围未提供费用投影','不沿用其他项目账本，也不将缺失数据补成零。');
 return `<div class="cost-grid">${[['Scaena · USD 实际','$ 1.20','唯一账本 sca:ledger-01'],['Sonora · CNY 预估','¥ 0.80','仅报价，不是已发生费用'],['其他任务 · 金额未核验','未知','无账本投影 ≠ 零费用']].map((a,i)=>`<article class="panel cost-card" data-od-id="cost-${i}"><small>${a[0]}</small><strong>${a[1]}</strong><small>${a[2]}</small></article>`).join('')}</div><div class="hint">样例统计 · 币种与账本独立。Aigora 的关联回执仅作证据，不重复加入领域账单。不存在跨币种总金额。</div><section class="panel bars"><h2>已决领域任务</h2><p class="small">样例历史分布 · 不混算业务操作与网关调用</p>${[['已完成',8,''],['已失败',2,'bad']].map(([n,v,t])=>`<div class="bar-row"><span>${n}</span><div class="bar-track"><div class="bar-fill ${t}" style="width:calc(${v} / 10 * 100%)"></div></div><span>${v} 项</span></div>`).join('')}<small>已决成功率 8 ÷ (8 + 2) = 80%；历史未知结果 1 项单列，不进入分母。</small></section>`;}

/* 服务 */
function statusLabel(s){return ({ready:'可用','read-only':'只读','not connected':'未连接',planned:'规划中',unauthorized:'未授权',stale:'观察过期',unknown:'状态未知'})[s]||s;}
function services(){
 let items=visibleCatalog().filter(s=>(S.group==='全部'||s.group===S.group)&&(s.name+s.role+s.status+s.level).toLowerCase().includes(S.query.toLowerCase()));
 if(S.filter==='远程实例')items=items.filter(s=>s.kind==='remote');if(S.filter==='核心媒体')items=items.filter(s=>s.id<3);
 let html=title('服务')+bar(tab(['服务实例','能力与接入','依赖关系'],S.tab),B(icon('refresh')+'刷新观察','refresh','ghost'),true);
 if(S.tab==='依赖关系')return html+dependencies();
 html+=`<div class="toolbar"><label class="search-field">${icon('search')}<input id="list-search" aria-label="搜索服务" placeholder="搜索服务、职责、状态…" value="${E(S.query)}"></label><select id="group-filter" aria-label="服务分组">${['全部',...new Set(window.YeismeCatalog.map(s=>s.group))].map(x=>`<option ${x===S.group?'selected':''}>${x}</option>`).join('')}</select><select id="list-filter" aria-label="服务类型">${['全部','远程实例','核心媒体'].map(x=>`<option ${x===S.filter?'selected':''}>${x}</option>`).join('')}</select><small>${items.length} 项映射 · 非接入数量</small></div>`;
 if(!items.length)return html+empty('没有匹配的服务','尝试其他名称或清除分组；筛选不会改变权限。',B('清除筛选','clear-filters'));
 if(S.tab==='能力与接入')return html+`<div class="capability-grid">${items.map(s=>`<article class="panel capability-card" data-od-id="capability-service-${s.id}"><div class="row">${mark(s.id)}<h2>${s.name}</h2></div><p>${s.role}</p><div><div class="mini-kv"><span>能力来源</span><span>${s.id<3?'MCP 用户陈述':'目录映射'}</span></div><div class="mini-kv"><span>真实部署验证</span><span>未验证</span></div><div class="mini-kv"><span>当前身份</span><span>${s.id===1?'仅可读（样例）':s.id<3?'可查询（样例）':'未核验'}</span></div><div class="mini-kv"><span>管理写合同</span>${badge('未提供')}</div></div><footer>${B('对照合同与授权 '+icon('chevron'),'contract:'+s.id,'link')}</footer></article>`).join('')}</div>`;
 return html+[...new Set(items.map(s=>s.group))].map(g=>{const list=items.filter(s=>s.group===g);return `<details class="panel directory-group" open data-od-id="group-${list[0].id}"><summary>${icon('chevron')}${g}<small>${list.length} 项</small></summary><div class="service-row head"><span>服务 / 职责</span><span>实例 / 环境</span><span>连接</span><span>当前授权</span><span>业务就绪</span><span>管理等级</span></div>${list.map(s=>`<article class="service-row" data-od-id="service-${s.id}"><div class="row">${mark(s.id)}<div class="grow">${B(s.name,'service:'+s.id,'link')}<small>${s.role}</small></div></div><div>${s.kind==='local'?'本地工具':s.kind==='entry'?'设计入口':s.kind==='personal'?'个人隔离':'团队演示'}<small>${s.id<3?'media-01 · '+S.observed:s.kind==='remote'?'部署待核验':'非驻留实例'}</small></div><div>${s.id<3?status('正常','good'):badge(statusLabel(s.status))}</div><div>${s.id===1?'只读':s.id<3?'原对象查询':'未核验'}</div><div>${badge(s.id<3&&!inMedia()?'当前无投影':s.id===0?(S.solved?'待审阅':'结果待决'):s.id===2?'权利阻塞':statusLabel(s.status),s.id===2&&inMedia()?'bad':s.status==='stale'?'warn':'')}</div><div>${s.level}<small>${s.id<3?'样例验证 '+S.observed:'尚未验证'}</small></div></article>`).join('')}</details>`;}).join('');}
function dependencies(){if(!inMedia())return empty('当前范围尚无依赖投影','研究、知识与个人范围不会借用媒体项目的依赖。可在目录中核对每个 owner 的公开合同。',B('查看能力与接入','capabilities'));
 return `<section class="panel">${panelHead('雨夜重逢 / E01 / 镜头 03','',badge('公开引用链'))}<div class="dependency-flow">${[['01','片场','镜头 revision 7','project:rain'],['02','Scaena','制作操作 018','request:production'],['03','Eikona / Sonora','图像版本 / 声音权利','request:rights'],['04','Scaena','视频 / 合成','request:video'],['05','DriveBridge','字节交付引用','request:retry']].map(([n,t,d,a])=>`<div class="dependency-node"><small>${n} · 阶段</small><h3>${t}</h3><p class="small">${d}</p>${B('查看引用 '+icon('chevron'),a,'link')}</div>`).join('')}</div><div class="panel-foot">只读关系，不复制任务状态。Aigora 必须携带 correlation ref 才作为子证据；个人 MCP Gateway 独立。</div></section><div class="hint"><strong>影响范围：</strong>声音发行权利限制镜头 03 的采用与交付，不推断 Sonora 整体不可用。</div>`;}

/* 请求 */
function requests(extraToolbar=''){
 let rows=S.tab==='业务操作'?[window.YeismeSession.task('production')]:S.tab==='领域任务'?[...issues(),window.YeismeSession.task('retry')]:[window.YeismeSession.task('gateway')];
 if(!inMedia())rows=[];
 rows=rows.filter(i=>(i.title+i.owner+i.ref).toLowerCase().includes(S.query.toLowerCase())&&(S.filter==='全部'||(S.filter==='待处理'?i.code!=='completed':i.code==='completed')));
 if(S.sort==='名称')rows.sort((a,b)=>a.owner.localeCompare(b.owner));
 const track=S.tab==='业务操作'&&inMedia()?`<div class="panel operation-track" data-od-id="operation-track">${[['01','镜头上下文','project:rain'],['02','制作操作','request:production'],['03','图像 / 声音','request:rights'],['04','视频 / 合成','request:video'],['05','交付引用','request:retry']].map(([n,t,a])=>B(`<span class="track-index">${n}</span>${t}`,a,'track-step')).join('')}</div>`:'';
 const list=rows.length?`<section class="panel request-list"><div class="request-head"><span>对象 / 原引用</span><span>统一状态</span><span>owner</span><span>范围</span><span></span></div>${rows.map(i=>`<article class="request-row" data-od-id="request-${i.id}"><div>${B(i.title,'request:'+i.id,'link')}<small>${i.ref}</small></div><span>${badge(i.status,i.tone==='neutral'?'':i.tone)}</span><span>${i.owner}</span><span class="small">E01 / 镜头 03</span>${B(icon('chevron'),'request:'+i.id,'icon',`aria-label="查看${i.title}"`)}</article>`).join('')}</section>`:empty('没有匹配的请求','当前范围没有授权投影，或没有符合筛选的记录。');
 return title('请求')+bar(tab(['业务操作','领域任务','网关调用'],S.tab),S.returnStudio?B(icon('back')+'返回镜头 '+S.shot,'back-shot','primary'):'')+extraToolbar+`<div class="toolbar"><label class="search-field">${icon('search')}<input id="list-search" value="${E(S.query)}" placeholder="搜索名称、owner 或原引用…" aria-label="搜索请求"></label><select id="list-filter" aria-label="请求状态">${['全部','待处理','已完成'].map(x=>`<option ${S.filter===x?'selected':''}>${x}</option>`).join('')}</select><select id="list-sort" aria-label="排序">${['优先级','名称'].map(x=>`<option ${S.sort===x?'selected':''}>${x}</option>`).join('')}</select><small>${S.tab} · ${rows.length} 项示例</small></div>`+track+list+`<div class="hint">原生状态保留。网关证据不等于新的业务操作；费用引用原领域账本，不重复记账。所有记录均为本地设计样例。</div>`;}

/* 项目 */
function referenceBoard(){return `<section class="panel photo-board" data-od-id="reference-board" aria-labelledby="board-title">${panelHead('氛围参考','雨夜重逢 · 项目参考素材',badge('参考摄影'),'board-title')}<div class="photo-board-body">${photo(photos.pack,'雨夜 · 参考素材包 · 参考摄影 · 非作品画面','board-photo','reference-pack-photo')}${kv([['素材','雨夜 · 参考素材包'],['资产引用','demo:drivebridge:reference-pack'],['版本','v1 · 可引用'],['来源','DriveBridge · 参考文件空间'],['操作引用','demo:drivebridge:transfer-014'],['权利','设计样例 · 仅预览'],['交接','文件版本已固定；生产采用待确认']])}</div><div class="panel-foot">原项目演示数据中的既有参考摄影，仅作氛围参考；不是镜头产出，不声明使用许可。</div></section>`;}
function projects(extraTabs=''){
 const project=S.scope==='research'?'research':S.scope==='knowledge'?'knowledge':S.projectType==='研究资料'?'research':S.projectType==='知识空间'?'knowledge':'rain';
 const html=title('项目')+bar(tab(['漫剧制作','研究资料','知识空间'],S.projectType,'projecttype'))+extraTabs;
 if(S.scope==='personal')return html+empty('个人工作区暂无授权项目','不展示制作团队项目与正文。个人网关和企业网关拥有独立凭据与状态。');
 if(project!=='rain'){const research=project==='research';return html+`<section class="panel" data-od-id="project-${project}"><div class="project-cover"><div class="service-mark">${research?'研':'知'}</div><div><h2>${research?'叙事研究':'制作知识库'}</h2><p class="small muted">${research?'论点 → 证据 → 实验':'空间 → 索引 → 版本引用'}</p></div></div><div class="panel-body"><p>${research?'Quaestor / Anatomia / Auctra 保留分析、证据与文稿真源。':'Pinax / Manju 保留知识索引，Capsa 只暴露加密同步元数据。'}</p><div class="hint">目录可见，远程内容及管理合同待核验。不展示其他项目的镜头或费用。</div><div class="row wrap">${B('进入项目范围','project:'+project,'primary')}${B('工作台交接边界','launch:'+(research?'Quaestor':'Pinax'))}</div></div></section>`;}
 const shot=shots[S.shot];
 return html+`<div class="project-grid"><aside class="panel project-tree" aria-label="项目结构"><div class="tree-node">${icon('projects')}<strong>雨夜重逢</strong></div><div class="tree-node level-1">第 01 集 <span class="muted small">12 个镜头</span></div><div class="tree-node level-1 muted">雨巷场景</div><div class="tree-shots">${Object.entries(shots).map(([id,x])=>B('镜头 '+id+badge(x.adopted?'已采用':S.solved?'待审阅':'待处理',x.adopted?'':'warn'),'projectshot:'+id,'tree-shot'+(S.shot===id?' active':''),S.shot===id?'aria-current="true"':'')).join('')}</div><div class="hint">其余 9 个镜头未提供明细；不编造正文或引用。</div></aside><section class="panel" data-od-id="project-shot-panel"><div class="project-cover"><div class="episode-mark"><small>镜头</small><strong>${S.shot}</strong></div><div class="grow"><h2>${shot.name}</h2><p class="small muted">雨夜重逢 / E01 / 镜头 ${S.shot} · revision ${shot.revision}</p></div>${badge(shot.adopted?'已采用':'待处理',shot.adopted?'good':'warn')}</div><div class="reference-grid">${[['生产运行',shot.operation,shot.adopted?'样例已完成':'阶段独立恢复'],['视觉版本',shot.visual,shot.adopted?'固定采用版本':'current · 未采用'],['声音资产',shot.audio,shot.adopted?'固定采用版本':'frozen · 发行受限'],['视频产出',shot.video,shot.adopted?'已采用':S.solved?'v1 · 待审阅':'unknown · 不重投']].map(([n,r,d],i)=>`<article class="reference-card" data-od-id="shot-reference-${i}"><small>${n}</small><p>${r}</p>${badge(d)}${!shot.adopted?B('查看原对象 '+icon('chevron'),'request:'+['production','visual','rights','video'][i],'link'):''}</article>`).join('')}</div><div class="project-actions">${B('进入项目范围','project:rain')}${B(icon('film')+'在片场继续','studio-current','primary')}${B('工作台交接','launch:片场')}</div><div class="panel-foot">跨工作台携带固定项目 / 镜头 / revision；不复制生产图编辑器，不声称真实单点登录。</div></section></div>${referenceBoard()}`;}

/* 资产、团队、设置。资产页不显示页面标题与说明，只留读屏用 h1，切页焦点照常落在标题上 */
function assets(){return title('资产')+(!inMedia()?empty('当前范围没有资产投影','正文未授权，不借用其他项目素材。'):`<section class="panel">${[['Eikona','视觉候选','eik:visual-031 / v3','current · 尚未采用',1],['Sonora','声音资产','son:audio-082 / v2','frozen · 发行权利受限',2],['DriveBridge','交付字节引用','drv:delivery-012 / v1','stale · 来源版本已变化',7]].map((a,i)=>`<article class="settings-row" data-od-id="asset-${i}"><div class="row">${mark(a[4])}<div><div class="row wrap"><h2>${a[0]} / ${a[1]}</h2>${badge(a[3],i===2?'warn':'')}</div><small>${a[2]} · 雨夜重逢 / E01 / S03</small></div></div>${B('版本与权限 '+icon('chevron'),'asset:'+i)}</article>`).join('')}</section><div class="hint">受控媒体未加载。DriveBridge 负责字节与传输引用；领域用途、权利与采用事实归 Eikona / Sonora / Scaena。</div>`);}
function team(){return title('团队')+`<section class="panel" data-od-id="team-identity"><div class="project-cover"><span class="avatar">制</span><div class="grow"><h2>${S.scope==='personal'?'个人演示身份':'制作成员 · 演示身份'}</h2><p class="small muted">${scopeNames[S.scope]} · owner 授权投影</p></div>${badge('只读')}</div><div class="panel-body">${kv([['Scaena',S.scope==='personal'?'未授权':'摘要 / 原对象查询（样例）；生产写入未验收'],['Eikona',S.scope==='personal'?'未授权':'只读身份；无新任务写入权限'],['Sonora',S.scope==='personal'?'未授权':'权利摘要可读；正文权限未验证'],['Aigora','企业主体独立 · 不继承个人授权'],['个人网关','个人 MCP Gateway · 未连接，独立配置']])}<div class="hint">邀请、角色变更、额度修改没有受控管理合同。切换工作范围不增加任何权限。</div></div></section>`;}
function settings(withTitle=true){
 const dark=document.documentElement.dataset.theme==='dark',dense=document.body.classList.contains('dense');
 const seg=(label,act,current,items)=>`<div class="tabs" role="group" aria-label="${label}">${items.map(([v,t])=>B(t,act+':'+v,'seg'+(v===current?' active':''),`aria-pressed="${v===current}"`)).join('')}</div>`;
 return (withTitle?title('设置'):'')+`<section class="panel" data-od-id="settings-preferences">${[
  ['外观主题','编辑室 / 电影工作台；布局与业务状态保持一致',seg('外观主题','theme',dark?'dark':'light',[['light','浅色'],['dark','深色']])],
  ['列表密度','桌面上列表行更紧凑，手机保持标准行高',seg('列表密度','density',dense?'compact':'comfortable',[['comfortable','舒适'],['compact','紧凑']])],
  ['本地通知','只显示本次会话提示，不发送系统推送',`<button type="button" class="switch" role="switch" aria-checked="${S.notifications}" aria-label="本地通知" data-action="notifications"></button>`],
  ['会话审计','所有模拟查询与交接均可追溯',B('查看会话记录','audit')]
 ].map(([t,d,b])=>`<div class="settings-row"><div><h2>${t}</h2><small>${d}</small></div>${b}</div>`).join('')}</section>`;}

/* 片场：取景器只显示受控占位，不加载任何图片 */
function viewer(shot){const locked=S.stage==='专业分镜';
 return `<div class="viewer" data-od-id="shot-viewer"><div class="slate-row"><span>E01 · 雨巷场景</span><span>revision ${shot.revision}</span></div><div class="slate-center">${locked?icon('lock'):''}<div class="slate-code">S${S.shot}</div>${locked?'<h3>分镜内容未授权</h3><p>当前只提供固定镜头引用。未加载作品图片或正文，不以无关素材代替。</p>':`<p>${S.stage} · ${shot.name}</p>`}</div><div class="slate-row"><span>受控占位 · 未加载作品画面</span><span>16:9</span></div></div>`;}
function stageContent(shot){
 if(S.stage==='专业分镜')return viewer(shot);
 if(S.stage==='剧本工作区')return viewer(shot)+`<div class="stage-copy"><h3>剧本与镜头引用</h3>${kv([['镜头版本','revision '+shot.revision],['关联运行',shot.operation],['文稿正文','尚未授权，未读取'],['修订 / 接受','以 Auctra 原生事实为准']])}<div class="hint">此处不复制 Auctra 正文编辑器。</div></div>`;
 if(S.stage==='声音与剪辑')return viewer(shot)+`<div class="stage-copy"><h3>固定版本与声音权利</h3>${kv([['声音引用',shot.audio],['视觉引用',shot.visual],['发行权利',shot.adopted?'已采用版本（设计样例）':'rights-v2 不含发行用途'],['合成状态',shot.adopted?'已完成':'当前镜头受权利限制']])}${S.runtime?'':B('查看当前运行','runtime')}</div>`;
 return viewer(shot)+`<div class="stage-copy"><h3>${shot.adopted?'当前版本已采用':S.solved?'视频完成，等待审阅':'先核对原视频结果'}</h3>${kv([['生成',shot.adopted?'已完成':S.solved?'已完成（模拟回执）':'结果未知'],['审阅',shot.adopted?'已审核（样例）':S.handoff?'已交接 · owner 待审阅':'尚未交接'],['采用',shot.adopted?'已采用（样例）':'未采用'],['交付',shot.adopted?'未提供交付投影':'声音发行权利仍阻塞']])}${S.runtime?'':B('打开镜头运行面板','runtime')}</div>`;}
function studio(){
 const shot=shots[S.shot],capsule=shot.adopted?'当前镜头 · 已采用':`待决 ${S.solved?0:1} · 阻塞 2${S.solved?' · 待审阅 1':''}`;
 return title('片场')+bar(tab(['剧本工作区','专业分镜','声音与剪辑','审阅与交付'],S.stage,'stage'),B(icon('clock')+capsule,'runtime',S.runtime?'btn':'primary',`aria-expanded="${S.runtime}"`))+`<div class="studio-layout${S.runtime?' has-runtime':''}"><aside class="panel shot-list" aria-label="雨巷场景镜头"><small>雨巷场景 / 镜头</small>${Object.entries(shots).map(([id,x])=>B(`<span>${id} · ${x.name}</span><small>${x.adopted?'已采用':S.solved?'待审阅':'待处理'}</small>`,'shot:'+id,'shot-option'+(id===S.shot?' active':''),id===S.shot?'aria-current="true"':'')).join('')}</aside><section class="panel studio-canvas" data-od-id="studio-creative-context"><div class="canvas-heading"><div class="row between"><h2>镜头 ${S.shot} · ${shot.name}</h2>${badge('revision '+shot.revision)}</div><p>${S.stage} · 仅公开引用，不读取真实正文</p></div>${stageContent(shot)}<div class="frame-meta"><span>${shot.operation}</span><span>${shot.adopted?'已审核 · 已采用':'审核待定 · 未采用'}</span></div><div class="studio-copy"><h3>镜头上下文</h3><p>创作内容由片场持有，任务与版本由各 owner 提供。运行面板只说明此刻的下一步，不接管创作。</p><div class="shot-strip">${Object.entries(shots).map(([id,x])=>B(`<span class="thumb" aria-hidden="true">S${id}</span><span>镜头 ${id}</span><small>${x.adopted?'已采用':'待处理'}</small>`,'shot:'+id,'strip-shot'+(id===S.shot?' active':''),id===S.shot?'aria-current="true"':'')).join('')}</div></div></section>${S.runtime?runtime():''}</div>`;}
function runtime(){const shot=shots[S.shot];
 const body=shot.adopted?`<div class="next-action"><div class="eyebrow">当前镜头</div><h3>没有待处理事项</h3><p>${shot.video} 已采用（样例）。不会显示镜头 03 的任务。</p></div>`:`<section class="next-action" data-od-id="runtime-next-action"><div class="eyebrow">下一步 / Scaena</div>${badge(S.solved?'生成完成':'结果待决',S.solved?'good':'warn')}<h3>${S.solved?(S.handoff?'引用已交接，等待 owner 审阅':'视频完成，准备交给审阅'):'核对原视频，不要重复生成'}</h3><p>${S.solved?'固定产出 v1 / revision 7。审核、采用与声音权利仍是独立事实。':'回执中断并不代表失败。仅查询 sca:video-103，attempt 保持 1。'}</p>${S.solved?B(S.handoff?'查看模拟交接回执':'准备审阅交接','review','primary'):B(S.busy?'正在查询本地引用…':'查询原任务（模拟）','query-original','primary',S.busy?'disabled':'')}</section><section class="runtime-block"><h3>尚未解除的阻塞</h3><div class="runtime-event"><i class="dot text-bad"></i><div>声音发行权利未确认<small>Sonora · son:audio-082</small>${B('查看权利边界 '+icon('chevron'),'request:rights','link')}</div></div><div class="runtime-event"><i class="dot"></i><div>图像任务写入未授权<small>Eikona · 当前身份仅可读</small></div></div></section><section class="runtime-block"><h3>审阅与采用</h3><div class="mini-kv"><span>审阅交接</span><span>${S.handoff?'已交接（模拟）':S.solved?'待交接':'结果未确认'}</span></div><div class="mini-kv"><span>owner 审核</span><span>待审阅</span></div><div class="mini-kv"><span>正式采用</span><span>未采用</span></div></section><section class="runtime-block"><details><summary>费用来源 <span class="row muted">按账本独立${icon('down')}</span></summary><p>Scaena · USD 实际 1.20<br>Sonora · CNY 预估 0.80<br>其他费用未知；Aigora 子证据不重复相加。</p></details><details><summary>共享引用与执行证据 <span class="row muted">${icon('down')}</span></summary><p>sca:production-018 → sca:video-103<br>attempt 1 · shot revision 7<br>${S.solved?'已生成模拟查询回执。':'未知结果仅查询原对象。'}<br>切换页面不触发任务，不复制领域状态。</p></details></section>`;
 /* 遮罩只在手机 Sheet 下显示，供点按关闭；键盘与读屏用关闭按钮和 Escape */
 return `<div class="runtime-backdrop" data-action="runtime-close" aria-hidden="true"></div><aside class="runtime-panel" aria-label="当前镜头运行" data-od-id="studio-runtime-panel"><header class="runtime-head"><div class="row between"><span class="eyebrow">设计提案 · 示例数据 · 不连接真实服务</span>${B(icon('close'),'runtime-close','icon','aria-label="关闭运行面板并返回镜头"')}</div><div class="detail-title"><div class="grow"><h2>镜头运行</h2><p class="small muted">雨夜重逢 / E01 / 镜头 ${S.shot}</p></div></div></header><div class="runtime-body">${body}</div><footer class="runtime-foot">${!shot.adopted?B('在控制中心打开 '+icon('arrow'),'open-center'):''}${B('返回镜头','runtime-close')}</footer></aside>`;}
window.YeismeViews={E,B,badge,status,mark,icon,names,tab,title,bar,kv,empty,shell,overview,services,requests,projects,assets,team,settings,studio,runtime,statusLabel,costs,queue,coreServices,activity,chapter};
})();
