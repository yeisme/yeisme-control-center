/* 可重置的浏览器设计会话。没有网络调用、凭据或持久化领域数据。 */
(()=>{'use strict';
const scopeNames={team:'制作团队 / 全部项目',rain:'制作团队 / 雨夜重逢',research:'制作团队 / 叙事研究',knowledge:'制作团队 / 制作知识库',personal:'个人 / 独立工作区'};
const state={page:'overview',tab:'运行摘要',scope:'team',query:'',filter:'全部',group:'全部',sort:'优先级',projectType:'漫剧制作',shot:'03',stage:'专业分镜',runtime:false,returnStudio:false,solved:false,handoff:null,confirmed:false,busy:false,observed:'14:32',detail:null,detailTab:'概况',full:false,notifications:true,queue:'全部',mobileQueueExpanded:false,conflict:false,configReloaded:false,eventsError:false,epoch:0,audit:[]};
const shots={
 '01':{name:'雨巷空镜',revision:4,visual:'eik:visual-029 / v2',audio:'son:audio-080 / v1',video:'sca:video-101 / v2',operation:'sca:production-016',adopted:true},
 '02':{name:'巷口停步',revision:5,visual:'eik:visual-030 / v2',audio:'son:audio-081 / v1',video:'sca:video-102 / v1',operation:'sca:production-017',adopted:true},
 '03':{name:'雨夜重逢',revision:7,visual:'eik:visual-031 / v3',audio:'son:audio-082 / v2',video:'sca:video-103',operation:'sca:production-018',adopted:false}
};
const inMedia=()=>['team','rain'].includes(state.scope);
const issues=()=>[
 {id:'video',title:state.solved?(state.handoff?'视频已交接，等待审阅':'视频已完成，待交接审阅'):'视频结果尚未确认',status:state.solved?'待审阅':'结果待决',code:state.solved?'completed':'unknown',native:state.solved?'completed':'awaiting_reconciliation',tone:state.solved?'good':'warn',owner:'Scaena',ref:'sca:video-103',reason:state.solved?'原任务已查到完成；审核与采用保持独立。':'回执中断，无法确认结果。只查询原任务，不重投。',next:state.solved?'准备审阅交接':'查询原任务',time:state.observed},
 {id:'rights',title:'声音发行权利待确认',status:'权利阻塞',code:'blocked',native:'rights_blocked',tone:'bad',owner:'Sonora',ref:'son:audio-082',reason:'现有授权不含发行用途；只影响当前镜头。',next:'查看权利边界',time:'14:28'},
 {id:'visual',title:'图像任务写入未授权',status:'仅可读',code:'unauthorized',native:'access_denied',tone:'neutral',owner:'Eikona',ref:'eik:visual-031',reason:'候选 v3 可读，当前身份无新任务提交权限。',next:'核对身份授权',time:'14:20'}
];
function setScope(scope){if(!scopeNames[scope])return;state.scope=scope;state.query='';state.filter='全部';state.group='全部';state.detail=null;state.runtime=false;state.returnStudio=false;state.confirmed=false;state.busy=false;state.epoch++;if(state.page==='studio')state.page='overview';state.projectType=scope==='research'?'研究资料':scope==='knowledge'?'知识空间':'漫剧制作';}
function queryOriginal(){if(!inMedia())return false;state.solved=true;state.audit.push({scope:state.scope,time:new Date().toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit'}),text:'模拟查询原任务 sca:video-103 → completed；attempt 保持 1'});return true;}
function submitReview(){if(!inMedia()||!state.solved||!state.confirmed||state.handoff)return false;state.handoff={ref:'demo:review-handoff-103',output:'sca:video-output-103 / v1',revision:7,time:new Date().toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit'})};state.confirmed=false;state.audit.push({scope:state.scope,time:state.handoff.time,text:'模拟交接固定 v1 / revision 7；审核 pending、未采用、声音权利仍阻塞'});return true;}
function visibleCatalog(){return window.YeismeCatalog.filter(s=>state.scope==='personal'?['local','personal'].includes(s.kind):true);}
function task(id){return issues().find(x=>x.id===id)||({retry:{id:'retry',title:'交付传输失败',status:'可重试',code:'failed',native:'transport_failed',tone:'bad',owner:'DriveBridge',ref:'drv:transfer-004',reason:'已明确失败且 retryable=true；未知结果不能套用此恢复动作。'},gateway:{id:'gateway',title:'关联网关调用证据',status:'已完成',code:'completed',native:'completed',tone:'good',owner:'Aigora',ref:'aig:call-119',reason:'关联 eik:visual-031 的子证据，不新增业务操作，不重复计算领域费用。'},production:{id:'production',title:'镜头 03 · 制作操作',status:'部分阻塞',code:'partial',native:'partially_blocked',tone:'warn',owner:'Scaena',ref:'sca:production-018',reason:state.solved?'视频已完成待审阅、声音权利仍阻塞、图像候选只读。每个子对象独立恢复。':'视频待核对、声音权利阻塞、图像候选只读。每个子对象独立恢复，禁止整批重投。'}}[id]);}
window.YeismeSession={state,scopeNames,shots,inMedia,issues,setScope,queryOriginal,submitReview,visibleCatalog,task};
})();
